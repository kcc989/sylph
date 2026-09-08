import {
  CursorProviderError,
  sanitizeHostTerminalMessage,
} from "cursor-opencode-provider/errors"

export const cursorFailureMessage = (error: unknown) =>
  error instanceof CursorProviderError
    ? sanitizeHostTerminalMessage(error.message).slice(0, 1000)
    : "Cursor model request failed"
