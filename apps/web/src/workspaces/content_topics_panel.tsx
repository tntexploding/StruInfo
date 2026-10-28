import {useEffect, useState, useCallback, useRef} from 'react';
import type {InformationEntry} from '../api/m1c_api_contract.js';
import type {
  TopicsResponse,
  TopicCandidateView,
  TopicView,
  TopicMember,
} from '../api/topic_contract.js';
import {aiWorkflowCommand, aiError} from '../api/ai_workflow_client.js';
import {TopicManualTools} from './topic_manual_tools.js';
const stateNames: Record<string, string> = {
  queued: '等待运行',
  running: '正在归组',
  succeeded: '已完成',
  failed: '需要检查',
  paused: '已暂停',
  cancelled: '已取消',
};
const relationNames = {
  supports: '支持',
  contradicts: '反驳',
  continues: '延续',
  replaces: '替代',
};
export function ContentTopicsPanel({
  entry,
  onRead,
  active,
}: {
  entry?: InformationEntry;
  onRead: (id: string) => void;
  active: boolean;
}) {
  const [data, setData] = useState<TopicsResponse>({topics: [], jobs: []});
  const [tab, setTab] = useState('topics'),
    [all, setAll] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [candidateResult, setCandidates] = useState<{
    entryId: string;
    items: TopicCandidateView[];
  }>();
  const candidates =
    candidateResult?.entryId === entry?.entryId
      ? candidateResult?.items
      : undefined;
  const [limit, setLimit] = useState(8),
    [relations, setRelations] = useState(0),
    [budget, setBudget] = useState('');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [cross, setCross] = useState(false);
  const [name, setName] = useState(''),
    [scope, setScope] = useState('');
  const [target, setTarget] = useState(''),
    [quote, setQuote] = useState(''),
    [reason, setReason] = useState('');
  const lock = useRef(false);
  const loadEpoch = useRef({value: 0});
  const load = useCallback(async () => {
    const requests = loadEpoch.current;
    const epoch = ++requests.value;
    const payload = await aiWorkflowCommand<unknown>(
      'topics_list',
      all || !entry ? {} : {entryId: entry.entryId},
    );
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('topics' in payload) ||
      !('jobs' in payload) ||
      !Array.isArray(payload.topics) ||
      !Array.isArray(payload.jobs)
    )
      throw new Error('topic_unavailable');
    if (epoch !== requests.value) return;
    const r = payload as TopicsResponse;
    setData(r);
    const activeBudget = r.budget;
    if (activeBudget) setBudget((current) => current || activeBudget.batchId);
  }, [all, entry]);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const requests = loadEpoch.current;
    void Promise.resolve()
      .then(load)
      .catch((e: unknown) => {
        if (mounted) setError(aiError(e));
      });
    return () => {
      mounted = false;
      requests.value++;
    };
  }, [load, active]);
  useEffect(() => {
    if (
      !active ||
      !data.jobs.some((j) => ['queued', 'running'].includes(j.status))
    )
      return;
    const timer = setInterval(() => {
      if (!document.hidden)
        void Promise.resolve()
          .then(load)
          .catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [data.jobs, load, active]);
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      await load();
    } catch (e) {
      setError(aiError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function requestScope() {
    return {
      entryId: entry?.entryId,
      candidateLimit: limit,
      maxRelations: relations,
      crossConditions: cross,
      ...(from
        ? {publishedFrom: new Date(from + 'T00:00:00').toISOString()}
        : {}),
      ...(to ? {publishedTo: new Date(to + 'T23:59:59').toISOString()} : {}),
    };
  }
  function decide(
    t: TopicView,
    m: TopicMember,
    decision: 'pinned' | 'excluded',
  ) {
    void action(async () => {
      await aiWorkflowCommand('topic_member_set', {
        topicId: t.id,
        expectedVersion: t.version,
        member: {
          entryId: m.entryId,
          revision: m.revision,
          quote: m.quote,
          reason: m.reason,
          decision,
        },
      });
      setMessage(
        decision === 'pinned' ? '已固定这个成员。' : '已排除这个成员。',
      );
    });
  }
  return (
    <div className="content-topics-panel">
      <div className="reading-segments" role="group" aria-label="主题工具">
        {[
          ['topics', '主题'],
          ['candidates', '相似候选'],
          ['jobs', '归组任务'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id ?? 'topics');
            }}
            className="secondary-action"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="topic-actions">
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => {
              setAll(e.target.checked);
            }}
          />
          查看全部主题与任务
        </label>
        <button
          disabled={busy}
          onClick={() => void action(load)}
          className="secondary-action"
        >
          刷新
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {tab === 'candidates' && (
        <>
          <p>先看候选，再决定是否让 AI 归组。候选相似度不代表已建立联系。</p>
          {!entry ? (
            <p>先选择一条已入库的内容。</p>
          ) : (
            <>
              <div className="topic-form-grid">
                <label>
                  候选上限（含本条）
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={limit}
                    onChange={(e) => {
                      setLimit(Number(e.target.value));
                      setCandidates(undefined);
                    }}
                  />
                </label>
                <label>
                  重点联系上限
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={relations}
                    onChange={(e) => {
                      setRelations(Number(e.target.value));
                      setCandidates(undefined);
                    }}
                  />
                </label>
                <label>
                  发布起日
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setCandidates(undefined);
                    }}
                  />
                </label>
                <label>
                  发布止日
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setCandidates(undefined);
                    }}
                  />
                </label>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={cross}
                  onChange={(e) => {
                    setCross(e.target.checked);
                    setCandidates(undefined);
                  }}
                />
                允许比较不同适用条件
              </label>
              <div className="topic-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const r = await aiWorkflowCommand<{
                        candidates: TopicCandidateView[];
                      }>('topics_preview', requestScope());
                      setCandidates({
                        entryId: entry.entryId,
                        items: r.candidates,
                      });
                    })
                  }
                  className="secondary-action"
                >
                  查找候选
                </button>
              </div>
              {candidates?.length === 0 && (
                <p>暂无合适候选。可以继续阅读，不必强行建联。</p>
              )}
              {candidates?.map((c) => (
                <article className="topic-card" key={c.entryId}>
                  <button
                    className="text-action topic-link"
                    onClick={() => {
                      onRead(c.entryId);
                    }}
                  >
                    {c.title || '无标题条目'}
                  </button>
                  <p>{c.source}</p>
                  <p>{c.reasons.join('；')}</p>
                  <small>
                    待确认 · 独立来源共现样本 {c.samples} 份
                    {c.samples < 2 ? ' · 样本较少' : ''}
                  </small>
                </article>
              ))}
              <label>
                已有批次预算编号
                <input
                  value={budget}
                  onChange={(e) => {
                    setBudget(e.target.value);
                  }}
                  placeholder="填写已配置的批次编号"
                />
              </label>
              <p>
                使用该批次的剩余额度，遵守 AI 总控和价格时段。不会另增预算。
              </p>
              {data.budget && (
                <p>
                  当前预算：{data.budget.remainingCny.toFixed(2)} /{' '}
                  {data.budget.limitCny.toFixed(2)} 元可用
                  {data.budget.paused ? ' · 已暂停' : ''}
                </p>
              )}
              <button
                disabled={busy || !budget || !candidates?.length}
                onClick={() =>
                  void action(async () => {
                    const r = await aiWorkflowCommand<{
                      reused: boolean;
                    }>('topic_job_start', {
                      scope: requestScope(),
                      budgetId: budget,
                    });
                    setMessage(
                      r.reused
                        ? '已找到相同输入的任务，可在归组任务中查看。'
                        : '归组已排队。',
                    );
                    setTab('jobs');
                  })
                }
                className="secondary-action"
              >
                让 AI 检查并归组
              </button>
            </>
          )}
        </>
      )}
      {tab === 'topics' && (
        <>
          {!data.topics.length && (
            <p>暂无主题。可以先查找候选，也可以手动创建。</p>
          )}
          {data.topics.map((t) => (
            <article className="topic-card" key={t.id}>
              <h3>{t.value.name}</h3>
              <p>{t.value.scope}</p>
              {t.value.summary && <p>{t.value.summary}</p>}
              {t.stale && <p className="topic-notice">概述待更新</p>}
              <h4>主题成员</h4>
              {t.value.members.map((m) => (
                <div className="topic-member" key={m.entryId}>
                  <button
                    className="text-action topic-link"
                    onClick={() => {
                      onRead(m.entryId);
                    }}
                  >
                    {t.entries.find((e) => e.entryId === m.entryId)?.title ??
                      '查看条目'}
                  </button>
                  <small>
                    {m.decision === 'pinned'
                      ? '人工固定'
                      : m.decision === 'excluded'
                        ? '已排除'
                        : 'AI 归组'}
                    {t.entries.find((e) => e.entryId === m.entryId)?.stale
                      ? ' · 正文已更新'
                      : ''}
                  </small>
                  <p>{m.reason}</p>
                  <blockquote>{m.quote}</blockquote>
                  <div className="topic-actions">
                    <button
                      disabled={busy || m.decision === 'pinned'}
                      onClick={() => {
                        decide(t, m, 'pinned');
                      }}
                      className="secondary-action"
                    >
                      固定
                    </button>
                    <button
                      disabled={busy || m.decision === 'excluded'}
                      onClick={() => {
                        decide(t, m, 'excluded');
                      }}
                      className="secondary-action"
                    >
                      排除
                    </button>
                  </div>
                </div>
              ))}
              <h4>重点联系</h4>
              {!t.value.relations.length && <p>暂无具体联系。</p>}
              {t.value.relations.map((r, i) => (
                <div className="topic-member" key={i}>
                  <strong>
                    {relationNames[r.kind]}
                    {r.blocked ? ' · 已屏蔽' : ''}
                  </strong>
                  <p>{r.reason}</p>
                  <button
                    className="text-action topic-link"
                    onClick={() => {
                      onRead(r.from.entryId);
                    }}
                  >
                    {t.entries.find((e) => e.entryId === r.from.entryId)
                      ?.title ?? '来源条目'}
                  </button>
                  <blockquote>{r.from.quote}</blockquote>
                  <button
                    className="text-action topic-link"
                    onClick={() => {
                      onRead(r.to.entryId);
                    }}
                  >
                    {t.entries.find((e) => e.entryId === r.to.entryId)?.title ??
                      '目标条目'}
                  </button>
                  <blockquote>{r.to.quote}</blockquote>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const relation = {
                          from: r.from,
                          to: r.to,
                          kind: r.kind,
                          reason: r.reason,
                        };
                        await aiWorkflowCommand('topic_relation_set', {
                          topicId: t.id,
                          expectedVersion: t.version,
                          relation: {...relation, blocked: !r.blocked},
                        });
                      })
                    }
                    className="secondary-action"
                  >
                    {r.blocked ? '恢复联系' : '屏蔽联系'}
                  </button>
                </div>
              ))}
              <TopicManualTools
                topic={t}
                busy={busy}
                save={(command, input) =>
                  action(async () => {
                    await aiWorkflowCommand(command, input);
                    setMessage('已保存。');
                  })
                }
              />
            </article>
          ))}
          <details>
            <summary>手动创建主题</summary>
            <label>
              名称
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </label>
            <label>
              范围
              <textarea
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                }}
              />
            </label>
            <button
              disabled={busy || !name.trim() || !scope.trim()}
              onClick={() =>
                void action(async () => {
                  await aiWorkflowCommand('topic_save', {
                    expectedVersion: 0,
                    name,
                    scope,
                  });
                  setName('');
                  setScope('');
                  setAll(true);
                  setMessage('已创建主题。');
                })
              }
              className="secondary-action"
            >
              创建
            </button>
          </details>
          {entry && (
            <details>
              <summary>把当前条目加入主题</summary>
              <label>
                选择主题
                <select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                  }}
                >
                  <option value="">请选择</option>
                  {data.topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.value.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                加入理由
                <input
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </label>
              <label>
                正文依据
                <textarea
                  value={quote}
                  onChange={(e) => {
                    setQuote(e.target.value);
                  }}
                  placeholder="粘贴本条正文中的一句话"
                />
              </label>
              <button
                disabled={busy || !target || !reason || !quote}
                onClick={() =>
                  void action(async () => {
                    const t = data.topics.find((t) => t.id === target);
                    if (!t) return;
                    await aiWorkflowCommand('topic_member_set', {
                      topicId: t.id,
                      expectedVersion: t.version,
                      member: {
                        entryId: entry.entryId,
                        revision: entry.revision,
                        quote,
                        reason,
                        decision: 'pinned',
                      },
                    });
                    setMessage('已加入并固定。');
                  })
                }
                className="secondary-action"
              >
                加入并固定
              </button>
            </details>
          )}
        </>
      )}
      {tab === 'jobs' && (
        <>
          {!data.jobs.length && <p>暂无归组任务。基础内容已经可以查询。</p>}
          {data.jobs.map((j) => (
            <article className="topic-card" key={j.id}>
              <h3>{stateNames[j.status] ?? j.status}</h3>
              <p>
                {j.entries.length} 条内容 · 已尝试 {j.attempts}/{j.maxAttempts}{' '}
                次
              </p>
              <p>
                预算 {j.budgetId} · {(j.chargedNanoCny / 1e9).toFixed(4)} 元
                {j.usageKnown ? '（估算）' : '（含未确认预留）'}
              </p>
              {j.errorCode && (
                <p role="status">{aiError(new Error(j.errorCode))}</p>
              )}
              {j.note && <p>{j.note}</p>}
              <details>
                <summary>本组条目</summary>
                {j.entries.map((e) => (
                  <button
                    key={e.entryId}
                    className="text-action topic-link"
                    onClick={() => {
                      onRead(e.entryId);
                    }}
                  >
                    {e.title || '查看条目'}
                  </button>
                ))}
              </details>
              <div className="topic-actions">
                {j.canResume && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await aiWorkflowCommand('topic_job_control', {
                          jobId: j.id,
                          expectedVersion: j.version,
                          action: 'resume',
                        });
                      })
                    }
                    className="secondary-action"
                  >
                    从断点继续
                  </button>
                )}
                {!['succeeded', 'cancelled'].includes(j.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await aiWorkflowCommand('topic_job_control', {
                          jobId: j.id,
                          expectedVersion: j.version,
                          action: 'cancel',
                        });
                      })
                    }
                    className="secondary-action"
                  >
                    取消任务
                  </button>
                )}
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
