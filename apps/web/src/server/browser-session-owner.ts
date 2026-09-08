export type OwnedBrowserSession = {
  id: string
  connected(): boolean
  close(): Promise<void>
}

export const browserSessionOwner = <
  Session extends OwnedBrowserSession,
  Policy,
>(
  create: (policy: Policy) => Promise<Session>,
  idleTimeout: number
) => {
  let current: { session: Session; policy: string } | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  const close = async (id?: string) => {
    if (!current || (id && current.session.id !== id)) return false
    const session = current.session
    current = undefined
    clearTimeout(idle)
    idle = undefined
    await session.close()
    return true
  }
  return {
    close,
    async acquire(policy: Policy, id?: string) {
      clearTimeout(idle)
      idle = undefined
      if (id) {
        if (
          !current ||
          current.session.id !== id ||
          current.policy !== JSON.stringify(policy) ||
          !current.session.connected()
        ) {
          await close()
          throw new Error(
            "The browser session owner disconnected or its policy changed. Start a new session and sign in again."
          )
        }
        return current.session
      }
      await close()
      const session = await create(policy)
      current = { session, policy: JSON.stringify(policy) }
      return session
    },
    release(session: Session) {
      if (current?.session !== session) return
      clearTimeout(idle)
      idle = setTimeout(() => {
        void close(session.id).catch(() => undefined)
      }, idleTimeout)
    },
  }
}
