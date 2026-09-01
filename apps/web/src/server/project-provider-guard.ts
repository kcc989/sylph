export const requireProjectProviderConnection = <Connection>(
  connection: Connection | null | undefined
): Connection => {
  if (!connection) {
    throw new Error("Connect an AI provider before creating a Project")
  }
  return connection
}
