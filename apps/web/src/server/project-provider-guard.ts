import { ProviderConnectionRequired } from "@workspace/domain"

export const requireProjectProviderConnection = <Connection>(
  connection: Connection | null | undefined
): Connection => {
  if (!connection) {
    throw new ProviderConnectionRequired({
      message: "Connect an AI provider before creating a Project",
    })
  }
  return connection
}
