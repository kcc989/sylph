import { createSessionScope } from "cursor-opencode-provider/session"
import { handleCursorRequest } from "./handler"
import { installWorkerTransport } from "./http2-worker"

export const createWorkerCursorHandler = (userKey: string) => {
  installWorkerTransport()
  const scope = createSessionScope()
  return {
    fetch: (request: Request) =>
      scope.run(() => handleCursorRequest(request, `/tmp/cursor-${userKey}`)),
    dispose: () => scope.dispose(),
  }
}
