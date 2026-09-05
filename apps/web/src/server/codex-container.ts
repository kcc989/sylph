import { Container } from "@cloudflare/containers"

const server = `
const http = require("node:http");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/backend-api/codex/responses") {
    response.writeHead(404).end();
    return;
  }
  const controller = new AbortController();
  response.on("close", () => controller.abort());
  try {
    const headers = new Headers();
    for (const name of ["authorization", "content-type", "accept", "chatgpt-account-id", "originator", "session-id", "openai-beta", "user-agent"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const upstream = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST", headers, body: request, duplex: "half", signal: controller.signal,
      redirect: "error"
    });
    response.statusCode = upstream.status;
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
    else response.end();
  } catch {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  }
}).listen(8080, "0.0.0.0");
`

export class CodexContainer extends Container {
  defaultPort = 8080
  sleepAfter = "2m"
  entrypoint = ["node", "-e", server]
}
