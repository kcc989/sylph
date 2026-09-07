import {
  ResourcePolicyError,
  type ProjectResourcePlan,
  type PlannedProjectResource,
} from "@workspace/domain/project-resources"

export const resourceKey = (resource: PlannedProjectResource) =>
  `${resource.kind}:${resource.name}`

export const entryWorker = (plan: ProjectResourcePlan) => {
  const workers = plan.filter((resource) => resource.kind === "worker")
  const entry = workers.filter((resource) => resource.entrypoint)
  if (workers.length === 1 && entry.length === 0) return workers[0]
  if (entry.length !== 1)
    throw new ResourcePolicyError({
      message: "Select exactly one entrypoint Worker in a multi-Worker plan",
    })
  return entry[0]
}

export const validateResourceTopology = (plan: ProjectResourcePlan) => {
  if (
    !plan.length ||
    plan.length > 20 ||
    !plan.some((item) => item.kind === "worker")
  )
    throw new ResourcePolicyError({
      message:
        "A resource plan needs at least one Worker and at most 20 resources",
    })
  entryWorker(plan)
  const keys = new Set<string>()
  for (const resource of plan) {
    if (keys.has(resourceKey(resource)))
      throw new ResourcePolicyError({
        message: `Duplicate resource ${resource.name}`,
      })
    keys.add(resourceKey(resource))
    if (resource.purpose === "recovery_control" && resource.kind !== "d1")
      throw new ResourcePolicyError({
        message: "Recovery control must use a separate D1 database",
      })
    if (["durable_object", "workflow"].includes(resource.kind)) {
      if (
        !resource.worker ||
        !resource.className ||
        !/^[A-Za-z_$][\w$]*$/.test(resource.className) ||
        !plan.some(
          (item) => item.kind === "worker" && item.name === resource.worker
        )
      )
        throw new ResourcePolicyError({
          message: `${resource.name} needs a className and a host Worker in this plan`,
        })
      if (
        resource.kind === "durable_object" &&
        resource.name !== `${resource.worker}/${resource.className}`
      )
        throw new ResourcePolicyError({
          message:
            "Durable Object names must be <worker>/<className>; namespace IDs are recorded after deployment",
        })
    } else if (
      resource.worker &&
      (resource.kind !== "domain" ||
        !plan.some(
          (item) => item.kind === "worker" && item.name === resource.worker
        ))
    ) {
      throw new ResourcePolicyError({
        message: `Invalid host Worker for ${resource.name}`,
      })
    }
    if (resource.bindings && resource.kind !== "worker")
      throw new ResourcePolicyError({
        message: "Only Workers declare bindings",
      })
    const bindings = new Set<string>()
    for (const binding of resource.bindings ?? []) {
      if (bindings.has(binding.name))
        throw new ResourcePolicyError({
          message: `Duplicate binding ${binding.name}`,
        })
      bindings.add(binding.name)
      if (binding.type === "ai") {
        if (binding.target || binding.entrypoint)
          throw new ResourcePolicyError({
            message:
              "Workers AI is an account capability, not an owned resource",
          })
        continue
      }
      const kind =
        binding.type === "service"
          ? "worker"
          : binding.type === "workflow"
            ? "workflow"
            : "durable_object"
      if (
        !plan.some((item) => item.kind === kind && item.name === binding.target)
      )
        throw new ResourcePolicyError({
          message: `Binding ${binding.name} must reference a ${kind} in this Project plan; cross-Project bindings are unsupported`,
        })
      if (binding.entrypoint && binding.type !== "service")
        throw new ResourcePolicyError({
          message: "Only service bindings support a named entrypoint",
        })
    }
  }
  return plan
}
