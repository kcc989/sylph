import { randomBytes } from "node:crypto"
import { createServer, constants } from "node:http2"
const server = createServer({ settings: { initialWindowSize: 1024 } })
server.on("stream", (stream, headers) => {
  if (headers[":path"] === "/reset") {
    stream.close(constants.NGHTTP2_CANCEL)
    return
  }
  if (headers[":path"] === "/headers") {
    stream.respond(
      { ":status": 200, "x-long": randomBytes(24000).toString("base64") },
      { waitForTrailers: true }
    )
    stream.on("wantTrailers", () =>
      stream.sendTrailers({ "x-complete": "yes" })
    )
    stream.end("done")
    return
  }
  stream.respond({ ":status": 200, "x-header": "compressed-value" })
  stream.on("data", (data) => stream.write(data))
  stream.on("end", () => stream.end())
  stream.on("error", () => undefined)
})
server.listen(0, "127.0.0.1", () =>
  process.stdout.write(`${server.address().port}\n`)
)
