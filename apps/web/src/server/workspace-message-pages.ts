type WorkspaceMessagePageInput = {
  sessionID: string
  limit: number
  order?: "asc"
  cursor?: string
}

type WorkspaceMessagePage<Message> = {
  data: ReadonlyArray<Message>
  cursor: {
    next?: string | null
  }
}

export const listWorkspaceMessages = async <Message>(
  sessionId: string,
  list: (
    input: WorkspaceMessagePageInput
  ) => Promise<WorkspaceMessagePage<Message>>
) => {
  const messages: Message[] = []
  let cursor: string | undefined

  do {
    const page = await list(
      cursor
        ? { sessionID: sessionId, limit: 100, cursor }
        : { sessionID: sessionId, limit: 100, order: "asc" }
    )
    messages.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  return messages
}
