import {describe, expect, it, vi} from 'vitest';
import {McpSourceConnector} from './mcp_source_connector.js';

function fixture(
  structured = false,
  options: {
    pagination?: boolean;
    limit?: number;
    response?: (args: Record<string, unknown>) => unknown;
  } = {},
) {
  const methods: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer synthetic-token',
    );
    expect(init?.redirect).toBe('error');
    if (init?.method === 'GET') return new Response(null, {status: 405});
    if (init?.method === 'DELETE') return new Response(null, {status: 204});
    const message = JSON.parse(await new Response(init?.body).text()) as {
      id?: number;
      method: string;
      params?: {name?: string; arguments?: Record<string, unknown>};
    };
    methods.push(message.method);
    if (message.method.startsWith('notifications/'))
      return new Response(null, {status: 202});
    const data = (message.method === 'tools/call'
      ? options.response?.(message.params?.arguments ?? {})
      : undefined) ?? {
      status: 200,
      data: {
        items: [
          {
            id: 'synthetic-flash',
            title: '',
            content: 'Synthetic complete flash.',
            time: '2040-01-02 08:30:00',
            url: 'https://example.com/documents/synthetic-flash',
          },
        ],
      },
    };
    if (message.method === 'tools/call')
      expect(message.params?.name).toBe('list_documents');
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            capabilities: {tools: {}},
            serverInfo: {name: 'synthetic', version: '1'},
          }
        : message.method === 'tools/list'
          ? {
              tools: [
                {
                  name: 'list_documents',
                  inputSchema: {type: 'object', properties: {}},
                },
              ],
            }
          : structured
            ? {content: [], structuredContent: data}
            : {content: [{type: 'text', text: JSON.stringify(data)}]};
    const json = JSON.stringify({jsonrpc: '2.0', id: message.id, result});
    const sse = structured && message.method === 'tools/call';
    return new Response(sse ? `event: message\ndata: ${json}\n\n` : json, {
      headers: {'content-type': sse ? 'text/event-stream' : 'application/json'},
    });
  });
  const readEnvironment = (name: string) =>
    name === 'MCP_SOURCE'
      ? JSON.stringify({
          serverUrl: 'https://mcp.example.com/mcp',
          headers: {Authorization: 'Bearer synthetic-token'},
          tool: 'list_documents',
          arguments: {limit: 20},
          recordLimit: options.limit ?? 20,
          ...(options.pagination
            ? {
                pagination: {
                  cursorArgument: 'cursor',
                  nextCursorPath: 'data.next_cursor',
                  hasMorePath: 'data.has_more',
                },
              }
            : {}),
          recordsPath: 'data.items',
          externalIdPath: 'id',
          bodyPath: 'content',
          titlePath: 'title',
          canonicalUriPath: 'url',
          publishedAtPath: 'time',
          timeZoneOffset: '+08:00',
          success: {path: 'status', value: 200},
        })
      : undefined;
  return {
    fetcher,
    methods,
    connector: new McpSourceConnector({
      fetch: fetcher,
      readEnvironment,
      resolveAddresses: () => Promise.resolve(['93.184.216.34']),
    }),
  };
}
const request = {
  subscriptionId: '22222222-2222-4222-8222-222222222222',
  configuration: {configurationRef: 'MCP_SOURCE'},
};

describe('MCP receiver', () => {
  it('captures the first page, drains new pages from a checkpoint, and returns to the latest head', async () => {
    let latest = 3;
    const requested: number[] = [];
    const f = fixture(true, {
      pagination: true,
      limit: 4,
      response: (args) => {
        const first = typeof args.cursor === 'number' ? args.cursor : latest;
        requested.push(first);
        const ids = [first, first - 1, first - 2].filter((id) => id > 0);
        return {
          status: 200,
          data: {
            items: ids.map((id) => ({
              id,
              content: 'Synthetic item ' + String(id),
              url: 'https://example.com/item/' + String(id),
            })),
            has_more: first > 3,
            next_cursor: first - 3,
          },
        };
      },
    });
    const read = async (cursor?: string) =>
      f.connector.read({
        ...request,
        ...(cursor ? {previousCursor: cursor} : {}),
      });
    const first = await read();
    expect(requested).toEqual([3]);
    latest = 12;
    const second = await read(first.cursor);
    expect(
      second.status === 'changed' && second.documents.map((d) => d.externalId),
    ).toEqual(['12', '11', '10', '9']);
    expect(second.hasMore).toBe(true);
    expect(second.cursor.length).toBeLessThanOrEqual(2048);
    latest = 14;
    const third = await read(second.cursor);
    expect(
      third.status === 'changed' && third.documents.map((d) => d.externalId),
    ).toEqual(['8', '7', '6', '5']);
    const fourth = await read(third.cursor);
    expect(
      fourth.status === 'changed' && fourth.documents.map((d) => d.externalId),
    ).toEqual(['4']);
    expect(fourth.hasMore).toBeUndefined();
    const fifth = await read(fourth.cursor);
    expect(
      fifth.status === 'changed' && fifth.documents.map((d) => d.externalId),
    ).toEqual(['14', '13']);
    expect((await read(fifth.cursor)).status).toBe('unchanged');
  });
  it('rejects a repeated upstream page cursor without returning an advanced checkpoint', async () => {
    const f = fixture(true, {
      pagination: true,
      response: () => ({
        status: 200,
        data: {items: [], has_more: true, next_cursor: 'same'},
      }),
    });
    await expect(
      f.connector.read({
        ...request,
        previousCursor: Buffer.from(
          JSON.stringify({version: 1, tokens: ['1234567890123456']}),
        ).toString('base64url'),
      }),
    ).rejects.toMatchObject({code: 'connector_result_invalid'});
  });
  it.each([false, true])(
    'maps an owner-selected tool response and skips unchanged items (%s)',
    async (structured) => {
      const f = fixture(structured);
      const first = await f.connector.read(request);
      expect(first.status).toBe('changed');
      if (first.status !== 'changed') throw new Error('expected flash');
      expect(first.documents).toHaveLength(1);
      expect(first.documents[0]).toMatchObject({
        externalId: 'synthetic-flash',
        publication: {instant: '2040-01-02T00:30:00.000Z'},
      });
      expect(
        new TextDecoder().decode(first.documents[0]?.sourceUtf8),
      ).toContain('Synthetic complete flash.');
      expect(
        (await f.connector.read({...request, previousCursor: first.cursor}))
          .status,
      ).toBe('unchanged');
      expect(f.methods.filter((m) => m === 'tools/call')).toHaveLength(2);
      expect(first.cursor).not.toContain('synthetic-token');
    },
  );
  it('does not contact the service without an owner configuration and token', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const connector = new McpSourceConnector({
      fetch: fetcher,
      readEnvironment: () => undefined,
    });
    await expect(connector.read(request)).rejects.toMatchObject({
      code: 'connector_result_invalid',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not retry a failed tool call or expose upstream error details', async () => {
    const f = fixture();
    const original = f.fetcher.getMockImplementation();
    f.fetcher.mockImplementation(async (input, init) => {
      if (typeof init?.body === 'string' && init.body.includes('tools/call'))
        throw new Error('server error includes synthetic-token');
      if (!original) throw new Error('fixture');
      return original(input, init);
    });
    await expect(f.connector.read(request)).rejects.toMatchObject({
      code: 'connector_unavailable',
    });
    expect(
      f.fetcher.mock.calls.filter(
        ([, init]) =>
          typeof init?.body === 'string' && init.body.includes('tools/call'),
      ),
    ).toHaveLength(1);
  });
});
