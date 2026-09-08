import { Container } from "@cloudflare/containers"

export class CursorRuntimeContainer extends Container {
  defaultPort = 8080
  sleepAfter = "10m"

  override async fetch(request: Request) {
    const response = await this.containerFetch(request)
    if (response.status === 500)
      console.error(
        "Cursor container proxy failed",
        (await response.clone().text()).slice(0, 2000)
      )
    return response
  }
}
