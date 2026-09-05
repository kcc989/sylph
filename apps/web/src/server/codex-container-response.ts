export const codexContainerResponse = async (
  request: {
    url: string
    method: string
    headers: Headers
    clone(): { arrayBuffer(): Promise<ArrayBuffer> }
  },
  response: Response,
  send: (request: Request) => Promise<Response>
) => {
  if (
    request.url !== "https://chatgpt.com/backend-api/codex/responses" ||
    response.status !== 403 ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    return response

  const body = await request.clone().arrayBuffer()
  await response.body?.cancel()
  return send(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    })
  )
}
