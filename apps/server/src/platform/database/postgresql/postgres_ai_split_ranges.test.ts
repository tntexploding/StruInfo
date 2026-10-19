import {describe, expect, it, vi} from 'vitest';
import {PostgresAiTagProposalRepository} from './postgres_ai_tag_proposal_repository.js';
import type {
  PostgresPoolBoundary,
  PostgresQueryResult,
} from './postgres_pool.js';
import type {ProcessingProposalAppend} from '../../../modules/processing/processing_contract.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const proposalId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const snapshotId = '44444444-4444-4444-8444-444444444444';
const fragmentId = '55555555-5555-4555-8555-555555555555';
type Row = Readonly<Record<string, unknown>>;
const rows = (...values: Row[]): PostgresQueryResult<Row> => ({
  rows: values,
  rowCount: values.length,
});

describe('persisted AI split source ranges', () => {
  it.each([true, false])(
    'round trips %s ranged proposals without changing legacy payloads',
    async (ranged) => {
      const fragments: Row[] = [];
      const entries: Row[] = [];
      const payload = {
        providerModel: 'synthetic',
        promptVersion: 'synthetic-v1',
        splitRuleVersion: 'struinfo.entry-split.ai-group.v1' as const,
        entries: Array.from({length: ranged ? 2 : 1}, (_, ordinal) => ({
          titlePath: `Item ${String(ordinal)}`,
          fragmentIds: [fragmentId],
          ...(ranged
            ? {
                fragmentRanges: [
                  {
                    startCodePoint: ordinal * 30,
                    endCodePoint: (ordinal + 1) * 30,
                  },
                ],
              }
            : {}),
        })),
      };
      const proposal: ProcessingProposalAppend = {
        workspaceId,
        proposalId,
        runId,
        ordinal: 0,
        stage: 'split',
        kind: 'split',
        targetSnapshotId: snapshotId,
        summary: 'Synthetic independent items',
        fragmentIds: [fragmentId],
        splitPayload: payload,
      };
      let written = false;
      const pool: PostgresPoolBoundary = {
        end: () => Promise.resolve(),
        query: () => Promise.reject(new Error('pool query')),
        connect: () =>
          Promise.resolve({
            release: vi.fn(),
            executeSimple: () => Promise.reject(new Error('simple query')),
            query: <T extends Row>(
              sql: string,
              args: readonly unknown[] = [],
            ) => {
              let result = rows();
              if (sql.includes('FROM struinfo.workspace'))
                result = rows({workspace_id: workspaceId});
              else if (sql.includes('FROM struinfo.processing_run'))
                result = rows({status: 'running'});
              else if (
                sql.startsWith(
                  'INSERT INTO struinfo.processing_split_proposal_entry_fragment',
                )
              ) {
                fragments.push({
                  proposal_id: proposalId,
                  entry_ordinal: args[2],
                  fragment_ordinal: args[3],
                  fragment_id: args[4],
                  start_code_point: args[5],
                  end_code_point: args[6],
                });
                result = rows({});
              } else if (
                sql.startsWith(
                  'INSERT INTO struinfo.processing_split_proposal_entry ',
                )
              ) {
                entries.push({
                  proposal_id: proposalId,
                  entry_ordinal: args[2],
                  title_path: args[3],
                });
                result = rows({});
              } else if (sql.startsWith('INSERT INTO')) result = rows({});
              else if (
                sql.includes(
                  'FROM struinfo.processing_split_proposal_entry_fragment',
                )
              )
                result = rows(...fragments);
              else if (
                sql.includes('FROM struinfo.processing_split_proposal_entry')
              )
                result = rows(...entries);
              else if (sql.includes('FROM struinfo.processing_split_proposal'))
                result = rows({
                  proposal_id: proposalId,
                  provider_model: payload.providerModel,
                  prompt_version: payload.promptVersion,
                  split_rule_version: payload.splitRuleVersion,
                });
              else if (
                sql.includes('FROM struinfo.processing_proposal_fragment_input')
              )
                result = rows({
                  proposal_id: proposalId,
                  input_ordinal: 0,
                  fragment_id: fragmentId,
                });
              else if (
                written &&
                sql.includes('FROM struinfo.processing_proposal')
              )
                result = rows({
                  workspace_id: workspaceId,
                  proposal_id: proposalId,
                  run_id: runId,
                  proposal_ordinal: 0,
                  stage: 'split',
                  proposal_kind: 'split',
                  target_snapshot_id: snapshotId,
                  target_entry_id: null,
                  related_entry_id: null,
                  status: 'pending_review',
                  summary: proposal.summary,
                  created_at: '2040-01-01T00:00:00.000Z',
                  decided_at: null,
                });
              return Promise.resolve(result as PostgresQueryResult<T>);
            },
          }),
      };
      const repository = new PostgresAiTagProposalRepository(pool);
      expect(await repository.appendSplitProposal(proposal)).toBe('applied');
      written = true;
      const loaded = await repository.listSplitProposalsForSnapshot(
        workspaceId,
        snapshotId,
        5,
      );
      expect(loaded[0]?.splitPayload).toEqual(payload);
      expect(loaded[0]?.fragmentIds).toEqual([fragmentId]);
    },
  );
});
