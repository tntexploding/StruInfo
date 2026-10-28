import {useEffect, useRef, useState} from 'react';
import {aiWorkflowCommand, aiError} from '../api/ai_workflow_client.js';
import type {
  SourceSplitCatalogView,
  SourceSplitDefinition,
  SourceSplitPlan,
  SourceSplitSettings,
} from '../api/source_split_contract.js';
import './source_split_recipe_panel.css';

const templates = {
  whole: '整篇保留',
  numbered: '独立编号条目',
  headings: '同级标题条目',
  directory: '带说明的链接目录',
};
const statuses = {
  draft: '草稿',
  trial: '已试读',
  enabled: '已启用',
  paused: '已暂停',
  replaced: '已替代',
};
const reasons: Record<string, string> = {
  recipe_ready: '范围完整，可核对切点。',
  recipe_text_capacity: '正文超过本次处理容量，原文保留。',
  recipe_title_mismatch: '标题与方案条件不符。',
  recipe_format_mismatch: '没有找到约定的条目起点。',
  recipe_entry_count_changed: '条目数超出设定范围，请核对格式。',
  recipe_entry_capacity: '条目超过上限，本次不应用。',
  recipe_number_sequence_changed: '编号不连续或重新起号，请核对独立条目。',
  recipe_body_too_short: '部分条目正文过短，请核对是否只是目录或附录。',
  recipe_coverage_invalid: '原文范围未完整覆盖，本次不应用。',
};
const initialSettings: SourceSplitSettings = {
  template: 'whole',
  headingLevel: 2,
  titleIncludes: [],
  appendixHeadings: [],
  minimumEntries: 1,
  maximumEntries: 1,
  minimumBodyCharacters: 0,
  onMismatch: 'review',
};
const lines = (text: string) =>
  text
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);

const definition = (r: SourceSplitDefinition): SourceSplitDefinition => ({
  recipeId: r.recipeId,
  revision: r.revision,
  name: r.name,
  scope: r.scope,
  settings: r.settings,
  origin: r.origin,
});
const fresh = (
  view: SourceSplitCatalogView,
  snapshotId: string,
): SourceSplitDefinition => ({
  recipeId: crypto.randomUUID(),
  revision: 1,
  name: '',
  origin: 'manual',
  scope: view.sourceId
    ? {kind: 'source', sourceId: view.sourceId}
    : {kind: 'document', snapshotId},
  settings: {...initialSettings},
});

export function SourceSplitRecipePanel({
  snapshotId,
  includePrivate,
  isPrivate,
  hasEntries,
  onApplied,
  configurationOnly = false,
}: {
  snapshotId: string;
  includePrivate: boolean;
  isPrivate: boolean;
  hasEntries: boolean;
  onApplied: () => void;
  configurationOnly?: boolean;
}) {
  const [catalog, setCatalog] = useState<SourceSplitCatalogView>();
  const [draft, setDraft] = useState<SourceSplitDefinition>();
  const [replaces, setReplaces] = useState<string>();
  const [plan, setPlan] = useState<SourceSplitPlan>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState('');
  const [sampleKind, setSampleKind] = useState('typical');
  const [expected, setExpected] = useState('ready');
  const lock = useRef(false);
  const active = catalog?.recipes.find((r) => r.recipeId === draft?.recipeId);
  const locked = active?.status === 'enabled' || active?.status === 'replaced';
  const dirty =
    !!draft &&
    (!active || JSON.stringify(definition(active)) !== JSON.stringify(draft));
  const command = <T,>(
    operation: string,
    input: Record<string, unknown> = {},
  ) => aiWorkflowCommand<T>(operation, {snapshotId, includePrivate, ...input});
  useEffect(() => {
    let live = true;
    void aiWorkflowCommand<SourceSplitCatalogView>('split_recipes_read', {
      snapshotId,
      includePrivate,
    })
      .then((value) => {
        if (live) {
          setCatalog(value);
          setDraft(
            value.recipes[0]
              ? definition(value.recipes[0])
              : fresh(value, snapshotId),
          );
        }
      })
      .catch((error: unknown) => {
        if (live) setFailure(aiError(error));
      });
    return () => {
      live = false;
    };
  }, [snapshotId, includePrivate]);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure('');
    setMessage('');
    try {
      await work();
    } catch (error) {
      setFailure(aiError(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const reload = async (recipeId: string) => {
    const value = await command<SourceSplitCatalogView>('split_recipes_read');
    setCatalog(value);
    const selected = value.recipes.find((r) => r.recipeId === recipeId);
    if (selected) setDraft(definition(selected));
  };
  if (!catalog || !draft)
    return (
      <p role={failure ? 'alert' : 'status'}>
        {failure || '正在读取拆分方案…'}
      </p>
    );
  const change = (patch: Partial<SourceSplitSettings>) => {
    setDraft({...draft, settings: {...draft.settings, ...patch}});
    setPlan(undefined);
  };
  const savedInput = {
    recipeId: draft.recipeId,
    expectedRevision: catalog.revision,
  };
  return (
    <div className="source-split-panel">
      <p>
        按来源和文章格式保存拆分方案。先预览，再应用；原文保留。连贯教程请选择整篇保留。
      </p>
      <fieldset disabled={busy}>
        <label className="field">
          <span>选择方案</span>
          <select
            value={active?.recipeId ?? ''}
            onChange={(e) => {
              const selected = catalog.recipes.find(
                (r) => r.recipeId === e.currentTarget.value,
              );
              setDraft(
                selected ? definition(selected) : fresh(catalog, snapshotId),
              );
              setReplaces(undefined);
              setPlan(undefined);
              setNote('');
            }}
          >
            <option value="">新建方案</option>
            {catalog.recipes.map((r) => (
              <option key={r.recipeId} value={r.recipeId}>
                {r.name} · {statuses[r.status]} · v{r.revision}
              </option>
            ))}
          </select>
        </label>
        <div className="source-split-actions">
          <button
            className="secondary-action"
            onClick={() => {
              void run(async () => {
                setCatalog(
                  await command<SourceSplitCatalogView>('split_recipes_read'),
                );
                setMessage('方案列表已更新，当前草稿保留。');
              });
            }}
          >
            重新读取方案
          </button>
        </div>
        <p className="muted-copy">
          {draft.scope.kind === 'source'
            ? '用于当前来源的新文档。'
            : '仅用于当前文档。'}
          {active ? ` 已保存 ${String(active.trials.length)} 份试读记录。` : ''}
        </p>
        {locked ? (
          <button
            className="secondary-action"
            onClick={() => {
              setReplaces(active.recipeId);
              setDraft({
                ...draft,
                recipeId: crypto.randomUUID(),
                revision: 1,
                name: draft.name + '（修订）',
              });
              setPlan(undefined);
            }}
          >
            复制为修订草稿
          </button>
        ) : null}
        <fieldset disabled={locked}>
          {catalog.sourceId ? (
            <label className="field">
              <span>适用范围</span>
              <select
                value={draft.scope.kind}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    scope:
                      e.currentTarget.value === 'source' && catalog.sourceId
                        ? {kind: 'source', sourceId: catalog.sourceId}
                        : {kind: 'document', snapshotId},
                  });
                  setPlan(undefined);
                }}
              >
                <option value="source">当前来源</option>
                <option value="document">仅这篇文档</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>方案名称</span>
            <input
              value={draft.name}
              maxLength={80}
              onChange={(e) => {
                setDraft({...draft, name: e.currentTarget.value});
              }}
            />
          </label>
          <label className="field">
            <span>拆分方式</span>
            <select
              value={draft.settings.template}
              onChange={(e) => {
                const template = e.currentTarget
                  .value as SourceSplitSettings['template'];
                change({
                  template,
                  minimumEntries: template === 'whole' ? 1 : 2,
                  maximumEntries: template === 'whole' ? 1 : 32,
                });
              }}
            >
              {Object.entries(templates).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="source-split-grid">
            <label className="field">
              <span>最少条目</span>
              <input
                type="number"
                min={1}
                max={64}
                value={draft.settings.minimumEntries}
                onChange={(e) => {
                  change({minimumEntries: e.currentTarget.valueAsNumber});
                }}
              />
            </label>
            <label className="field">
              <span>最多条目</span>
              <input
                type="number"
                min={1}
                max={64}
                value={draft.settings.maximumEntries}
                onChange={(e) => {
                  change({maximumEntries: e.currentTarget.valueAsNumber});
                }}
              />
            </label>
            <label className="field">
              <span>标题层级（# 的个数）</span>
              <input
                type="number"
                min={1}
                max={6}
                disabled={draft.settings.template === 'whole'}
                value={draft.settings.headingLevel}
                onChange={(e) => {
                  change({headingLevel: e.currentTarget.valueAsNumber});
                }}
              />
            </label>
            <label className="field">
              <span>条目正文最少字数</span>
              <input
                type="number"
                min={0}
                max={2000}
                value={draft.settings.minimumBodyCharacters}
                onChange={(e) => {
                  change({
                    minimumBodyCharacters: e.currentTarget.valueAsNumber,
                  });
                }}
              />
            </label>
          </div>
          <label className="field">
            <span>标题包含（每行一个，可留空）</span>
            <textarea
              rows={2}
              value={draft.settings.titleIncludes.join('\n')}
              onChange={(e) => {
                change({titleIncludes: e.currentTarget.value.split('\n')});
              }}
            />
          </label>
          <label className="field">
            <span>附录标题（每行一个，附到前一条）</span>
            <textarea
              rows={2}
              value={draft.settings.appendixHeadings.join('\n')}
              onChange={(e) => {
                change({appendixHeadings: e.currentTarget.value.split('\n')});
              }}
            />
          </label>
          <label className="field">
            <span>格式不符时</span>
            <select
              value={draft.settings.onMismatch}
              onChange={(e) => {
                change({
                  onMismatch: e.currentTarget
                    .value as SourceSplitSettings['onMismatch'],
                });
              }}
            >
              <option value="review">暂停，交给我核对</option>
              <option value="ai">使用任务原有额度交给 AI 拆分</option>
            </select>
          </label>
        </fieldset>
        <div className="source-split-actions">
          <button
            className="secondary-action"
            disabled={!draft.name.trim()}
            onClick={() => {
              void run(async () => {
                setPlan(
                  await command<SourceSplitPlan>('split_recipe_preview', {
                    definition: {
                      ...draft,
                      settings: {
                        ...draft.settings,
                        titleIncludes: lines(
                          draft.settings.titleIncludes.join('\n'),
                        ),
                        appendixHeadings: lines(
                          draft.settings.appendixHeadings.join('\n'),
                        ),
                      },
                    },
                  }),
                );
              });
            }}
          >
            预览切点
          </button>
          <button
            className="primary-action"
            disabled={locked || !draft.name.trim()}
            onClick={() => {
              void run(async () => {
                await command('split_recipe_save', {
                  expectedRevision: catalog.revision,
                  definition: {
                    ...draft,
                    revision: (active?.revision ?? 0) + 1,
                    settings: {
                      ...draft.settings,
                      titleIncludes: lines(
                        draft.settings.titleIncludes.join('\n'),
                      ),
                      appendixHeadings: lines(
                        draft.settings.appendixHeadings.join('\n'),
                      ),
                    },
                  },
                  ...(replaces ? {replaces} : {}),
                });
                await reload(draft.recipeId);
                setMessage('草稿已保存。');
              });
            }}
          >
            保存草稿
          </button>
          <button
            className="secondary-action"
            disabled={locked || isPrivate}
            onClick={() => {
              void run(async () => {
                const suggestion = await command<{
                  name: string;
                  settings: SourceSplitSettings;
                  explanation: string;
                  preview: SourceSplitPlan;
                }>('split_recipe_suggest');
                setDraft({
                  ...draft,
                  name: suggestion.name,
                  settings: suggestion.settings,
                  origin: 'model',
                });
                setPlan(suggestion.preview);
                setMessage('AI 建议尚未保存：' + suggestion.explanation);
              });
            }}
          >
            AI 建议方案
          </button>
        </div>
        {active ? (
          <section className="source-split-trials">
            <h3>试读与启用</h3>
            <p>
              {draft.scope.kind === 'source'
                ? '来源方案需试读至少两篇不同文档，包含变体或例外样本。'
                : '本篇方案需记录当前文档的试读。'}
              核对切点后再启用。
            </p>
            <div className="source-split-grid">
              <label className="field">
                <span>本篇样本</span>
                <select
                  value={sampleKind}
                  onChange={(e) => {
                    setSampleKind(e.currentTarget.value);
                  }}
                >
                  <option value="typical">常见格式</option>
                  <option value="variant">格式变体</option>
                  <option value="exception">例外情况</option>
                </select>
              </label>
              <label className="field">
                <span>预期结果</span>
                <select
                  value={expected}
                  onChange={(e) => {
                    setExpected(e.currentTarget.value);
                  }}
                >
                  <option value="ready">正常拆分</option>
                  <option value="review">应当暂停</option>
                </select>
              </label>
            </div>
            <button
              className="secondary-action"
              disabled={dirty || active.status === 'replaced'}
              onClick={() => {
                void run(async () => {
                  const result = await command<{plan: SourceSplitPlan}>(
                    'split_recipe_trial',
                    {...savedInput, sampleKind, expected},
                  );
                  setPlan(result.plan);
                  await reload(draft.recipeId);
                  setMessage('试读已记录，正文未修改。');
                });
              }}
            >
              记录本篇试读
            </button>
            <ul>
              {active.trials.map((t) => (
                <li key={t.snapshotId}>
                  {t.snapshotId === snapshotId
                    ? '当前文档'
                    : t.snapshotId.slice(0, 8)}{' '}
                  · {t.entryCount} 条 ·{' '}
                  {t.outcome === t.expected ? '符合预期' : '需核对'}
                  {t.reason !== 'recipe_ready'
                    ? ` · ${reasons[t.reason] ?? t.reason}`
                    : ''}
                </li>
              ))}
            </ul>
            <label className="field">
              <span>核对说明</span>
              <textarea
                rows={2}
                value={note}
                maxLength={400}
                placeholder="例如：已检查两期文章，正文连续，前言和附录归属正确。"
                onChange={(e) => {
                  setNote(e.currentTarget.value);
                }}
              />
            </label>
            <div className="source-split-actions">
              <button
                className="primary-action"
                disabled={
                  dirty ||
                  active.status === 'enabled' ||
                  active.status === 'replaced' ||
                  !note.trim()
                }
                onClick={() => {
                  void run(async () => {
                    await command('split_recipe_control', {
                      ...savedInput,
                      action: 'enable',
                      note,
                    });
                    await reload(draft.recipeId);
                    setMessage('已启用。新任务会保存当前方案版本。');
                  });
                }}
              >
                启用方案
              </button>
              <button
                className="secondary-action"
                disabled={active.status !== 'enabled'}
                onClick={() => {
                  void run(async () => {
                    await command('split_recipe_control', {
                      ...savedInput,
                      action: 'pause',
                      note: '',
                    });
                    await reload(draft.recipeId);
                    setMessage('已暂停。已创建任务保留原方案。');
                  });
                }}
              >
                暂停方案
              </button>
              {!configurationOnly ? (
                <button
                  className="secondary-action"
                  disabled={dirty || hasEntries || active.status !== 'enabled'}
                  onClick={() => {
                    void run(async () => {
                      const result = await command<{createdCount: number}>(
                        'split_recipe_apply',
                        savedInput,
                      );
                      setMessage(
                        `已生成 ${String(result.createdCount)} 个条目，确认后入库。`,
                      );
                      onApplied();
                    });
                  }}
                >
                  应用到当前文档
                </button>
              ) : null}
            </div>
            {hasEntries && !configurationOnly ? (
              <p>当前已有条目。修改现有切点请使用“修改分段”。</p>
            ) : null}
          </section>
        ) : null}
      </fieldset>
      {plan ? (
        <section aria-label="拆分预览">
          <h3>
            {plan.outcome === 'ready'
              ? `${String(plan.groups.length)} 个条目 · 原文完整覆盖`
              : '需要核对'}
          </h3>
          <p>{reasons[plan.reason] ?? plan.reason}</p>
          <ol>
            {plan.groups.map((g) => (
              <li key={g.start}>
                <strong>{g.title}</strong>
                <span>
                  原文第 {g.start + 1}–{g.end} 字
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {failure ? <p role="alert">{failure}</p> : null}
      {busy ? <p role="status">正在处理…</p> : null}
    </div>
  );
}
