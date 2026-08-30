import { Effect, Schema } from "effect"

import { OrganizationId } from "./ids"

export class GitHubRepositoryLookupInput extends Schema.Class<GitHubRepositoryLookupInput>(
  "@sylph/domain/GitHubRepositoryLookupInput"
)({
  organizationId: OrganizationId,
  url: Schema.NonEmptyString,
}) {}

export class GitHubRepositoryOwner extends Schema.Class<GitHubRepositoryOwner>(
  "@sylph/domain/GitHubRepositoryOwner"
)({
  login: Schema.NonEmptyString,
  avatar_url: Schema.NonEmptyString,
}) {}

export class GitHubApiRepository extends Schema.Class<GitHubApiRepository>(
  "@sylph/domain/GitHubApiRepository"
)({
  name: Schema.NonEmptyString,
  full_name: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  private: Schema.Boolean,
  default_branch: Schema.NonEmptyString,
  stargazers_count: Schema.Number,
  language: Schema.NullOr(Schema.String),
  updated_at: Schema.NonEmptyString,
  html_url: Schema.NonEmptyString,
  owner: GitHubRepositoryOwner,
}) {}

export class GitHubRepositoryInfo extends Schema.Class<GitHubRepositoryInfo>(
  "@sylph/domain/GitHubRepositoryInfo"
)({
  owner: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  fullName: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  visibility: Schema.Literals(["public", "private"]),
  defaultBranch: Schema.NonEmptyString,
  stars: Schema.Number,
  language: Schema.NullOr(Schema.String),
  updatedAt: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  ownerAvatarUrl: Schema.NonEmptyString,
}) {}

export class InvalidGitHubRepositoryUrl extends Schema.TaggedError<InvalidGitHubRepositoryUrl>()(
  "InvalidGitHubRepositoryUrl",
  {
    message: Schema.String,
  }
) {}

export const decodeGitHubRepositoryLookupInput = Schema.decodeUnknownEffect(
  GitHubRepositoryLookupInput
)

export const decodeGitHubRepositoryLookupInputPromise =
  Schema.decodeUnknownPromise(GitHubRepositoryLookupInput)

export const decodeGitHubApiRepositoryJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(GitHubApiRepository)
)

export const decodeGitHubApiRepositoryJsonPromise = Schema.decodeUnknownPromise(
  Schema.fromJsonString(GitHubApiRepository)
)

export const encodeGitHubRepositoryInfo =
  Schema.encodePromise(GitHubRepositoryInfo)

export const parseGitHubRepositoryUrl = Effect.fn("parseGitHubRepositoryUrl")(
  function* (repositoryUrl: string) {
    const url = yield* Effect.try({
      try: () => new URL(repositoryUrl),
      catch: () =>
        new InvalidGitHubRepositoryUrl({
          message: "Enter a valid GitHub repository URL.",
        }),
    })

    const pathSegments = url.pathname.split("/").filter(Boolean)
    const [owner, repositoryName, ...remainingSegments] = pathSegments

    if (
      url.hostname !== "github.com" ||
      owner === undefined ||
      repositoryName === undefined ||
      remainingSegments.length > 0
    ) {
      return yield* new InvalidGitHubRepositoryUrl({
        message: "Use a repository URL like github.com/owner/repository.",
      })
    }

    const name = repositoryName.endsWith(".git")
      ? repositoryName.slice(0, -4)
      : repositoryName

    if (name.length === 0) {
      return yield* new InvalidGitHubRepositoryUrl({
        message: "The repository name cannot be empty.",
      })
    }

    return { owner, name }
  }
)
