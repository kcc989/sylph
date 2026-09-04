export const workspaceMessagePageSize = 20

type WorkspaceMessagePageInput = {
  sessionID: string
  limit: number
  order?: "desc"
  cursor?: string
}

type WorkspaceMessagePage<Message> = {
  data: ReadonlyArray<Message>
  cursor: { next?: string | null }
}

export const listWorkspaceMessages = async <Message>(
  sessionId: string,
  list: (
    input: WorkspaceMessagePageInput
  ) => Promise<WorkspaceMessagePage<Message>>,
  cursor?: string
) => {
  const page = await list(
    cursor
      ? { sessionID: sessionId, limit: workspaceMessagePageSize, cursor }
      : { sessionID: sessionId, limit: workspaceMessagePageSize, order: "desc" }
  )
  return {
    messages: [...page.data].reverse(),
    cursor:
      page.data.length < workspaceMessagePageSize
        ? null
        : (page.cursor.next ?? null),
  }
}
