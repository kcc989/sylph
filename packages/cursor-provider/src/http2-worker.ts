import { connect } from "cloudflare:sockets"
import { setHttp2Connector } from "cursor-opencode-provider/transport"
import { ClientSession } from "./http2-session"

export const installWorkerTransport = () => {
  setHttp2Connector((origin) => {
    const url = new URL(origin)
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !url.hostname.endsWith(".cursor.sh")
    )
      throw new Error("Invalid Cursor transport origin")
    return new ClientSession(
      connect(
        { hostname: url.hostname, port: 443 },
        {
          secureTransport: "on",
          allowHalfOpen: false,
        }
      ),
      url.host
    )
  })
}
