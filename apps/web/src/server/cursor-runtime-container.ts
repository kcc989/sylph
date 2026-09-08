import { Container } from "@cloudflare/containers"

export class CursorRuntimeContainer extends Container {
  defaultPort = 8080
  sleepAfter = "10m"
}
