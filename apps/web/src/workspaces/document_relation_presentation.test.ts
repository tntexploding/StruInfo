import {describe, expect, it} from 'vitest';
import type {
  InformationEntry,
  InformationEntryAssociationView,
} from '../api/m1c_api_contract.js';
import {documentRelationPresentation} from './document_relation_presentation.js';

const entry: InformationEntry = {
  workspaceId: 'workspace',
  entryId: 'entry',
  resourceId: 'resource',
  snapshotId: 'snapshot',
  revision: 1,
  revisionId: 'revision',
  sourceKey: 'synthetic',
  capturedAt: '2026-01-01T00:00:00Z',
  value: {
    titlePath: 'Synthetic source',
    body: '合成组件的测试记录。',
    documentOrder: 0,
    bodySha256: 'hash',
    chunkMode: 'whole',
    splitRuleVersion: 'synthetic',
    isPrivate: false,
    contentKeywords: [
      {
        displayValue: '合成组件',
        normalizedValue: '合成组件',
        origin: 'ai',
        originVersion: 'synthetic',
      },
    ],
    domains: [],
    fragmentIds: ['fragment'],
  },
};
function relation(
  title: string,
  label: string,
  body = '合成组件在另一项测试中的记录。',
): InformationEntryAssociationView {
  return {
    relatedEntry: {
      ...entry,
      entryId: 'synthetic-related',
      snapshotId: 'synthetic-snapshot',
      value: {...entry.value, titlePath: title, body},
    },
    isBlocked: false,
    effectiveScore: 0,
    override: {
      workspaceId: 'workspace',
      entryLowId: 'entry',
      entryHighId: 'other',
      revision: 1,
      revisionId: 'revision',
      value: {
        action: 'enhance',
        manualAdjustment: 0,
        isBlocked: false,
        graph: {
          origin: 'ai',
          direction: 'symmetric',
          label,
          semanticKind: 'related',
          verificationStatus: 'unreviewed',
          note: 'Synthetic original reasoning.',
        },
      },
    },
  };
}

describe('document relation presentation', () => {
  it('separates a readable title, saved reason and actual review status', () => {
    const value = documentRelationPresentation(
      entry,
      relation('**Synthetic title**', '合成主题关联'),
    );
    expect(value).toMatchObject({
      title: 'Synthetic title',
      isExcerpt: false,
      reason: '合成主题关联',
      reasonLabel: '关联说明',
      origin: 'AI',
      review: '尚未人工核查',
      broad: false,
    });
  });
  it('uses a literal body excerpt for numbered titles without changing stored content', () => {
    const input = relation(
      '3、',
      'shared SYN focus',
      '# 3、\n\n合成组件在**不同条件**下的测试记录。\n\n下一段。',
    );
    const value = documentRelationPresentation(entry, input);
    expect(value).toMatchObject({
      title: '合成组件在不同条件下的测试记录。',
      originalTitle: '3、',
      isExcerpt: true,
      reasonLabel: '共同提及',
      reason: '合成组件',
      broad: true,
    });
    expect(input.relatedEntry.value.titlePath).toBe('3、');
    expect(value.note).toBe('Synthetic original reasoning.');
  });
  it('does not invent a translation for an arbitrary English explanation', () => {
    const value = documentRelationPresentation(
      entry,
      relation('Synthetic title', 'A specific English explanation'),
    );
    expect(value).toMatchObject({
      reasonLabel: '关系类型',
      reason: '相关内容',
      label: 'A specific English explanation',
      broad: false,
    });
  });
  it('does not claim shared mentions when only keywords contain the name', () => {
    const value = documentRelationPresentation(
      entry,
      relation(
        'Synthetic title',
        'shared SYN focus',
        'Unrelated synthetic text.',
      ),
    );
    expect(value).toMatchObject({reasonLabel: '共同关注', reason: 'SYN'});
  });
  it('keeps long meaningful titles complete and bounds only clearly labelled excerpts', () => {
    const title = 'A meaningful synthetic title '.repeat(8);
    expect(
      documentRelationPresentation(entry, relation(title, '同主题')).title,
    ).toBe(title.trim());
    const value = documentRelationPresentation(
      entry,
      relation('第十二条', '同主题', '😀'.repeat(85)),
    );
    expect(value.title).toBe('😀'.repeat(80) + '…');
    expect(value.isExcerpt).toBe(true);
  });
  it('preserves a source-checked state without presenting it as factual verification', () => {
    const input = relation('Synthetic title', '同主题');
    const override = input.override;
    const graph = override?.value.graph;
    if (!override || !graph) throw new Error('synthetic graph missing');
    const checked = {
      ...input,
      override: {
        ...override,
        value: {
          ...override.value,
          graph: {...graph, verificationStatus: 'source_checked' as const},
        },
      },
    };
    expect(documentRelationPresentation(entry, checked).review).toBe(
      '已核对来源',
    );
  });
});
