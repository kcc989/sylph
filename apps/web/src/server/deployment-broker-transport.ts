export const deploymentBrokerPreload = `
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const source = input instanceof Request ? input.url : String(input);
  const url = new URL(source);
  if (url.origin !== 'https://api.cloudflare.com' || !url.pathname.startsWith('/client/v4/')) return originalFetch(input, init);
  if (url.pathname.endsWith('/workers/assets/upload')) return originalFetch(input, init);
  const target = process.env.SYLPH_CLOUDFLARE_API_BASE_URL + url.pathname.slice('/client/v4'.length) + url.search;
  const request = new Request(input, init);
  return originalFetch(new Request(target, request));
};
`
