export const installationOrigin = (request: Request, configured: string) => {
  const origin = new URL(configured || request.url)
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  ) {
    throw new Error("The Installation address must use HTTPS")
  }
  return origin.origin
}

export const canonicalInstallationResponse = (
  request: Request,
  configured: string
) => {
  if (!configured) return null
  const url = new URL(request.url)
  const origin = installationOrigin(request, configured)
  if (url.origin === origin) return null
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Use the Installation's primary address", {
      status: 421,
    })
  }
  return Response.redirect(`${origin}${url.pathname}${url.search}`, 307)
}
