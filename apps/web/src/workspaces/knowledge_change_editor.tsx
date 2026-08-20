import {useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  EPISTEMIC_ROLES,
  KNOWLEDGE_REVIEW_STATES,
  type CurationState,
  type EpistemicRole,
  type EvidenceSnapshot,
  type KnowledgeItemEditState,
  type KnowledgeItemEpistemicRole,
  type KnowledgeKind,
  type KnowledgeReviewState,
  type ReviewVocabularyPreferences,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import {
  createClientUuid,
  createCommandKey,
} from '../components/client_identity.js';
import {
  EPISTEMIC_ROLE_DESCRIPTIONS,
  EPISTEMIC_ROLE_LABELS,
  INTAKE_ACTION_LABELS,
  KNOWLEDGE_KIND_LABELS,
  REVIEW_STATE_LABELS,
} from '../components/product_labels.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  isLegacyResourceKnowledgeKind,
  KNOWLEDGE_WRITE_KINDS,
  knowledgeKindForNewWrite,
} from './knowledge_kind_options.js';
import type {ReviewTargetOption} from './review_queue_model.js';
import {preferredKnowledgeKind} from './review_vocabulary.js';

interface KnowledgeItemDraft {
  readonly draftId: string;
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly knowledgeKind: KnowledgeKind;
  readonly epistemicRole: KnowledgeItemEpistemicRole;
  readonly reviewState: KnowledgeReviewState;
  readonly title: string;
  readonly body: string;
  readonly fragmentId: string;
  readonly retainedCitations: readonly string[];
  readonly retainedFragmentDerivations: readonly string[];
  readonly knowledgeDerivationsText: string;
}

const KNOWLEDGE_ITEM_EPISTEMIC_ROLES = [
  ...EPISTEMIC_ROLES,
  'source_excerpt',
] as const;

interface KnowledgeRelationDraft {
  readonly draftId: string;
  readonly relationId: string;
  readonly expectedRevision: number;
  readonly subjectItemId: string;
  readonly relationTypeKey: string;
  readonly objectItemId: string;
  readonly epistemicRole: EpistemicRole;
  readonly reviewState: KnowledgeReviewState;
  readonly qualifier: string;
  readonly fragmentId: string;
  readonly knowledgeDerivationsText: string;
}

type FormalKnowledgeDerivation = Readonly<
  | {kind: 'item'; itemId: string; revision: number}
  | {kind: 'relation'; relationId: string; revision: number}
>;

interface EligibleAuthorization {
  readonly key: string;
  readonly label: string;
  readonly expectedDecisionRevision: number;
  readonly target: Readonly<
    | {kind: 'snapshot'; snapshotId: string}
    | {kind: 'fragment'; fragmentId: string}
  >;
}

export interface KnowledgeChangeEditorProps {
  readonly curation?: Readonly<CurationState> | undefined;
  readonly evidence?: Readonly<EvidenceSnapshot> | undefined;
  readonly initialAuthorizationKey?: string | undefined;
  readonly initialItem?: Readonly<KnowledgeItemEditState> | undefined;
  readonly onApply: (body: unknown) => Promise<ActionFeedback>;
  readonly targetOptions: readonly Readonly<ReviewTargetOption>[];
  readonly vocabularyPreferences?:
    Readonly<ReviewVocabularyPreferences> | undefined;
}

export function KnowledgeChangeEditor({
  curation,
  evidence,
  initialAuthorizationKey,
  initialItem,
  onApply,
  targetOptions,
  vocabularyPreferences,
}: KnowledgeChangeEditorProps) {
  const fragments = useMemo(
    () =>
      evidence?.structures.flatMap((structure) => structure.fragments) ?? [],
    [evidence],
  );
  const eligibleAuthorizations = useMemo(
    () => findEligibleAuthorizations(curation, targetOptions),
    [curation, targetOptions],
  );
  const [authorizationKey, setAuthorizationKey] = useState(
    initialAuthorizationKey ?? 'manual_edit',
  );
  const [items, setItems] = useState<readonly KnowledgeItemDraft[]>(() => [
    createKnowledgeItemDraft(initialItem),
  ]);
  const [relations, setRelations] = useState<readonly KnowledgeRelationDraft[]>(
    [],
  );
  const [commandKey, setCommandKey] = useState(() =>
    createCommandKey('knowledge'),
  );
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const selectedAuthorization = eligibleAuthorizations.find(
    (candidate) => candidate.key === authorizationKey,
  );
  const selectedFragmentId =
    selectedAuthorization?.target.kind === 'fragment'
      ? selectedAuthorization.target.fragmentId
      : undefined;
  const selectedFragment = fragments.find(
    (fragment) => fragment.fragmentId === selectedFragmentId,
  );
  const selectedKeywords =
    curation === undefined || selectedAuthorization === undefined
      ? []
      : curation.assignments
          .filter(
            (assignment) =>
              assignment.targetId === selectedAuthorization.key &&
              assignment.state === 'assigned',
          )
          .flatMap((assignment) => {
            const term = curation.terms.find(
              (candidate) => candidate.termId === assignment.termId,
            );
            return term?.value.lifecycle === 'active'
              ? [term.value.displayName]
              : [];
          });
  const suggestedKnowledgeKind =
    vocabularyPreferences === undefined
      ? undefined
      : preferredKnowledgeKind(selectedKeywords, vocabularyPreferences);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateDraft(items, relations);
    if (validation !== undefined) {
      setFeedback({kind: 'error', title: '变更集尚不完整', detail: validation});
      return;
    }
    const eligible = eligibleAuthorizations.find(
      (candidate) => candidate.key === authorizationKey,
    );
    setSubmitting(true);
    setFeedback(undefined);
    try {
      const operations = [
        ...items.map((item) => ({
          kind: 'put_item',
          itemId: item.itemId,
          expectedRevision: item.expectedRevision,
          value: {
            knowledgeKind: item.knowledgeKind,
            epistemicRole: item.epistemicRole,
            reviewState: item.reviewState,
            title: item.title,
            ...(item.body.trim() === '' ? {} : {body: item.body}),
          },
          provenance: provenanceForItem(item),
        })),
        ...relations.map((relation) => ({
          kind: 'put_relation',
          relationId: relation.relationId,
          expectedRevision: relation.expectedRevision,
          value: {
            subjectItemId: relation.subjectItemId,
            relationTypeKey: relation.relationTypeKey,
            objectItemId: relation.objectItemId,
            epistemicRole: relation.epistemicRole,
            reviewState: relation.reviewState,
            ...(relation.qualifier.trim() === ''
              ? {}
              : {qualifier: relation.qualifier.trim()}),
          },
          provenance: provenanceFor(
            relation.epistemicRole,
            relation.fragmentId,
            relation.knowledgeDerivationsText,
          ),
        })),
      ];
      const next = await onApply({
        commandIdempotencyKey: commandKey,
        request: {
          authorization:
            eligible === undefined
              ? {kind: 'manual_edit'}
              : {
                  kind: 'eligible_target',
                  target: eligible.target,
                  expectedDecisionRevision: eligible.expectedDecisionRevision,
                },
          operations,
        },
      });
      setFeedback(next);
      if (next.kind === 'success') {
        setCommandKey(createCommandKey('knowledge'));
        setItems([createKnowledgeItemDraft()]);
        setRelations([]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function updateItem(draftId: string, change: Partial<KnowledgeItemDraft>) {
    setItems((current) =>
      current.map((item) =>
        item.draftId === draftId ? {...item, ...change} : item,
      ),
    );
  }

  function updateRelation(
    draftId: string,
    change: Partial<KnowledgeRelationDraft>,
  ) {
    setRelations((current) =>
      current.map((relation) =>
        relation.draftId === draftId ? {...relation, ...change} : relation,
      ),
    );
  }

  return (
    <form
      className="knowledge-editor"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <label className="field knowledge-authorization">
        <span>提交依据</span>
        <select
          value={authorizationKey}
          onChange={(event) => {
            setAuthorizationKey(event.currentTarget.value);
          }}
        >
          <option value="manual_edit">最高权限人工编辑</option>
          {eligibleAuthorizations.map((authorization) => (
            <option key={authorization.key} value={authorization.key}>
              {authorization.label}
            </option>
          ))}
        </select>
        <small>
          人工编辑无需 AI；基于已准入来源时，会把审核修订写入变更凭据。
        </small>
      </label>

      {initialItem !== undefined ? (
        <div className="knowledge-review-prefill" role="status">
          <div>
            <strong>正在修改已有判断：{initialItem.value.title}</strong>
            <span>
              已加载当前修订 {initialItem.revision}
              、正文、状态与完整来源链；提交会新增修订，不会覆盖历史。
            </span>
          </div>
        </div>
      ) : null}

      {selectedFragment !== undefined ? (
        <div className="knowledge-review-prefill">
          <div>
            <strong>按已审核短条目准备一个知识项</strong>
            <span>
              复制 Fragment 正文与来源
              {suggestedKnowledgeKind === undefined
                ? '；知识类型仍由你选择。'
                : `；词表规则建议“${KNOWLEDGE_KIND_LABELS[suggestedKnowledgeKind]}”。`}
            </span>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setItems((current) => {
                const first = current[0] ?? createKnowledgeItemDraft();
                return [
                  {
                    ...first,
                    ...(suggestedKnowledgeKind === undefined
                      ? {}
                      : {knowledgeKind: suggestedKnowledgeKind}),
                    epistemicRole: 'source_claim',
                    title: fragmentTitle(selectedFragment.selectedText),
                    body: Array.from(selectedFragment.selectedText)
                      .slice(0, 20_000)
                      .join(''),
                    fragmentId: selectedFragment.fragmentId,
                    retainedCitations: [],
                    retainedFragmentDerivations: [],
                  },
                  ...current.slice(1),
                ];
              });
            }}
          >
            填入首个知识项
          </button>
        </div>
      ) : null}

      <div className="change-builder">
        <header className="builder-heading">
          <div>
            <h3>知识项</h3>
            <p>每一项拥有稳定 ID 与不可变修订；添加多项即可表达拆分结果。</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setItems((current) => [...current, createKnowledgeItemDraft()]);
            }}
          >
            添加拆分项
          </button>
        </header>
        <ol className="change-operation-list">
          {items.map((item, index) => (
            <li key={item.draftId}>
              <KnowledgeItemFields
                index={index}
                item={item}
                fragments={fragments}
                canRemove={items.length > 1}
                onChange={(change) => {
                  updateItem(item.draftId, change);
                }}
                onRemove={() => {
                  setItems((current) =>
                    current.filter(
                      (candidate) => candidate.draftId !== item.draftId,
                    ),
                  );
                }}
              />
            </li>
          ))}
        </ol>
      </div>

      <details className="relation-builder">
        <summary>在本次变更中建立关系（可选）</summary>
        <div className="builder-heading">
          <p>关系类型由当前工作区定义；关系同样保留来源和审核状态。</p>
          <button
            className="secondary-action"
            type="button"
            disabled={items.length < 2}
            onClick={() => {
              setRelations((current) => [
                ...current,
                createKnowledgeRelationDraft(items),
              ]);
            }}
          >
            添加关系
          </button>
        </div>
        {items.length < 2 ? (
          <p className="empty-copy">
            至少添加两个知识项后，才能建立非自环关系。
          </p>
        ) : null}
        <ol className="change-operation-list">
          {relations.map((relation, index) => (
            <li key={relation.draftId}>
              <KnowledgeRelationFields
                index={index}
                relation={relation}
                items={items}
                fragments={fragments}
                onChange={(change) => {
                  updateRelation(relation.draftId, change);
                }}
                onRemove={() => {
                  setRelations((current) =>
                    current.filter(
                      (candidate) => candidate.draftId !== relation.draftId,
                    ),
                  );
                }}
              />
            </li>
          ))}
        </ol>
      </details>

      <div className="form-commit">
        <p>
          {items.length} 个知识项 · {relations.length} 条关系 ·
          来源与角色逐项保存
        </p>
        <button
          className="primary-action"
          type="submit"
          disabled={submitting || items.length === 0}
        >
          {submitting ? '正在提交…' : '提交知识变更集'}
        </button>
      </div>
      <ActionNotice feedback={feedback} />
    </form>
  );
}

function KnowledgeItemFields({
  canRemove,
  fragments,
  index,
  item,
  onChange,
  onRemove,
}: {
  readonly canRemove: boolean;
  readonly fragments: readonly Readonly<{
    fragmentId: string;
    selectedText: string;
  }>[];
  readonly index: number;
  readonly item: Readonly<KnowledgeItemDraft>;
  readonly onChange: (change: Partial<KnowledgeItemDraft>) => void;
  readonly onRemove: () => void;
}) {
  return (
    <fieldset className="operation-editor">
      <legend>知识项 {String(index + 1).padStart(2, '0')}</legend>
      <div className="operation-editor__tools">
        <span className="origin-label origin-label--manual">
          {knowledgeItemRoleLabel(item.epistemicRole)}
        </span>
        {canRemove ? (
          <button
            className="text-action text-action--danger"
            type="button"
            onClick={onRemove}
          >
            移除此项
          </button>
        ) : null}
      </div>
      <label className="field field--wide">
        <span>标题</span>
        <input
          required
          maxLength={300}
          value={item.title}
          onChange={(event) => {
            onChange({title: event.currentTarget.value});
          }}
        />
      </label>
      <label className="field">
        <span>知识类型</span>
        <select
          value={item.knowledgeKind}
          onChange={(event) => {
            onChange({
              knowledgeKind: event.currentTarget.value as KnowledgeKind,
            });
          }}
        >
          {isLegacyResourceKnowledgeKind(item.knowledgeKind) ? (
            <option value={item.knowledgeKind}>资源（保留已有分类）</option>
          ) : null}
          {KNOWLEDGE_WRITE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KNOWLEDGE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>内容如何形成</span>
        <select
          value={item.epistemicRole}
          onChange={(event) => {
            onChange({
              epistemicRole: event.currentTarget
                .value as KnowledgeItemEpistemicRole,
            });
          }}
        >
          {KNOWLEDGE_ITEM_EPISTEMIC_ROLES.map((role) => (
            <option
              key={role}
              value={role}
              disabled={
                role === 'source_excerpt' &&
                fragments.length === 0 &&
                item.retainedCitations.length === 0
              }
            >
              {knowledgeItemRoleLabel(role)}
            </option>
          ))}
        </select>
        <small>{knowledgeItemRoleDescription(item.epistemicRole)}</small>
      </label>
      <label className="field">
        <span>审核状态</span>
        <select
          value={item.reviewState}
          onChange={(event) => {
            onChange({
              reviewState: event.currentTarget.value as KnowledgeReviewState,
            });
          }}
        >
          {KNOWLEDGE_REVIEW_STATES.map((state) => (
            <option key={state} value={state}>
              {REVIEW_STATE_LABELS[state]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>预期现有修订</span>
        <input
          type="number"
          min={0}
          step={1}
          value={item.expectedRevision}
          onChange={(event) => {
            onChange({expectedRevision: Number(event.currentTarget.value)});
          }}
        />
      </label>
      <label className="field field--wide">
        <span>来源 Fragment</span>
        <select
          value={item.fragmentId}
          onChange={(event) => {
            onChange({
              fragmentId: event.currentTarget.value,
              retainedCitations: [],
              retainedFragmentDerivations: [],
            });
          }}
        >
          <option value="">
            {item.retainedCitations.length +
              item.retainedFragmentDerivations.length >
            0
              ? '保留已加载的完整 Fragment 来源链'
              : '无直接 Fragment（可使用已有修订来源）'}
          </option>
          {fragments.map((fragment, fragmentIndex) => (
            <option key={fragment.fragmentId} value={fragment.fragmentId}>
              {`Fragment ${String(fragmentIndex + 1)} · ${compactExcerpt(fragment.selectedText)}`}
            </option>
          ))}
        </select>
        {item.retainedCitations.length +
          item.retainedFragmentDerivations.length >
        0 ? (
          <small>
            已保留 {item.retainedCitations.length.toString()} 个逐字引用、
            {item.retainedFragmentDerivations.length.toString()}{' '}
            个来源派生。选择新的 Fragment 会明确替换这组来源。
          </small>
        ) : null}
      </label>
      {item.retainedCitations.length + item.retainedFragmentDerivations.length >
      0 ? (
        <div className="field--full">
          <button
            className="text-action text-action--danger"
            type="button"
            onClick={() => {
              onChange({
                retainedCitations: [],
                retainedFragmentDerivations: [],
              });
            }}
          >
            清除已加载的 Fragment 来源
          </button>
        </div>
      ) : null}
      <label className="field field--full">
        <span>已有知识修订来源（可选）</span>
        <textarea
          rows={3}
          maxLength={4096}
          value={item.knowledgeDerivationsText}
          onChange={(event) => {
            onChange({knowledgeDerivationsText: event.currentTarget.value});
          }}
          placeholder={
            '每行一项：item:<UUID>@<revision> 或 relation:<UUID>@<revision>'
          }
        />
        <small>
          用于从既有知识重组 Framework，或在修订时明确继承的正式知识依据。
        </small>
      </label>
      <label className="field field--full">
        <span>正文（可选）</span>
        <textarea
          rows={5}
          maxLength={20000}
          value={item.body}
          onChange={(event) => {
            onChange({body: event.currentTarget.value});
          }}
        />
      </label>
      <details className="identity-disclosure field--full">
        <summary>稳定身份与修订设置</summary>
        <label className="field">
          <span>Item ID</span>
          <input
            required
            value={item.itemId}
            onChange={(event) => {
              onChange({itemId: event.currentTarget.value});
            }}
          />
        </label>
      </details>
    </fieldset>
  );
}

function KnowledgeRelationFields({
  fragments,
  index,
  items,
  onChange,
  onRemove,
  relation,
}: {
  readonly fragments: readonly Readonly<{
    fragmentId: string;
    selectedText: string;
  }>[];
  readonly index: number;
  readonly items: readonly Readonly<KnowledgeItemDraft>[];
  readonly onChange: (change: Partial<KnowledgeRelationDraft>) => void;
  readonly onRemove: () => void;
  readonly relation: Readonly<KnowledgeRelationDraft>;
}) {
  return (
    <fieldset className="operation-editor operation-editor--relation">
      <legend>关系 {String(index + 1).padStart(2, '0')}</legend>
      <div className="operation-editor__tools">
        <span className="origin-label origin-label--manual">用户建立</span>
        <button
          className="text-action text-action--danger"
          type="button"
          onClick={onRemove}
        >
          移除此关系
        </button>
      </div>
      <label className="field">
        <span>主体</span>
        <select
          value={relation.subjectItemId}
          onChange={(event) => {
            onChange({subjectItemId: event.currentTarget.value});
          }}
        >
          {items.map((item) => (
            <option key={item.draftId} value={item.itemId}>
              {item.title || item.itemId}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>关系类型键</span>
        <input
          required
          maxLength={120}
          value={relation.relationTypeKey}
          onChange={(event) => {
            onChange({relationTypeKey: event.currentTarget.value});
          }}
          placeholder="例如：supports 或 part_of"
        />
      </label>
      <label className="field">
        <span>客体</span>
        <select
          value={relation.objectItemId}
          onChange={(event) => {
            onChange({objectItemId: event.currentTarget.value});
          }}
        >
          {items.map((item) => (
            <option key={item.draftId} value={item.itemId}>
              {item.title || item.itemId}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>关系如何形成</span>
        <select
          value={relation.epistemicRole}
          onChange={(event) => {
            onChange({
              epistemicRole: event.currentTarget.value as EpistemicRole,
            });
          }}
        >
          {EPISTEMIC_ROLES.map((role) => (
            <option key={role} value={role} disabled={fragments.length === 0}>
              {EPISTEMIC_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <small>{EPISTEMIC_ROLE_DESCRIPTIONS[relation.epistemicRole]}</small>
      </label>
      <label className="field">
        <span>审核状态</span>
        <select
          value={relation.reviewState}
          onChange={(event) => {
            onChange({
              reviewState: event.currentTarget.value as KnowledgeReviewState,
            });
          }}
        >
          {KNOWLEDGE_REVIEW_STATES.map((state) => (
            <option key={state} value={state}>
              {REVIEW_STATE_LABELS[state]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>来源 Fragment</span>
        <select
          value={relation.fragmentId}
          onChange={(event) => {
            onChange({fragmentId: event.currentTarget.value});
          }}
        >
          <option value="">无直接 Fragment（可使用已有修订来源）</option>
          {fragments.map((fragment, fragmentIndex) => (
            <option key={fragment.fragmentId} value={fragment.fragmentId}>
              {`Fragment ${String(fragmentIndex + 1)} · ${compactExcerpt(fragment.selectedText)}`}
            </option>
          ))}
        </select>
      </label>
      <label className="field field--full">
        <span>已有知识修订来源（可选）</span>
        <textarea
          rows={3}
          maxLength={4096}
          value={relation.knowledgeDerivationsText}
          onChange={(event) => {
            onChange({knowledgeDerivationsText: event.currentTarget.value});
          }}
          placeholder={
            '每行一项：item:<UUID>@<revision> 或 relation:<UUID>@<revision>'
          }
        />
      </label>
      <label className="field field--full">
        <span>限定说明（可选）</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={relation.qualifier}
          onChange={(event) => {
            onChange({qualifier: event.currentTarget.value});
          }}
        />
      </label>
    </fieldset>
  );
}

function findEligibleAuthorizations(
  curation: Readonly<CurationState> | undefined,
  targetOptions: readonly Readonly<ReviewTargetOption>[],
): readonly Readonly<EligibleAuthorization>[] {
  if (curation === undefined) return [];
  const eligibleActions = new Set(['full', 'split', 'condense']);
  const result: EligibleAuthorization[] = [];
  for (const decision of curation.decisions) {
    if (!eligibleActions.has(decision.value.action)) continue;
    const target = curation.targets.find(
      (candidate) => candidate.targetId === decision.targetId,
    );
    if (target === undefined) continue;
    const option = targetOptions.find((candidate) =>
      target.kind === 'snapshot'
        ? candidate.kind === 'snapshot' && candidate.id === target.snapshotId
        : candidate.kind === 'fragment' && candidate.id === target.fragmentId,
    );
    if (option === undefined) continue;
    if (target.kind === 'snapshot' && target.snapshotId !== undefined) {
      result.push({
        key: decision.targetId,
        label: `${INTAKE_ACTION_LABELS[decision.value.action]} · ${option.label}`,
        expectedDecisionRevision: decision.currentRevision,
        target: {kind: 'snapshot', snapshotId: target.snapshotId},
      });
    }
    if (target.kind === 'fragment' && target.fragmentId !== undefined) {
      result.push({
        key: decision.targetId,
        label: `${INTAKE_ACTION_LABELS[decision.value.action]} · ${option.label}`,
        expectedDecisionRevision: decision.currentRevision,
        target: {kind: 'fragment', fragmentId: target.fragmentId},
      });
    }
  }
  return result;
}

function provenanceFor(
  role: EpistemicRole,
  fragmentId: string,
  knowledgeDerivationsText: string,
) {
  return {
    citations: role === 'source_claim' && fragmentId !== '' ? [fragmentId] : [],
    fragmentDerivations:
      role !== 'source_claim' && fragmentId !== '' ? [fragmentId] : [],
    knowledgeDerivations: parseKnowledgeDerivations(knowledgeDerivationsText)
      .values,
  };
}

function provenanceForItem(item: Readonly<KnowledgeItemDraft>) {
  const keepsExistingFragments =
    item.retainedCitations.length + item.retainedFragmentDerivations.length > 0;
  return {
    citations: keepsExistingFragments
      ? item.retainedCitations
      : isSourceTextRole(item.epistemicRole) && item.fragmentId !== ''
        ? [item.fragmentId]
        : [],
    fragmentDerivations: keepsExistingFragments
      ? item.retainedFragmentDerivations
      : !isSourceTextRole(item.epistemicRole) && item.fragmentId !== ''
        ? [item.fragmentId]
        : [],
    knowledgeDerivations: parseKnowledgeDerivations(
      item.knowledgeDerivationsText,
    ).values,
  };
}

function validateDraft(
  items: readonly Readonly<KnowledgeItemDraft>[],
  relations: readonly Readonly<KnowledgeRelationDraft>[],
): string | undefined {
  for (const [index, item] of items.entries()) {
    if (item.title.trim() === '')
      return `知识项 ${String(index + 1)} 缺少标题。`;
    const derivations = parseKnowledgeDerivations(
      item.knowledgeDerivationsText,
    );
    if (derivations.error !== undefined) {
      return `知识项 ${String(index + 1)} 的已有修订来源无效：${derivations.error}`;
    }
    const provenance = provenanceForItem(item);
    const fragmentInputCount =
      provenance.citations.length + provenance.fragmentDerivations.length;
    if (fragmentInputCount === 0 && derivations.values.length === 0) {
      return `知识项 ${String(index + 1)} 需要 Fragment 或已有知识修订来源。`;
    }
    if (item.epistemicRole === 'source_claim' && fragmentInputCount === 0) {
      return `知识项 ${String(index + 1)} 的“来源原文所述”必须选择 Fragment。`;
    }
    if (
      item.epistemicRole === 'inference' &&
      provenance.fragmentDerivations.length === 0 &&
      derivations.values.length === 0
    ) {
      return `知识项 ${String(index + 1)} 的“根据来源推断”不能只保留逐字引用。`;
    }
    if (
      item.epistemicRole === 'source_excerpt' &&
      (provenance.citations.length !== 1 ||
        provenance.fragmentDerivations.length !== 0 ||
        derivations.values.length !== 0 ||
        item.body === '')
    ) {
      return `知识项 ${String(index + 1)} 的“原文逐字摘录”需要一个引用、原文正文且不能包含其他派生来源。`;
    }
    if (derivations.values.length + fragmentInputCount > 64) {
      return `知识项 ${String(index + 1)} 的来源数量超过 64。`;
    }
  }
  for (const [index, relation] of relations.entries()) {
    if (relation.subjectItemId === relation.objectItemId) {
      return `关系 ${String(index + 1)} 不能连接同一个知识项。`;
    }
    if (relation.relationTypeKey.trim() === '') {
      return `关系 ${String(index + 1)} 缺少关系类型键。`;
    }
    const derivations = parseKnowledgeDerivations(
      relation.knowledgeDerivationsText,
    );
    if (derivations.error !== undefined) {
      return `关系 ${String(index + 1)} 的已有修订来源无效：${derivations.error}`;
    }
    if (relation.fragmentId === '' && derivations.values.length === 0) {
      return `关系 ${String(index + 1)} 需要 Fragment 或已有知识修订来源。`;
    }
    if (
      relation.epistemicRole === 'source_claim' &&
      relation.fragmentId === ''
    ) {
      return `关系 ${String(index + 1)} 的“来源原文所述”必须选择 Fragment。`;
    }
    if (derivations.values.length + (relation.fragmentId === '' ? 0 : 1) > 64) {
      return `关系 ${String(index + 1)} 的来源数量超过 64。`;
    }
  }
  return undefined;
}

function createKnowledgeItemDraft(
  initialItem?: Readonly<KnowledgeItemEditState>,
): KnowledgeItemDraft {
  if (initialItem !== undefined) {
    return {
      draftId: createClientUuid(),
      itemId: initialItem.itemId,
      expectedRevision: initialItem.revision,
      knowledgeKind: initialItem.value.knowledgeKind,
      epistemicRole: initialItem.value.epistemicRole,
      reviewState: initialItem.value.reviewState,
      title: initialItem.value.title,
      body: initialItem.value.body ?? '',
      fragmentId: '',
      retainedCitations: Object.freeze([...initialItem.provenance.citations]),
      retainedFragmentDerivations: Object.freeze([
        ...initialItem.provenance.fragmentDerivations,
      ]),
      knowledgeDerivationsText: formatKnowledgeDerivations(
        initialItem.provenance.knowledgeDerivations,
      ),
    };
  }
  return {
    draftId: createClientUuid(),
    itemId: createClientUuid(),
    expectedRevision: 0,
    knowledgeKind: knowledgeKindForNewWrite(undefined),
    epistemicRole: 'source_claim',
    reviewState: 'confirmed',
    title: '',
    body: '',
    fragmentId: '',
    retainedCitations: [],
    retainedFragmentDerivations: [],
    knowledgeDerivationsText: '',
  };
}

function createKnowledgeRelationDraft(
  items: readonly Readonly<KnowledgeItemDraft>[],
): KnowledgeRelationDraft {
  return {
    draftId: createClientUuid(),
    relationId: createClientUuid(),
    expectedRevision: 0,
    subjectItemId: items[0]?.itemId ?? '',
    relationTypeKey: '',
    objectItemId: items[1]?.itemId ?? '',
    epistemicRole: 'user_assertion',
    reviewState: 'confirmed',
    qualifier: '',
    fragmentId: '',
    knowledgeDerivationsText: '',
  };
}

function formatKnowledgeDerivations(
  derivations: readonly FormalKnowledgeDerivation[],
): string {
  return derivations
    .map((derivation) =>
      derivation.kind === 'item'
        ? `item:${derivation.itemId}@${derivation.revision.toString()}`
        : `relation:${derivation.relationId}@${derivation.revision.toString()}`,
    )
    .join('\n');
}

function isSourceTextRole(role: KnowledgeItemEpistemicRole): boolean {
  return role === 'source_claim' || role === 'source_excerpt';
}

function knowledgeItemRoleLabel(role: KnowledgeItemEpistemicRole): string {
  return role === 'source_excerpt'
    ? '原文逐字摘录'
    : EPISTEMIC_ROLE_LABELS[role];
}

function knowledgeItemRoleDescription(
  role: KnowledgeItemEpistemicRole,
): string {
  return role === 'source_excerpt'
    ? '正文与一个来源 Fragment 完全一致，用于保留可核对的逐字摘录。'
    : EPISTEMIC_ROLE_DESCRIPTIONS[role];
}

const DERIVATION_PATTERN =
  /^(item|relation):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@([1-9][0-9]*)$/u;

function parseKnowledgeDerivations(value: string): Readonly<{
  values: readonly FormalKnowledgeDerivation[];
  error?: string;
}> {
  const values: FormalKnowledgeDerivation[] = [];
  const seen = new Set<string>();
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (const [index, line] of lines.entries()) {
    const match = DERIVATION_PATTERN.exec(line);
    if (match === null) {
      return {
        values: Object.freeze(values),
        error: `第 ${String(index + 1)} 行应为 item:<UUID>@<revision> 或 relation:<UUID>@<revision>。`,
      };
    }
    const derivationKind = match[1] ?? '';
    const stableId = match[2] ?? '';
    const revision = Number(match[3] ?? '');
    if (!Number.isSafeInteger(revision) || revision > 2_147_483_647) {
      return {
        values: Object.freeze(values),
        error: `第 ${String(index + 1)} 行的修订号超出范围。`,
      };
    }
    const identity = `${derivationKind}:${stableId}:${String(revision)}`;
    if (seen.has(identity)) {
      return {
        values: Object.freeze(values),
        error: `第 ${String(index + 1)} 行重复引用同一修订。`,
      };
    }
    seen.add(identity);
    values.push(
      derivationKind === 'item'
        ? {kind: 'item', itemId: stableId, revision}
        : {kind: 'relation', relationId: stableId, revision},
    );
  }
  return {values: Object.freeze(values)};
}

function compactExcerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 34 ? normalized : `${normalized.slice(0, 34)}…`;
}

function fragmentTitle(value: string): string {
  const firstLine =
    value
      .split(/\r?\n/gu)
      .map((line) =>
        line
          .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)、]\s*)/u, '')
          .trim(),
      )
      .find((line) => line !== '') ?? '未命名知识项';
  return Array.from(firstLine).slice(0, 300).join('');
}
