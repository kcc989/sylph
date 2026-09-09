export type DesktopErrorKind = "invalidUrl" | "insecureScheme" | "storage"

export type DesktopError = {
  kind: DesktopErrorKind
  message: string
}

export type CommandRejection = Partial<DesktopError> | null | undefined

export const commandChannelMessage =
  "Sylph could not run this command. Restart Sylph and try again."

export const desktopError = (rejection: CommandRejection): DesktopError => {
  const kind = rejection?.kind
  const message = rejection?.message
  return kind === undefined || message === undefined
    ? { kind: "storage", message: commandChannelMessage }
    : { kind, message }
}
