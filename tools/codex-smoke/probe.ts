import { Container } from "@cloudflare/containers"

const probe = `
const http = require('node:http');
http.createServer(async (_request, response) => {
  try {
    const upstream = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({model:'gpt-5.6-sol', input:'Reply OK', stream:true, store:false})
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({status:upstream.status, type:upstream.headers.get('content-type'), body:(await upstream.text()).slice(0,1000)}));
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
}).listen(8080, '0.0.0.0');
`

export class CodexProbe extends Container {
  defaultPort = 8080
  sleepAfter = "30s"
  entrypoint = ["node", "-e", probe]
}

export default {
  fetch(request: Request, env: { PROBE: DurableObjectNamespace<CodexProbe> }) {
    return env.PROBE.get(env.PROBE.idFromName("anonymous-probe")).fetch(request)
  },
}
