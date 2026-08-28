import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORDS,
  DEFAULT_REVIEW_EXPLORATION_POLICY,
  DEFAULT_REVIEW_VOCABULARY,
  type InformationEntry,
} from '../api/m1c_api_contract.js';
import {InformationEntryQueryComparison} from './information_entry_query_comparison.js';
import {InformationEntryQueryWorkspace} from './information_entry_query_workspace.js';
import {
  EMPTY_INFORMATION_ENTRY_COMPARISON_STATE,
  clearInformationEntryComparisons,
  informationEntryQueryScopeKey,
  toggleInformationEntryComparison,
  visibleInformationEntryComparisons,
  type InformationEntryQueryScopeInput,
  type InformationEntrySearchItem,
} from './information_entry_query_state.js';
import {InformationEntryQueryTools} from './information_entry_query_tools.js';
import {EMPTY_ENTRY_ADVANCED_SEARCH_FILTERS} from './use_information_entry_controller.js';

const ENTRY_A = searchItem(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '合成条目 A',
);
const ENTRY_B = searchItem(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '合成条目 B',
  true,
);
const ENTRY_C = searchItem(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '合成条目 C',
);

const BASE_SCOPE: Readonly<InformationEntryQueryScopeInput> = Object.freeze({
  query: ' 合成查询 ',
  textMode: 'fuzzy',
  textFields: Object.freeze(['tags', 'title'] as const),
  snapshotId: '',
  typeKeyword: '',
  domainKeyword: '',
  advancedFilters: EMPTY_ENTRY_ADVANCED_SEARCH_FILTERS,
  includePrivate: false,
  onlyPrivate: false,
});

describe('M1F-2 query result tools', () => {
  it('canonicalizes field order while separating privacy and association scopes', () => {
    const baseKey = informationEntryQueryScopeKey(BASE_SCOPE);
    const reorderedKey = informationEntryQueryScopeKey({
      ...BASE_SCOPE,
      textFields: ['title', 'tags'] as const,
    });
    const privateKey = informationEntryQueryScopeKey({
      ...BASE_SCOPE,
      includePrivate: true,
    });
    const associationKey = informationEntryQueryScopeKey({
      ...BASE_SCOPE,
      advancedFilters: {
        ...EMPTY_ENTRY_ADVANCED_SEARCH_FILTERS,
        association: {
          entryId: ENTRY_A.entry.entryId,
          label: '显示标签不参与查询身份',
          maximumDepth: 2,
          minimumScore: 2500,
        },
      },
    });

    expect(reorderedKey).toBe(baseKey);
    expect(privateKey).not.toBe(baseKey);
    expect(associationKey).not.toBe(baseKey);
    expect(associationKey).not.toContain('显示标签不参与查询身份');
  });

  it('retains at most two results and hides them immediately outside their query scope', () => {
    const scopeKey = informationEntryQueryScopeKey(BASE_SCOPE);
    let state = toggleInformationEntryComparison(
      EMPTY_INFORMATION_ENTRY_COMPARISON_STATE,
      scopeKey,
      ENTRY_A,
    );
    state = toggleInformationEntryComparison(state, scopeKey, ENTRY_B);
    state = toggleInformationEntryComparison(state, scopeKey, ENTRY_C);

    expect(visibleInformationEntryComparisons(state, scopeKey)).toEqual([
      ENTRY_A,
      ENTRY_B,
    ]);
    expect(
      visibleInformationEntryComparisons(
        state,
        informationEntryQueryScopeKey({...BASE_SCOPE, includePrivate: true}),
      ),
    ).toEqual([]);

    state = toggleInformationEntryComparison(state, scopeKey, ENTRY_A);
    expect(visibleInformationEntryComparisons(state, scopeKey)).toEqual([
      ENTRY_B,
    ]);
    expect(
      visibleInformationEntryComparisons(
        clearInformationEntryComparisons(scopeKey),
        scopeKey,
      ),
    ).toEqual([]);
  });

  it('renders an explicit local association switch and bounded comparison action', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryQueryTools
        association={undefined}
        comparisonCount={0}
        comparisonFull={false}
        selectedItem={ENTRY_A}
        selectedIsCompared={false}
        onAssociationToggle={() => undefined}
        onClearComparisons={() => undefined}
        onReplaceAssociationAnchor={() => undefined}
        onToggleComparison={() => undefined}
      />,
    );

    expect(markup).toContain('关联联想');
    expect(markup).toContain('不调用 AI');
    expect(markup).toContain('未开启');
    expect(markup).toContain('合成条目 A');
    expect(markup).toContain('加入比较');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('aria-label="开启或关闭关联联想"');
  });

  it('renders two comparable records with separate scores and exact source actions', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryQueryComparison
        items={[ENTRY_A, ENTRY_B]}
        onOpenEvidence={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(markup).toContain('合成条目 A');
    expect(markup).toContain('合成条目 B');
    expect(markup).toContain('公开内容');
    expect(markup).toContain('隐私内容');
    expect(markup).toContain('有用 / 有趣');
    expect(markup).toContain('4 / 5 / 2 / 5');
    expect(markup).toContain('近似 · 词法分 78/100');
    expect(markup.match(/查看精确来源/g)).toHaveLength(2);
    expect(markup).toContain('不会生成综合评分');
  });

  it('wires the query-owned tools into the ordinary Query workspace', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryQueryWorkspace
        aiQuerySynthesisEnabled={false}
        snapshots={[]}
        reviewPreferences={{
          status: 'ready',
          value: {
            status: 'ok',
            workspaceId: '11111111-1111-4111-8111-111111111111',
            quickTags: [],
            automaticKeywords: DEFAULT_REVIEW_AUTOMATIC_KEYWORDS,
            vocabulary: DEFAULT_REVIEW_VOCABULARY,
            associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY,
            explorationPolicy: DEFAULT_REVIEW_EXPLORATION_POLICY,
          },
        }}
        onExplore={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              policy: {
                ...DEFAULT_REVIEW_EXPLORATION_POLICY,
                version: 'struinfo.entry-exploration.local-association.v1',
              },
              anchorEntryId: ENTRY_A.entry.entryId,
              candidateLimit: 0,
              totalEligibleCount: 0,
              items: [],
            },
          })
        }
        onOpenEvidence={() => undefined}
        onReviseExplorationPolicy={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'unchanged',
              policy: {
                ...DEFAULT_REVIEW_EXPLORATION_POLICY,
                version: 'struinfo.entry-exploration.local-association.v1',
              },
            },
          })
        }
        onSynthesize={() =>
          Promise.resolve({
            statusCode: 503,
            body: {
              status: 'failed',
              issue: {code: 'ai_provider_not_configured'},
            },
          })
        }
        onSearch={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              querySha256: 'a'.repeat(64),
              totalCount: 0,
              items: [],
              privateDocuments: {totalCount: 0, items: []},
            },
          })
        }
      />,
    );

    expect(markup).toContain('查询条目');
    expect(markup).toContain('输入关键词并调整右侧条件');
    expect(markup).toContain('从结果列表选择一个条目');
    expect(markup).toContain('在中间查看正文与来源');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('正在搜索…');
    expect(markup).toContain('搜索与显示设置');
    expect(markup).toContain('结果操作');
    expect(markup).toContain('结果比较');
    expect(markup).toContain('先选择一条查询结果');
    expect(markup).toContain('AI 综合 · 仅基于当前公开查询结果');
    expect(markup).toContain('AI 未启用');
    expect(markup).toContain('探索候选');
    expect(markup).toContain('独立于搜索排序');
    expect(markup).toContain('启用独立探索');
    expect(markup).toContain('当前页探索份额');
    expect(markup).toContain('邻域扩展');
    expect(markup).toContain('跨领域连接');
    expect(markup).toContain('偶然发现');
    expect(markup).toContain('探索不会自动运行');
  });
});

function searchItem(
  entryId: string,
  title: string,
  isPrivate = false,
): Readonly<InformationEntrySearchItem> {
  const entry: Readonly<InformationEntry> = Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    entryId,
    resourceId: '22222222-2222-4222-8222-222222222222',
    snapshotId: '33333333-3333-4333-8333-333333333333',
    revision: 1,
    revisionId: '44444444-4444-4444-8444-444444444444',
    sourceKey: 'synthetic:query-comparison',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: title,
      body: '仅用于测试界面结构的合成正文。',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic-v1',
      isPrivate,
      typeKeyword: 'factual_material',
      usefulnessScore: 4,
      interestScore: 2,
      contentKeywords: Object.freeze([
        Object.freeze({
          displayValue: '合成标签',
          normalizedValue: '合成标签',
          origin: 'rule',
          originVersion: 'synthetic-v1',
        }),
      ]),
      domains: Object.freeze([
        Object.freeze({
          keyword: 'engineering_computing',
          origin: 'manual',
          originVersion: 'synthetic-v1',
        }),
      ]),
      fragmentIds: Object.freeze(['55555555-5555-4555-8555-555555555555']),
    }),
  });
  return Object.freeze({
    entry,
    matchReasons: Object.freeze(['title'] as const),
    textMatch: Object.freeze({mode: 'fuzzy', score: 7800}),
    filterReasons: Object.freeze([]),
  });
}
