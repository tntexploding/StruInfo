import {useCallback, useEffect, useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type EvidenceSnapshotSummary,
  type InformationEntry,
  type InformationEntryMaterializeResponse,
  type InformationEntryRevisionResponse,
  type InformationEntrySearchResponse,
  type M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';

const TYPE_LABELS: Readonly<Record<EntryTypeKeyword, string>> = {
  factual_material: '纪实资料',
  knowledge_explanation: '知识解释',
  operating_guideline: '操作规范',
  investigation_analysis: '调查分析',
  argument: '观点论证',
  personal_experience: '个人体验',
  interactive_collaboration: '互动协作',
  public_communication: '公共传播',
  literary_creation: '文学创作',
  other: '其他',
};

const DOMAIN_LABELS: Readonly<Record<EntryDomainKeyword, string>> = {
  mathematics_formal: '数理与形式系统',
  nature_environment: '自然与环境',
  engineering_computing: '工程、计算与技术',
  life_health: '生命、医学与健康',
  society_public_affairs: '社会与公共事务',
  economy_business: '经济、商业与组织',
  law_policy_governance: '法律、政策与治理',
  humanities_history: '人文、历史与思想',
  language_education: '语言、传播与教育',
  culture_arts: '文化、艺术与娱乐',
  daily_life: '日常生活、个人与家庭',
  other: '其他',
};

type EntryViewState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<InformationEntrySearchResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

export interface InformationEntryWorkspaceProps {
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
  readonly onMaterialize: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  readonly onRevise: (
    entryId: string,
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryRevisionResponse>>;
  readonly onSearch: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntrySearchResponse>>;
  readonly onOpenEvidence: (
    snapshotId: string,
    fragmentId: string | undefined,
    includePrivate: boolean,
  ) => void;
}

export function InformationEntryWorkspace({
  snapshots,
  onMaterialize,
  onOpenEvidence,
  onRevise,
  onSearch,
}: InformationEntryWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [typeKeyword, setTypeKeyword] = useState<'' | EntryTypeKeyword>('');
  const [domainKeyword, setDomainKeyword] = useState<'' | EntryDomainKeyword>(
    '',
  );
  const [includePrivate, setIncludePrivate] = useState(false);
  const [view, setView] = useState<EntryViewState>({status: 'loading'});
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [materializing, setMaterializing] = useState(false);

  const executeSearch = useCallback(async () => {
    setView({status: 'loading'});
    try {
      const response = await onSearch({
        ...(query.trim() === '' ? {} : {text: query.trim()}),
        ...(snapshotId === '' ? {} : {snapshotId}),
        ...(typeKeyword === '' ? {} : {typeKeyword}),
        ...(domainKeyword === '' ? {} : {domainKeyword}),
        includePrivate,
        limit: 100,
      });
      if (response.body.status !== 'ok') {
        setView({status: 'error', message: describeFailure(response.body)});
        return;
      }
      setView({status: 'ready', response: response.body});
      setSelectedEntryId((current) =>
        response.body.status === 'ok' &&
        response.body.items.some((item) => item.entry.entryId === current)
          ? current
          : response.body.status === 'ok'
            ? response.body.items[0]?.entry.entryId
            : undefined,
      );
    } catch {
      setView({
        status: 'error',
        message: '本地 Entry 接口当前不可达；现有条目没有被修改。',
      });
    }
  }, [domainKeyword, includePrivate, onSearch, query, snapshotId, typeKeyword]);

  useEffect(() => {
    globalThis.queueMicrotask(() => void executeSearch());
  }, [executeSearch]);

  const selectedEntry = useMemo(() => {
    if (view.status !== 'ready') return undefined;
    return view.response.items.find(
      (item) => item.entry.entryId === selectedEntryId,
    )?.entry;
  }, [selectedEntryId, view]);

  async function materialize() {
    if (snapshotId === '' || materializing) {
      setFeedback({
        kind: 'error',
        title: '请选择来源文档',
        detail: 'Entry 必须从当前工作区中的一个精确 Snapshot 生成。',
      });
      return;
    }
    setMaterializing(true);
    setFeedback(undefined);
    try {
      const response = await onMaterialize({
        snapshotId,
        chunkMode: 'split',
        includePrivate,
      });
      if (
        response.body.status !== 'created' &&
        response.body.status !== 'existing'
      ) {
        setFeedback({
          kind: 'error',
          title: '条目没有生成',
          detail: describeFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title:
          response.body.status === 'created'
            ? '信息条目已生成'
            : '相同条目已经存在',
        detail:
          response.body.status === 'created'
            ? `新增 ${response.body.createdCount.toString()} 个可追溯 Entry。`
            : '幂等重试没有创建重复条目或修订。',
      });
      await executeSearch();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: 'Entry 没有生成；Evidence 与正式知识保持不变。',
      });
    } finally {
      setMaterializing(false);
    }
  }

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);
    void executeSearch();
  }

  return (
    <div className="workspace-view entry-workspace">
      <header className="workspace-heading">
        <div>
          <p className="section-index">03 / INFORMATION ENTRY</p>
          <h1>文档条目</h1>
          <p>
            从不可变 Snapshot 生成轻量
            Entry，编辑内容、类型和领域关键词，再按正文、关键词与来源找回。
          </p>
        </div>
        <span className="origin-label origin-label--deterministic">
          来源绑定 · 无需 AI
        </span>
      </header>

      <section
        className="entry-command-panel"
        aria-labelledby="entry-command-title"
      >
        <header className="console-heading">
          <div>
            <p className="section-index">BUILD / FIND</p>
            <h2 id="entry-command-title">生成与查找</h2>
          </div>
          <span className="record-count">
            {view.status === 'ready'
              ? `${view.response.totalCount.toString()} 条`
              : '读取中'}
          </span>
        </header>
        <form
          className="entry-search-form"
          role="search"
          onSubmit={submitSearch}
        >
          <label className="field entry-search-query">
            <span>正文或关键词</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              placeholder="留空浏览当前 Entry"
            />
          </label>
          <label className="field">
            <span>来源文档</span>
            <select
              value={snapshotId}
              onChange={(event) => {
                setSnapshotId(event.currentTarget.value);
              }}
            >
              <option value="">全部 Snapshot</option>
              {snapshots.map((snapshot) => (
                <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                  {snapshot.sourceKey}
                  {snapshot.isPrivate === true ? '（私密）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>类型关键词</span>
            <select
              value={typeKeyword}
              onChange={(event) => {
                setTypeKeyword(
                  event.currentTarget.value as '' | EntryTypeKeyword,
                );
              }}
            >
              <option value="">全部类型</option>
              {ENTRY_TYPE_KEYWORDS.map((keyword) => (
                <option key={keyword} value={keyword}>
                  {TYPE_LABELS[keyword]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>领域关键词</span>
            <select
              value={domainKeyword}
              onChange={(event) => {
                setDomainKeyword(
                  event.currentTarget.value as '' | EntryDomainKeyword,
                );
              }}
            >
              <option value="">全部领域</option>
              {ENTRY_DOMAIN_KEYWORDS.map((keyword) => (
                <option key={keyword} value={keyword}>
                  {DOMAIN_LABELS[keyword]}
                </option>
              ))}
            </select>
          </label>
          <label className="privacy-query-toggle entry-private-toggle">
            <input
              type="checkbox"
              checked={includePrivate}
              onChange={(event) => {
                setIncludePrivate(event.currentTarget.checked);
              }}
            />
            查询隐私文档
          </label>
          <div className="entry-command-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => void materialize()}
              disabled={materializing}
            >
              {materializing ? '正在生成…' : '按结构生成条目'}
            </button>
            <button className="primary-action" type="submit">
              查找 Entry
            </button>
          </div>
        </form>
        <ActionNotice feedback={feedback} />
      </section>

      {view.status === 'loading' ? (
        <div className="entry-loading" role="status">
          正在读取当前条目…
        </div>
      ) : view.status === 'error' ? (
        <div className="error-state entry-state" role="alert">
          <h2>Entry 读取失败</h2>
          <p>{view.message}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void executeSearch()}
          >
            重试
          </button>
        </div>
      ) : view.response.items.length === 0 ? (
        <div className="empty-state entry-state">
          <h2>当前范围还没有 Entry</h2>
          <p>
            选择一个来源文档并执行“按结构生成条目”，不会改写原始 Snapshot
            或正式知识。
          </p>
        </div>
      ) : (
        <div className="entry-workbench">
          <section className="entry-result-list" aria-label="Entry 搜索结果">
            <header>
              <span>ORDER / RESULT</span>
              <strong>{view.response.totalCount.toString()}</strong>
            </header>
            <ol>
              {view.response.items.map(({entry, matchReasons}) => (
                <li key={entry.entryId}>
                  <button
                    type="button"
                    data-active={entry.entryId === selectedEntryId}
                    onClick={() => {
                      setSelectedEntryId(entry.entryId);
                    }}
                  >
                    <span className="entry-result-list__order">
                      {(entry.value.documentOrder + 1)
                        .toString()
                        .padStart(2, '0')}
                    </span>
                    <span>
                      <strong>{entry.value.titlePath || '未命名条目'}</strong>
                      <small>
                        {entry.sourceKey} · r{entry.revision.toString()}
                        {entry.value.isPrivate ? ' · 私密' : ''}
                      </small>
                      {matchReasons.length > 0 ? (
                        <em>
                          {matchReasons.map(matchReasonLabel).join(' / ')}
                        </em>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          {selectedEntry === undefined ? null : (
            <InformationEntryEditor
              key={`${selectedEntry.entryId}:${selectedEntry.revision.toString()}`}
              entry={selectedEntry}
              includePrivate={includePrivate}
              onOpenEvidence={onOpenEvidence}
              onRevise={onRevise}
              onSaved={async (nextFeedback) => {
                setFeedback(nextFeedback);
                await executeSearch();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function InformationEntryEditor({
  entry,
  includePrivate,
  onOpenEvidence,
  onRevise,
  onSaved,
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly includePrivate: boolean;
  readonly onOpenEvidence: InformationEntryWorkspaceProps['onOpenEvidence'];
  readonly onRevise: InformationEntryWorkspaceProps['onRevise'];
  readonly onSaved: (feedback: ActionFeedback) => Promise<void>;
}) {
  const [body, setBody] = useState(entry.value.body);
  const [contentKeywords, setContentKeywords] = useState(
    entry.value.contentKeywords.map((value) => value.displayValue).join('，'),
  );
  const [typeKeyword, setTypeKeyword] = useState<EntryTypeKeyword>(
    entry.value.typeKeyword ?? 'factual_material',
  );
  const [typeCustomName, setTypeCustomName] = useState(
    entry.value.typeCustomName ?? '',
  );
  const initialDomains = entry.value.domains.map((value) => value.keyword);
  const initialCustomDomains = entry.value.domains.map(
    (value) => value.customName ?? '',
  );
  const [primaryDomain, setPrimaryDomain] = useState<'' | EntryDomainKeyword>(
    initialDomains[0] ?? '',
  );
  const [secondaryDomain, setSecondaryDomain] = useState<
    '' | EntryDomainKeyword
  >(initialDomains[1] ?? '');
  const [thirdDomain, setThirdDomain] = useState<'' | EntryDomainKeyword>(
    initialDomains[2] ?? '',
  );
  const [domainCustomNames, setDomainCustomNames] = useState([
    initialCustomDomains[0] ?? '',
    initialCustomDomains[1] ?? '',
    initialCustomDomains[2] ?? '',
  ]);
  const [saving, setSaving] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<ActionFeedback>();

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const keywords = contentKeywords
      .split(/[，,\n]/u)
      .map((value) => value.trim())
      .filter((value) => value !== '');
    if (primaryDomain === '') {
      setLocalFeedback({
        kind: 'error',
        title: '请选择一个主领域',
        detail: '主领域用于文档聚合；不会从来源或用户偏好中静默猜测。',
      });
      return;
    }
    const selections = [
      {keyword: primaryDomain, customName: domainCustomNames[0] ?? ''},
      ...(secondaryDomain === ''
        ? []
        : [
            {
              keyword: secondaryDomain,
              customName: domainCustomNames[1] ?? '',
            },
          ]),
      ...(thirdDomain === ''
        ? []
        : [
            {
              keyword: thirdDomain,
              customName: domainCustomNames[2] ?? '',
            },
          ]),
    ];
    if (keywords.length === 0) {
      setLocalFeedback({
        kind: 'error',
        title: '至少需要一个内容关键词',
        detail: '关键词用于 Entry 搜索与后续关联候选，不会替代正文。',
      });
      return;
    }
    setSaving(true);
    setLocalFeedback(undefined);
    try {
      const response = await onRevise(entry.entryId, {
        expectedRevision: entry.revision,
        includePrivate,
        annotation: {
          body,
          contentKeywords: keywords,
          typeKeyword,
          ...(typeKeyword === 'other' ? {typeCustomName} : {}),
          domains: selections.map(({customName, keyword}) => ({
            keyword,
            ...(keyword === 'other' ? {customName} : {}),
          })),
        },
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setLocalFeedback({
          kind: 'error',
          title: '条目标注没有保存',
          detail: describeFailure(response.body),
        });
        return;
      }
      await onSaved({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? 'Entry 新修订已保存'
            : 'Entry 内容没有变化',
        detail:
          response.body.status === 'applied'
            ? '旧修订仍保留；搜索现在读取新的当前修订。'
            : '没有创建重复修订。',
      });
    } catch {
      setLocalFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '本次编辑没有写入；原始 Snapshot 与当前 Entry 保持不变。',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="entry-editor" aria-labelledby="entry-editor-title">
      <header className="console-heading">
        <div>
          <p className="section-index">
            CURRENT REVISION / {entry.revision.toString()}
          </p>
          <h2 id="entry-editor-title">
            {entry.value.titlePath || '未命名条目'}
          </h2>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            onOpenEvidence(
              entry.snapshotId,
              entry.value.fragmentIds[0],
              entry.value.isPrivate,
            );
          }}
        >
          查看精确来源
        </button>
      </header>
      <form
        className="entry-editor-form"
        onSubmit={(event) => void save(event)}
      >
        <label className="field field--full">
          <span>Entry 正文</span>
          <textarea
            rows={12}
            value={body}
            onChange={(event) => {
              setBody(event.currentTarget.value);
            }}
          />
          <small>编辑会追加修订，不会修改原始 Fragment。</small>
        </label>
        <label className="field field--full">
          <span>内容关键词（逗号或换行分隔）</span>
          <textarea
            rows={3}
            value={contentKeywords}
            onChange={(event) => {
              setContentKeywords(event.currentTarget.value);
            }}
            placeholder="例如：PostgreSQL，全文检索，个人知识库"
          />
        </label>
        <label className="field">
          <span>类型关键词</span>
          <select
            value={typeKeyword}
            onChange={(event) => {
              setTypeKeyword(event.currentTarget.value as EntryTypeKeyword);
            }}
          >
            {ENTRY_TYPE_KEYWORDS.map((keyword) => (
              <option key={keyword} value={keyword}>
                {TYPE_LABELS[keyword]}
              </option>
            ))}
          </select>
        </label>
        {typeKeyword === 'other' ? (
          <label className="field">
            <span>自定义类型名称</span>
            <input
              value={typeCustomName}
              onChange={(event) => {
                setTypeCustomName(event.currentTarget.value);
              }}
              required
            />
          </label>
        ) : null}
        <DomainField
          label="主领域"
          value={primaryDomain}
          customName={domainCustomNames[0] ?? ''}
          required
          onChange={(value) => {
            if (value !== '') setPrimaryDomain(value);
          }}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              value,
              current[1] ?? '',
              current[2] ?? '',
            ]);
          }}
        />
        <DomainField
          label="副领域 1（可选）"
          value={secondaryDomain}
          customName={domainCustomNames[1] ?? ''}
          onChange={setSecondaryDomain}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              current[0] ?? '',
              value,
              current[2] ?? '',
            ]);
          }}
        />
        <DomainField
          label="副领域 2（可选）"
          value={thirdDomain}
          customName={domainCustomNames[2] ?? ''}
          onChange={setThirdDomain}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              current[0] ?? '',
              current[1] ?? '',
              value,
            ]);
          }}
        />
        <ActionNotice feedback={localFeedback} />
        <div className="form-commit field--full">
          <p>保存后形成不可变修订；类型、领域和内容关键词彼此独立。</p>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? '正在保存…' : '保存 Entry 修订'}
          </button>
        </div>
      </form>
    </section>
  );
}

function DomainField({
  customName,
  label,
  onChange,
  onCustomNameChange,
  required = false,
  value,
}: {
  readonly customName: string;
  readonly label: string;
  readonly onChange: (value: '' | EntryDomainKeyword) => void;
  readonly onCustomNameChange: (value: string) => void;
  readonly required?: boolean;
  readonly value: '' | EntryDomainKeyword;
}) {
  return (
    <div className="entry-domain-field">
      <label className="field">
        <span>{label}</span>
        <select
          value={value}
          required={required}
          onChange={(event) => {
            onChange(event.currentTarget.value as '' | EntryDomainKeyword);
          }}
        >
          <option value="" disabled={required}>
            {required ? '选择主领域' : '不设置'}
          </option>
          {ENTRY_DOMAIN_KEYWORDS.map((keyword) => (
            <option key={keyword} value={keyword}>
              {DOMAIN_LABELS[keyword]}
            </option>
          ))}
        </select>
      </label>
      {value === 'other' ? (
        <label className="field">
          <span>自定义领域名称</span>
          <input
            value={customName}
            onChange={(event) => {
              onCustomNameChange(event.currentTarget.value);
            }}
            required
          />
        </label>
      ) : null}
    </div>
  );
}

function matchReasonLabel(value: string): string {
  switch (value) {
    case 'title':
      return '标题';
    case 'body':
      return '正文';
    case 'content_keyword':
      return '内容词';
    case 'type_keyword':
      return '类型';
    case 'domain_keyword':
      return '领域';
    default:
      return value;
  }
}

function describeFailure(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '返回协议无法识别。';
  const issue = Reflect.get(value, 'issue') as unknown;
  if (typeof issue !== 'object' || issue === null) return '返回协议无法识别。';
  const code: unknown = Reflect.get(issue, 'code');
  return typeof code === 'string' ? code : 'unknown_failure';
}
