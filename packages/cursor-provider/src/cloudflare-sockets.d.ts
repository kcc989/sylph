declare module "cloudflare:sockets" {
  export function connect(
    address: { hostname: string; port: number },
    options: { secureTransport: "on"; allowHalfOpen: boolean }
  ): import("./http2-session").TransportSocket
}
