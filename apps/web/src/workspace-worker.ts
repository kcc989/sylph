export { WorkspaceDO } from "./server/workspace-do"

export default {
  fetch() {
    return new Response("Not found", { status: 404 })
  },
}
