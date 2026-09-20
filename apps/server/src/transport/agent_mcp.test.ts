import {describe, it, expect, vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createAgentMcpServer} from './agent_mcp.js';
describe('StruInfo MCP protocol', () => {
  it('initializes, discovers tools, validates inputs and dispatches through the application gateway', async () => {
    const call = vi.fn(() =>
      Promise.resolve({result: {totalCount: 0, items: []}}),
    );
    const server = createAgentMcpServer(call);
    const client = new Client({name: 'synthetic-client', version: '1'});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(28);
      expect(
        tools.tools.find((tool) => tool.name === 'intake_receive')?.annotations,
      ).toMatchObject({readOnlyHint: false, openWorldHint: false});
      expect(
        tools.tools.find((t) => t.name === 'entries_search')?.annotations
          ?.readOnlyHint,
      ).toBe(true);
      expect(
        tools.tools.find((t) => t.name === 'task_control')?.annotations,
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      });
      expect(
        (
          await client.callTool({
            name: 'entries_search',
            arguments: {text: 'x'.repeat(301)},
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await client.callTool({
            name: 'entries_search',
            arguments: {contentKeyword: 'x'.repeat(81)},
          })
        ).isError,
      ).toBe(true);
      expect(call).not.toHaveBeenCalled();
      for (const name of [
        'intake_prepare',
        'document_import',
        'subscription_put',
        'subscription_check',
      ]) {
        expect(
          tools.tools.find((tool) => tool.name === name)?.annotations,
        ).toMatchObject({
          readOnlyHint: false,
          openWorldHint: true,
        });
      }
      expect(
        tools.tools.find((tool) => tool.name === 'subscription_put')
          ?.annotations?.destructiveHint,
      ).toBe(true);
      for (const name of [
        'report_preview',
        'reports_list',
        'report_read',
        'report_export',
      ])
        expect(
          tools.tools.find((tool) => tool.name === name)?.annotations
            ?.readOnlyHint,
        ).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'report_generate')).toBe(
        false,
      );
      await client.callTool({name: 'reports_list', arguments: {}});
      expect(call).toHaveBeenCalledWith('reports_list', {});
      const searched = await client.callTool({
        name: 'entries_search',
        arguments: {text: 'Synthetic'},
      });
      expect(searched.isError).toBe(false);
      expect(call).toHaveBeenCalledWith('entries_search', {
        text: 'Synthetic',
        limit: 20,
      });
      expect(
        (
          await client.callTool({
            name: 'entries_search',
            arguments: {text: 'x', workspaceId: 'override'},
          })
        ).isError,
      ).toBe(true);
      expect(
        (await client.callTool({name: 'constructor', arguments: {}})).isError,
      ).toBe(true);
      call.mockResolvedValueOnce({
        error: {code: 'stale_task_version'},
      } as never);
      expect(
        (await client.callTool({name: 'tasks_list', arguments: {}})).isError,
      ).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
