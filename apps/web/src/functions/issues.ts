import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  CreateIssueInput,
  IssueByNumberInput,
  IssueDetail,
  IssueId,
  IssueSummary,
  UpdateIssueStatusInput,
} from "@workspace/domain"
import { env } from "cloudflare:workers"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { Schema } from "effect"

import { issueMember, projectMember } from "@/functions/middleware"

const decodeCreateIssueInput = Schema.decodeUnknownPromise(CreateIssueInput)
const decodeIssueByNumberInput = Schema.decodeUnknownPromise(IssueByNumberInput)
const decodeUpdateIssueStatusInput = Schema.decodeUnknownPromise(
  UpdateIssueStatusInput
)
const encodeIssueDetail = Schema.encodePromise(IssueDetail)
const encodeIssueSummaryList = Schema.encodePromise(Schema.Array(IssueSummary))
const decodeIssueDetail = Schema.decodeUnknownPromise(IssueDetail)
const decodeIssueSummaryList = Schema.decodeUnknownPromise(
  Schema.Array(IssueSummary)
)

const createIssueRow = async (
  projectId: string,
  organizationId: string,
  userId: string,
  title: string,
  body: string
) =>
  env.DB.prepare(
    "INSERT INTO issue (id, organization_id, project_id, number, title, body, created_by_user_id) SELECT ?, ?, ?, coalesce(max(number), 0) + 1, ?, ?, ? FROM issue WHERE project_id = ? RETURNING id, number"
  )
    .bind(
      crypto.randomUUID(),
      organizationId,
      projectId,
      title,
      body,
      userId,
      projectId
    )
    .first<{ id: string; number: number }>()

const isIssueNumberConflict = (cause: unknown) =>
  cause instanceof Error &&
  cause.message.includes("issue.project_id, issue.number")

export const createIssue = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator((input) => decodeCreateIssueInput(input))
  .handler(async ({ data, context }) => {
    const title = data.title.trim()
    let row: { id: string; number: number } | null
    try {
      row = await createIssueRow(
        context.project.id,
        context.project.organizationId,
        context.user.id,
        title,
        data.body?.trim() ?? ""
      )
    } catch (cause) {
      if (!isIssueNumberConflict(cause)) throw cause
      row = await createIssueRow(
        context.project.id,
        context.project.organizationId,
        context.user.id,
        title,
        data.body?.trim() ?? ""
      )
    }
    if (!row) throw new Error("The Issue could not be created")
    return { id: IssueId.make(row.id), number: row.number }
  })

export const getIssue = createServerFn({ method: "GET" })
  .middleware([projectMember])
  .validator((input) => decodeIssueByNumberInput(input))
  .handler(async ({ data, context }) => {
    const row = await context.database
      .select({
        id: schema.issue.id,
        projectId: schema.issue.projectId,
        number: schema.issue.number,
        title: schema.issue.title,
        body: schema.issue.body,
        status: schema.issue.status,
        createdByUserId: schema.issue.createdByUserId,
        createdAt: schema.issue.createdAt,
        updatedAt: schema.issue.updatedAt,
      })
      .from(schema.issue)
      .where(
        and(
          eq(schema.issue.projectId, data.projectId),
          eq(schema.issue.number, data.number)
        )
      )
      .get()
    if (!row) return null
    return encodeIssueDetail(
      await decodeIssueDetail({
        ...row,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      })
    )
  })

export const listProjectIssues = createServerFn({ method: "GET" })
  .middleware([projectMember])
  .handler(async ({ context }) => {
    const rows = await context.database
      .select({
        id: schema.issue.id,
        projectId: schema.issue.projectId,
        number: schema.issue.number,
        title: schema.issue.title,
        status: schema.issue.status,
        createdAt: schema.issue.createdAt,
        updatedAt: schema.issue.updatedAt,
      })
      .from(schema.issue)
      .where(eq(schema.issue.projectId, context.project.id))
      .orderBy(
        asc(sql`CASE WHEN ${schema.issue.status} = 'open' THEN 0 ELSE 1 END`),
        desc(schema.issue.updatedAt)
      )
    return encodeIssueSummaryList(
      await decodeIssueSummaryList(
        rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.getTime(),
          updatedAt: row.updatedAt.getTime(),
        }))
      )
    )
  })

export const updateIssueStatus = createServerFn({ method: "POST" })
  .middleware([issueMember])
  .validator((input) => decodeUpdateIssueStatusInput(input))
  .handler(async ({ data, context }) => {
    const updatedAt = new Date()
    await context.database
      .update(schema.issue)
      .set({
        status: data.status,
        closedAt: data.status === "closed" ? updatedAt : null,
        updatedAt,
      })
      .where(eq(schema.issue.id, context.issue.id))
    return { status: data.status }
  })
