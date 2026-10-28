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
      expect(tools.tools).toHaveLength(46);
      for (const name of [
        'split_recipes_read',
        'split_recipe_preview',
        'annotation_vocabulary',
        'topics_list',
        'topics_preview',
        'entry_annotations_read',
      ]) {
        expect(
          tools.tools.find((tool) => tool.name === name)?.annotations,
        ).toMatchObject({readOnlyHint: true, openWorldHint: false});
      }
      expect(
        tools.tools.find((tool) => tool.name === 'split_recipe_apply')
          ?.annotations,
      ).toMatchObject({readOnlyHint: false, openWorldHint: false});
      expect(
        tools.tools.some((tool) => tool.name === 'split_recipe_control'),
      ).toBe(false);
      expect(
        tools.tools.some((tool) => tool.name === 'annotation_vocabulary_save'),
      ).toBe(false);
      expect(
        tools.tools.find((tool) => tool.name === 'entry_annotations_save')
          ?.annotations,
      ).toMatchObject({readOnlyHint: false, openWorldHint: false});
      expect(
        tools.tools.find((tool) => tool.name === 'processing_standard')
          ?.annotations,
      ).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
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
      expect(
        (
          await client.callTool({
            name: 'processing_standard',
            arguments: {stage: 'unsupported'},
          })
        ).isError,
      ).toBe(true);
      expect(call).not.toHaveBeenCalled();
      await client.callTool({
        name: 'processing_standard',
        arguments: {stage: 'tags'},
      });
      expect(call).toHaveBeenCalledWith('processing_standard', {stage: 'tags'});
      await client.callTool({name: 'annotation_vocabulary', arguments: {}});
      expect(call).toHaveBeenCalledWith('annotation_vocabulary', {});
      const annotationEntryId = '00000000-0000-4000-8000-000000000001';
      const annotationWrite = {
        entryId: annotationEntryId,
        includePrivate: false,
        expectedRevision: 1,
        vocabularyRevision: 0,
        annotation: {
          status: 'none',
          note: '',
          readingState: 'unread',
          labels: [],
          claims: [],
        },
      };
      expect(
        (
          await client.callTool({
            name: 'entry_annotations_save',
            arguments: annotationWrite,
          })
        ).isError,
      ).toBe(false);
      expect(call).toHaveBeenCalledWith(
        'entry_annotations_save',
        annotationWrite,
      );
      expect(
        (
          await client.callTool({
            name: 'entry_annotations_save',
            arguments: {...annotationWrite, expectedRevision: 0},
          })
        ).isError,
      ).toBe(true);
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
