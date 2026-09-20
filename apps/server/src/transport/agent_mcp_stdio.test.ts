import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {describe, it, expect} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
describe('MCP executable', () => {
  it('starts over stdio and forwards only the authenticated business command', async () => {
    const requests: {
      url: string | undefined;
      authorization: string | undefined;
      body: unknown;
    }[] = [];
    const token = 'synthetic-agent-token-'.repeat(3);
    const http = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (part: string) => {
        body += part;
      });
      request.on('end', () => {
        requests.push({
          url: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(body) as unknown,
        });
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({result: {documents: []}}));
      });
    });
    await new Promise<void>((resolve) => {
      http.listen(0, '127.0.0.1', resolve);
    });
    const address = http.address();
    if (!address || typeof address === 'string')
      throw new Error('Synthetic listener unavailable');
    const client = new Client({name: 'synthetic-stdio-client', version: '1'});
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('../entrypoints/mcp.ts', import.meta.url)),
      ],
      env: {
        STRUIINFO_AGENT_URL: 'http://127.0.0.1:' + String(address.port),
        STRUIINFO_AGENT_TOKEN: token,
      },
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: 'documents_list',
        arguments: {},
      });
      expect(result.isError).toBe(false);
      expect(requests).toEqual([
        {
          url: '/api/v1/agent/commands',
          authorization: 'Bearer ' + token,
          body: {operation: 'documents_list', input: {limit: 20, text: ''}},
        },
      ]);
      const queue = await client.callTool({
        name: 'ingestion_status',
        arguments: {status: 'attention'},
      });
      expect(queue.isError).toBe(false);
      expect(requests[1]?.body).toEqual({
        operation: 'ingestion_status',
        input: {limit: 50, status: 'attention'},
      });
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => {
        http.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }, 20_000);
});
