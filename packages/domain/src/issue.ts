import { Schema } from "effect"

import { IssueId, ProjectId } from "./ids"

export const IssueStatus = Schema.Literals(["open", "closed"])
export type IssueStatus = typeof IssueStatus.Type

export class IssueSummary extends Schema.Class<IssueSummary>(
  "@sylph/domain/IssueSummary"
)({
  id: IssueId,
  projectId: ProjectId,
  number: Schema.Int,
  title: Schema.NonEmptyString,
  status: IssueStatus,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class IssueDetail extends Schema.Class<IssueDetail>(
  "@sylph/domain/IssueDetail"
)({
  id: IssueId,
  projectId: ProjectId,
  number: Schema.Int,
  title: Schema.NonEmptyString,
  body: Schema.String,
  status: IssueStatus,
  createdByUserId: Schema.NonEmptyString,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class CreateIssueInput extends Schema.Class<CreateIssueInput>(
  "@sylph/domain/CreateIssueInput"
)({
  projectId: ProjectId,
  title: Schema.NonEmptyString,
  body: Schema.optional(Schema.String),
}) {}

export class IssueRequestInput extends Schema.Class<IssueRequestInput>(
  "@sylph/domain/IssueRequestInput"
)({
  issueId: IssueId,
}) {}

export class IssueByNumberInput extends Schema.Class<IssueByNumberInput>(
  "@sylph/domain/IssueByNumberInput"
)({
  projectId: ProjectId,
  number: Schema.Int,
}) {}

export class UpdateIssueStatusInput extends Schema.Class<UpdateIssueStatusInput>(
  "@sylph/domain/UpdateIssueStatusInput"
)({
  issueId: IssueId,
  status: IssueStatus,
}) {}
