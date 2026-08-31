import {
  decodeGitHubApiRepositoryJson,
  GitHubRepositoryInfo,
} from "@workspace/domain"
import { Context, Effect, Layer, Schema } from "effect"

export class GitHubRepositoryError extends Schema.TaggedError<GitHubRepositoryError>()(
  "GitHubRepositoryError",
  {
    operation: Schema.NonEmptyString,
    status: Schema.Int,
    message: Schema.String,
  }
) {}

export class GitHubRepositoryService extends Context.Service<
  GitHubRepositoryService,
  {
    readonly inspect: (input: {
      owner: string
      name: string
      accessToken?: string
    }) => Effect.Effect<GitHubRepositoryInfo, GitHubRepositoryError>
    readonly ensurePullRequest: (input: {
      owner: string
      name: string
      accessToken: string
      head: string
      base: string
      title: string
      body: string
    }) => Effect.Effect<string, GitHubRepositoryError>
    readonly refreshUserAccessToken: (input: {
      clientId: string
      clientSecret: string
      refreshToken: string
    }) => Effect.Effect<
      {
        accessToken: string
        refreshToken: string
        expiresIn: number
        refreshTokenExpiresIn: number
      },
      GitHubRepositoryError
    >
  }
>()("@sylph/web/GitHubRepositoryService") {}

const PullRequestResponse = Schema.Struct({ html_url: Schema.NonEmptyString })
const PullRequestListResponse = Schema.Array(PullRequestResponse)
const RefreshTokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  expires_in: Schema.Int,
  refresh_token_expires_in: Schema.Int,
})
type GitHubRequest = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => Promise<Response>

const githubHeaders = (accessToken?: string) => {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "Sylph",
    "X-GitHub-Api-Version": "2022-11-28",
  })
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
  return headers
}

const responseError = async (operation: string, response: Response) => {
  const fallback =
    response.status === 401
      ? "Reconnect GitHub and try again."
      : response.status === 403
        ? "The GitHub App needs access to this Repository."
        : response.status === 404
          ? "Repository not found or not granted to the GitHub App."
          : "GitHub could not complete the Repository operation."
  return new GitHubRepositoryError({
    operation,
    status: response.status,
    message: fallback,
  })
}

const makeGitHubRepositoryService = (
  request: GitHubRequest
): GitHubRepositoryService["Service"] =>
  GitHubRepositoryService.of({
    inspect: Effect.fn("GitHubRepositoryService.inspect")(function* (input) {
      return yield* Effect.tryPromise({
        try: async () => {
          const response = await request(
            `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}`,
            { headers: githubHeaders(input.accessToken) }
          )
          if (!response.ok) throw await responseError("inspect", response)
          const repository = await Effect.runPromise(
            decodeGitHubApiRepositoryJson(await response.text())
          )
          return new GitHubRepositoryInfo({
            owner: repository.owner.login,
            name: repository.name,
            fullName: repository.full_name,
            description: repository.description,
            visibility: repository.private ? "private" : "public",
            defaultBranch: repository.default_branch,
            stars: repository.stargazers_count,
            language: repository.language,
            updatedAt: repository.updated_at,
            url: repository.html_url,
            ownerAvatarUrl: repository.owner.avatar_url,
          })
        },
        catch: (cause) =>
          cause instanceof GitHubRepositoryError
            ? cause
            : new GitHubRepositoryError({
                operation: "inspect",
                status: 0,
                message: "GitHub could not load this Repository.",
              }),
      })
    }),
    ensurePullRequest: Effect.fn("GitHubRepositoryService.ensurePullRequest")(
      function* (input) {
        return yield* Effect.tryPromise({
          try: async () => {
            const query = new URLSearchParams({
              state: "open",
              head: `${input.owner}:${input.head}`,
              base: input.base,
            })
            const existingResponse = await request(
              `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/pulls?${query}`,
              { headers: githubHeaders(input.accessToken) }
            )
            if (!existingResponse.ok) {
              throw await responseError("find_pull_request", existingResponse)
            }
            const existing = await Schema.decodeUnknownPromise(
              PullRequestListResponse
            )(await existingResponse.json())
            if (existing[0]) return existing[0].html_url
            const headers = githubHeaders(input.accessToken)
            headers.set("content-type", "application/json")
            const response = await request(
              `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/pulls`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  title: input.title,
                  body: input.body,
                  head: input.head,
                  base: input.base,
                }),
              }
            )
            if (!response.ok) {
              throw await responseError("create_pull_request", response)
            }
            const pullRequest = await Schema.decodeUnknownPromise(
              PullRequestResponse
            )(await response.json())
            return pullRequest.html_url
          },
          catch: (cause) =>
            cause instanceof GitHubRepositoryError
              ? cause
              : new GitHubRepositoryError({
                  operation: "create_pull_request",
                  status: 0,
                  message: "GitHub could not create the pull request.",
                }),
        })
      }
    ),
    refreshUserAccessToken: Effect.fn(
      "GitHubRepositoryService.refreshUserAccessToken"
    )(function* (input) {
      return yield* Effect.tryPromise({
        try: async () => {
          const response = await request(
            "https://github.com/login/oauth/access_token",
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "content-type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: input.clientId,
                client_secret: input.clientSecret,
                refresh_token: input.refreshToken,
              }),
            }
          )
          if (!response.ok) {
            throw await responseError("refresh_user_access_token", response)
          }
          const token = await Schema.decodeUnknownPromise(RefreshTokenResponse)(
            await response.json()
          )
          return {
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresIn: token.expires_in,
            refreshTokenExpiresIn: token.refresh_token_expires_in,
          }
        },
        catch: (cause) =>
          cause instanceof GitHubRepositoryError
            ? cause
            : new GitHubRepositoryError({
                operation: "refresh_user_access_token",
                status: 0,
                message: "Reconnect GitHub and try again.",
              }),
      })
    }),
  })

export const GitHubRepositoryLive = Layer.succeed(
  GitHubRepositoryService,
  makeGitHubRepositoryService(fetch)
)

export const githubRepositoryTestLayer = (request: GitHubRequest) =>
  Layer.succeed(GitHubRepositoryService, makeGitHubRepositoryService(request))
