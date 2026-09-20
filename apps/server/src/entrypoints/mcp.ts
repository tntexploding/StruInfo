import {materializeExternalSecretEnvironment} from '../config/external_secret_environment.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createAgentMcpServer} from '../transport/agent_mcp.js';

const base = new URL(
  process.env.STRUIINFO_AGENT_URL ?? 'http://127.0.0.1:3000',
);
if (
  (base.protocol !== 'https:' &&
    !(
      base.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    )) ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash
)
  throw new Error(
    'Use an HTTPS origin or a loopback HTTP origin for STRUIINFO_AGENT_URL.',
  );
const token = materializeExternalSecretEnvironment({
  STRUIINFO_AGENT_TOKEN: process.env.STRUIINFO_AGENT_TOKEN,
  STRUIINFO_AGENT_TOKEN_FILE: process.env.STRUIINFO_AGENT_TOKEN_FILE,
}).STRUIINFO_AGENT_TOKEN;
if (!token || token.length < 32)
  throw new Error(
    'Set STRUIINFO_AGENT_TOKEN in external environment configuration.',
  );
const server = createAgentMcpServer(async (operation, input) => {
  const response = await fetch(new URL('/api/v1/agent/commands', base), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({operation, input}),
  });
  const result: unknown = await response.json();
  // Return safe server error codes so the Agent can refresh stale versions.
  return {
    status: response.status,
    ...(typeof result === 'object' && result !== null
      ? result
      : {error: {code: 'invalid_server_response'}}),
  };
});
await server.connect(new StdioServerTransport());
