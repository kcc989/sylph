import { Context, Effect, Layer, Schema } from "effect"
import {
  ProjectResourceOperation,
  ResourceMutationConfirmation,
  ResourceMutationInput,
  ResourceMutationReview,
  ResourcePolicyError,
  StoredProjectResource,
} from "@workspace/domain/project-resources"
import {
  findResource,
  readProjectResources,
  type ResourceDatabase,
} from "./project-resources"
import {
  verifyWorkerResources,
  type ResourceCredentials,
  type ResourceRequest,
} from "./cloudflare-resources"
import { resourceKey, validateResourceTopology } from "./resource-policy"
import {
  removeOwnedResources,
  verifyRemovalReferences,
} from "./resource-removal"

const policyFailure = (cause: unknown) =>
  new ResourcePolicyError({
    message:
      cause instanceof Error ? cause.message : "Resource operation failed",
  })

const operationFor = async (
  database: ResourceDatabase,
  accountId: string,
  projectId: string
) => {
  const row = await database
    .prepare(
      "SELECT * FROM project_resource_operation WHERE account_id = ? AND project_id = ? AND scope = 'production'"
    )
    .bind(accountId, projectId)
    .first()
  return row ? Schema.decodeUnknownSync(ProjectResourceOperation)(row) : null
}

const buildReview = async (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  input: ResourceMutationInput,
  request: ResourceRequest
) => {
  const operation = await operationFor(
    database,
    credentials.accountId,
    input.projectId
  )
  if (operation && operation.status !== "complete")
    throw new ResourcePolicyError({
      message:
        "Wait for the current resource operation to finish before review",
    })
  if (
    !input.resources.length ||
    input.resources.length > 20 ||
    new Set(input.resources.map(resourceKey)).size !== input.resources.length
  )
    throw new ResourcePolicyError({
      message: "Select between 1 and 20 distinct resources",
    })
  const claims = (await readProjectResources(database, input.projectId)).filter(
    (item) =>
      item.account_id === credentials.accountId && item.scope === "production"
  )
  if (input.action === "adopt") {
    validateResourceTopology(input.resources)
    if (claims.some((item) => item.state !== "deleted"))
      throw new ResourcePolicyError({
        message:
          "Adoption is for an untracked production inventory; existing claims must not be replaced",
      })
  }
  const inventory: StoredProjectResource[] = []
  for (const resource of input.resources) {
    const claim = claims.find(
      (item) => resourceKey(item) === resourceKey(resource)
    )
    if (
      resource.purpose === "recovery_control" ||
      claim?.purpose === "recovery_control"
    )
      throw new ResourcePolicyError({
        message:
          "Recovery control has independent ownership and cannot be adopted, retired, or removed through application resource actions",
      })
    const existing = await findResource(credentials, resource, request)
    if (input.action === "adopt") {
      if (!existing)
        throw new ResourcePolicyError({
          message: `Resource ${resource.name} does not exist; adoption never creates resources`,
        })
      const conflict = await database
        .prepare(
          "SELECT project_id FROM project_resource WHERE account_id = ? AND kind = ? AND (name = ? OR resource_id = ?) LIMIT 1"
        )
        .bind(credentials.accountId, resource.kind, resource.name, existing.id)
        .first()
      if (conflict)
        throw new ResourcePolicyError({
          message: `Resource ${resource.name} already has an ownership claim; adoption cannot take it over`,
        })
      if (
        ["durable_object", "workflow"].includes(resource.kind) &&
        (resource.worker !== existing.service ||
          resource.className !== existing.className)
      )
        throw new ResourcePolicyError({
          message: `Resource ${resource.name} has a different host or class`,
        })
      if (
        resource.kind === "domain" &&
        existing.service !==
          (resource.worker ??
            input.resources.find(
              (item) => item.entrypoint || item.kind === "worker"
            )?.name)
      )
        throw new ResourcePolicyError({
          message: `Domain ${resource.name} routes to a different Worker`,
        })
      inventory.push({
        account_id: credentials.accountId,
        project_id: input.projectId,
        scope: input.scope,
        kind: resource.kind,
        name: resource.name,
        resource_id: existing.id,
        generation: existing.generation ?? null,
        state: "active",
        purpose: "application",
      })
    } else {
      if (
        !claim ||
        (input.action === "retire"
          ? claim.state !== "active"
          : claim.state !== "retired")
      )
        throw new ResourcePolicyError({
          message: `${resource.name} must be ${input.action === "retire" ? "active" : "retired"} before ${input.action}`,
        })
      if (
        existing &&
        (existing.id !== claim.resource_id ||
          (existing.generation ?? null) !== claim.generation)
      )
        throw new ResourcePolicyError({
          message: `Resource identity changed for ${resource.name}`,
        })
      if (!existing && input.action === "retire")
        throw new ResourcePolicyError({
          message: `Resource ${resource.name} is missing; inspect it before retirement`,
        })
      inventory.push(claim)
    }
  }
  if (input.action === "adopt")
    await verifyWorkerResources(
      credentials,
      inventory,
      request,
      input.resources
    )
  else await verifyRemovalReferences(credentials, inventory, request)
  return {
    accountId: credentials.accountId,
    projectId: input.projectId,
    scope: input.scope,
    action: input.action,
    resources: input.resources,
    inventory: Schema.decodeUnknownSync(Schema.Array(StoredProjectResource))(
      inventory
    ),
    operationRunId: operation?.run_id ?? null,
  }
}

const readReview = async (
  database: ResourceDatabase,
  projectId: string,
  id: string
) => {
  const row = await database
    .prepare(
      "SELECT review_json, status FROM project_resource_review WHERE id = ? AND project_id = ?"
    )
    .bind(id, projectId)
    .first<{ review_json: string; status: string }>()
  if (!row)
    throw new ResourcePolicyError({ message: "Resource review was not found" })
  return {
    review: Schema.decodeUnknownSync(ResourceMutationReview)(
      JSON.parse(row.review_json)
    ),
    status: row.status,
  }
}

export class ProjectResourceMutations extends Context.Service<
  ProjectResourceMutations,
  {
    review: (
      input: ResourceMutationInput
    ) => Effect.Effect<ResourceMutationReview, ResourcePolicyError>
    confirm: (
      input: typeof ResourceMutationConfirmation.Type
    ) => Effect.Effect<ResourceMutationReview, ResourcePolicyError>
    execute: (
      projectId: string,
      reviewId: string
    ) => Effect.Effect<void, ResourcePolicyError>
  }
>()("sylph/ProjectResourceMutations") {}

export const ProjectResourceMutationsLayer = (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  request: ResourceRequest = fetch
) =>
  Layer.succeed(ProjectResourceMutations, {
    review: Effect.fn("ProjectResourceMutations.review")(
      (input: ResourceMutationInput) =>
        Effect.tryPromise({
          try: async () => {
            const data = Schema.decodeUnknownSync(ResourceMutationInput)(input)
            const review = {
              ...(await buildReview(database, credentials, data, request)),
              id: crypto.randomUUID(),
              expiresAt: Date.now() + 15 * 60 * 1000,
            }
            await database
              .prepare(
                "INSERT INTO project_resource_review (id, project_id, review_json, status) VALUES (?, ?, ?, 'reviewed')"
              )
              .bind(review.id, review.projectId, JSON.stringify(review))
              .run()
            return review
          },
          catch: policyFailure,
        })
    ),
    confirm: Effect.fn("ProjectResourceMutations.confirm")(
      (input: typeof ResourceMutationConfirmation.Type) =>
        Effect.tryPromise({
          try: async () => {
            const { review, status } = await readReview(
              database,
              input.projectId,
              input.reviewId
            )
            const lock = await operationFor(
              database,
              credentials.accountId,
              review.projectId
            )
            if (
              review.accountId === credentials.accountId &&
              ["confirmed", "running"].includes(status) &&
              lock?.run_id === review.id &&
              lock.status === "maintaining" &&
              input.confirmation === `${review.action} production`
            )
              return review
            if (
              review.accountId !== credentials.accountId ||
              status !== "reviewed" ||
              review.expiresAt < Date.now() ||
              input.confirmation !== `${review.action} production`
            )
              throw new ResourcePolicyError({
                message:
                  "Type the exact action and production scope from a current review to confirm",
              })
            const current = await buildReview(
              database,
              credentials,
              review,
              request
            )
            if (
              JSON.stringify(current.inventory) !==
                JSON.stringify(review.inventory) ||
              current.operationRunId !== review.operationRunId
            )
              throw new ResourcePolicyError({
                message:
                  "Resource inventory changed after review; review it again",
              })
            const operation = await operationFor(
              database,
              credentials.accountId,
              review.projectId
            )
            await database.batch([
              database
                .prepare(
                  "UPDATE project_resource_review SET status = CASE WHEN status = 'reviewed' THEN 'confirmed' ELSE NULL END WHERE id = ?"
                )
                .bind(review.id),
              database
                .prepare(
                  `INSERT INTO project_resource_operation (account_id, project_id, scope, run_id, plan_json, status) VALUES (?, ?, 'production', ?, ?, 'maintaining') ON CONFLICT(account_id, project_id, scope) DO UPDATE SET run_id = CASE WHEN project_resource_operation.status = 'complete' AND project_resource_operation.run_id = ? THEN excluded.run_id ELSE NULL END, status = 'maintaining', error = NULL`
                )
                .bind(
                  credentials.accountId,
                  review.projectId,
                  review.id,
                  operation?.plan_json ?? JSON.stringify(review.resources),
                  review.operationRunId
                ),
            ])
            return review
          },
          catch: policyFailure,
        })
    ),
    execute: Effect.fn("ProjectResourceMutations.execute")(
      (projectId: string, reviewId: string) =>
        Effect.tryPromise({
          try: async () => {
            const { review, status } = await readReview(
              database,
              projectId,
              reviewId
            )
            if (status === "complete") return
            const operation = await operationFor(
              database,
              credentials.accountId,
              projectId
            )
            if (
              review.accountId !== credentials.accountId ||
              !["confirmed", "running"].includes(status) ||
              operation?.status !== "maintaining" ||
              operation.run_id !== review.id
            )
              throw new ResourcePolicyError({
                message:
                  "Resource mutation has no current confirmation or ownership lock",
              })
            await database
              .prepare(
                "UPDATE project_resource_review SET status = 'running' WHERE id = ?"
              )
              .bind(review.id)
              .run()
            try {
              for (const item of review.inventory) {
                if (review.action !== "adopt") {
                  const claim = (
                    await readProjectResources(database, projectId)
                  ).find(
                    (resource) =>
                      resource.account_id === credentials.accountId &&
                      resource.scope === review.scope &&
                      resourceKey(resource) === resourceKey(item)
                  )
                  if (
                    !claim ||
                    claim.resource_id !== item.resource_id ||
                    claim.generation !== item.generation ||
                    claim.purpose === "recovery_control" ||
                    ![
                      item.state,
                      review.action === "remove" ? "deleted" : "retired",
                    ].includes(claim.state)
                  )
                    throw new ResourcePolicyError({
                      message: `Resource claim changed for ${item.name}`,
                    })
                }
                const live = await findResource(credentials, item, request)
                if (
                  live &&
                  (live.id !== item.resource_id ||
                    (live.generation ?? null) !== item.generation)
                )
                  throw new ResourcePolicyError({
                    message: `Resource identity changed for ${item.name}`,
                  })
                if (!live && review.action !== "remove")
                  throw new ResourcePolicyError({
                    message: `Resource ${item.name} disappeared after confirmation`,
                  })
              }
              if (review.action === "adopt") {
                await verifyWorkerResources(
                  credentials,
                  review.inventory,
                  request,
                  review.resources
                )
                await verifyRemovalReferences(
                  credentials,
                  review.inventory,
                  request
                )
                await database.batch(
                  review.inventory.map((item) =>
                    database
                      .prepare(
                        "INSERT INTO project_resource (account_id, project_id, scope, kind, name, resource_id, generation, purpose, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'application', 'active') ON CONFLICT(account_id, kind, name) DO UPDATE SET project_id = CASE WHEN project_resource.project_id = excluded.project_id AND project_resource.scope = excluded.scope AND project_resource.resource_id = excluded.resource_id AND project_resource.generation IS excluded.generation AND project_resource.state = 'active' AND project_resource.purpose = 'application' THEN excluded.project_id ELSE NULL END"
                      )
                      .bind(
                        credentials.accountId,
                        projectId,
                        review.scope,
                        item.kind,
                        item.name,
                        item.resource_id,
                        item.generation
                      )
                  )
                )
              } else {
                await verifyRemovalReferences(
                  credentials,
                  review.inventory,
                  request
                )
                if (review.action === "remove")
                  await removeOwnedResources(
                    database,
                    credentials,
                    { projectId, scope: review.scope, runId: review.id },
                    review.inventory,
                    request
                  )
                else
                  await database.batch(
                    review.inventory.map((item) =>
                      database
                        .prepare(
                          "UPDATE project_resource SET state = 'retired' WHERE account_id = ? AND project_id = ? AND scope = 'production' AND kind = ? AND name = ? AND resource_id = ? AND state = 'active' AND purpose = 'application'"
                        )
                        .bind(
                          credentials.accountId,
                          projectId,
                          item.kind,
                          item.name,
                          item.resource_id
                        )
                    )
                  )
              }
              await database.batch([
                database
                  .prepare(
                    "UPDATE project_resource_review SET status = 'complete', error = NULL WHERE id = ?"
                  )
                  .bind(review.id),
                database
                  .prepare(
                    "UPDATE project_resource_operation SET status = 'complete', error = NULL, inspected_at = unixepoch() WHERE account_id = ? AND project_id = ? AND scope = 'production' AND run_id = ?"
                  )
                  .bind(credentials.accountId, projectId, review.id),
              ])
            } catch (cause) {
              const message = policyFailure(cause).message
              await database.batch([
                database
                  .prepare(
                    "UPDATE project_resource_review SET status = 'failed', error = ? WHERE id = ?"
                  )
                  .bind(message, review.id),
                database
                  .prepare(
                    "UPDATE project_resource_operation SET status = 'complete', error = ? WHERE account_id = ? AND project_id = ? AND scope = 'production' AND run_id = ?"
                  )
                  .bind(message, credentials.accountId, projectId, review.id),
              ])
              throw cause
            }
          },
          catch: policyFailure,
        })
    ),
  })
