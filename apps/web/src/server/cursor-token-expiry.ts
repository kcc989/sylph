import { CursorAccessTokenClaims } from "@workspace/domain/cursor-provider"
import { Schema } from "effect"

const decodeClaims = Schema.decodeUnknownSync(CursorAccessTokenClaims)

export const cursorTokenExpiresAt = (token: string) => {
  try {
    const segment = token.split(".")[1]
    if (!segment) return 0
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/")
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
    const claims = decodeClaims(JSON.parse(atob(padded)))
    return Number.isFinite(claims.exp) ? claims.exp * 1000 : 0
  } catch {
    return 0
  }
}
