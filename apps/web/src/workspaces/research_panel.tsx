import {useEffect, useRef, useState} from 'react';
import {
  researchCommand,
  researchError,
  type ResearchStatus,
  type WebEvidence,
  type ResearchAnswer,
} from '../api/research_client.js';
export function ResearchPanel({
  active,
  query,
  settingsOnly = false,
}: {
  active: boolean;
  settingsOnly?: boolean;
  query: Readonly<Record<string, unknown>>;
}) {
  const [status, updateStatus] = useState<ResearchStatus>();
  const dirty = useRef(false);
  const setStatus = (next: ResearchStatus) => {
    dirty.current = true;
    updateStatus(next);
  };
  const mergeStatus = (next: ResearchStatus) => {
    updateStatus((previous) =>
      dirty.current && previous
        ? {...next, settings: previous.settings, version: previous.version}
        : next,
    );
  };
  const queryIdentity = JSON.stringify(query);
  const scope = useRef(queryIdentity);
  const [mode, setMode] = useState<'web' | 'mixed' | 'local'>('web');
  const [question, setQuestion] = useState(''),
    [webQuery, setWebQuery] = useState('');
  const [resultScope, setResultScope] = useState(queryIdentity);
  const [searchValue, setSearch] = useState<{
    sessionId: string;
    results: WebEvidence[];
    warnings: string[];
  }>();
  const [answerValue, setAnswer] = useState<ResearchAnswer>();
  const search = resultScope === queryIdentity ? searchValue : undefined;
  const answer = resultScope === queryIdentity ? answerValue : undefined;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const lock = useRef(false);
  const key = useRef(crypto.randomUUID());
  const change = () => {
    key.current = crypto.randomUUID();
    setAnswer(undefined);
    setSearch(undefined);
    setMessage('');
  };
  const refresh = () =>
    researchCommand<ResearchStatus>('research_status').then(mergeStatus);
  useEffect(() => {
    scope.current = queryIdentity;
    key.current = crypto.randomUUID();
  }, [queryIdentity]);
  useEffect(() => {
    if (!active) return;
    let valid = true;
    void researchCommand<ResearchStatus>('research_status')
      .then((v) => {
        if (valid)
          updateStatus((previous) =>
            dirty.current && previous
              ? {...v, settings: previous.settings, version: previous.version}
              : v,
          );
      })
      .catch((e: unknown) => {
        if (valid) setError(researchError(e));
      });
    return () => {
      valid = false;
    };
  }, [active]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(researchError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const blocked = Boolean(query.includePrivate) || Boolean(query.onlyPrivate);
  const save = (sessionId: string, index: number) =>
    run(async () => {
      await researchCommand('web_capture', {sessionId, index});
      setMessage('已保存到文档入口，等待审核。');
    });
  return (
    <section className="research-panel" aria-label="联网研究">
      {!settingsOnly && (
        <p>
          库内范围沿用当前筛选。联网只发送搜索词。联网开关和请求上限在设置中调整。
        </p>
      )}
      {status ? (
        <div className="research-status">
          <span>
            DeepSeek 搜索 ·{' '}
            {status.configured
              ? status.settings.enabled
                ? '已开启'
                : '已关闭'
              : '未配置'}
          </span>
          <span>
            今日 {status.requests}/{status.settings.dailyRequests} 次（UTC） ·
            估算 ¥{status.estimatedCny.toFixed(3)}
          </span>
        </div>
      ) : null}
      {status && settingsOnly ? (
        <fieldset disabled={busy}>
          <legend>联网设置</legend>
          <div className="research-fields">
            <label>
              <input
                type="checkbox"
                checked={status.settings.enabled}
                disabled={busy || !status.configured}
                onChange={(e) => {
                  setStatus({
                    ...status,
                    settings: {...status.settings, enabled: e.target.checked},
                  });
                }}
              />
              允许联网搜索
            </label>
            <label>
              每日请求上限
              <input
                type="number"
                min={1}
                max={200}
                value={status.settings.dailyRequests}
                onChange={(e) => {
                  setStatus({
                    ...status,
                    settings: {
                      ...status.settings,
                      dailyRequests: Number(e.target.value),
                    },
                  });
                }}
              />
            </label>
            <label>
              每次结果数
              <input
                type="number"
                min={1}
                max={8}
                value={status.settings.resultLimit}
                onChange={(e) => {
                  setStatus({
                    ...status,
                    settings: {
                      ...status.settings,
                      resultLimit: Number(e.target.value),
                    },
                  });
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={status.settings.fetchMissing}
                onChange={(e) => {
                  setStatus({
                    ...status,
                    settings: {
                      ...status.settings,
                      fetchMissing: e.target.checked,
                    },
                  });
                }}
              />
              摘要缺正文时尝试抓取（计入请求数）
            </label>
          </div>
          <button
            className="secondary-action"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await researchCommand('research_settings_save', {
                  expectedVersion: status.version,
                  settings: status.settings,
                });
                dirty.current = false;
                setMessage('联网设置已保存。');
              })
            }
          >
            保存联网设置
          </button>
          <button
            className="text-action"
            disabled={busy}
            onClick={() =>
              void run(() => {
                dirty.current = false;
                return Promise.resolve();
              })
            }
          >
            放弃修改并重读
          </button>
        </fieldset>
      ) : null}
      {!settingsOnly && (
        <>
          <div className="research-fields">
            <label>
              证据范围
              <select
                disabled={busy}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  change();
                }}
              >
                <option value="web">网页</option>
                <option value="mixed">库内与网页</option>
                <option value="local">仅库内</option>
              </select>
            </label>
            {mode !== 'local' ? (
              <label>
                公开搜索词
                <input
                  disabled={busy}
                  value={webQuery}
                  maxLength={128}
                  placeholder="例如：内存带宽优化 after:2025 site:example.com"
                  onChange={(e) => {
                    setWebQuery(e.target.value);
                    change();
                  }}
                />
              </label>
            ) : null}
          </div>
          <label className="field">
            希望了解什么
            <textarea
              disabled={busy}
              rows={2}
              maxLength={600}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                change();
              }}
            />
          </label>
          {blocked ? (
            <p role="status">当前包含隐私资料。请切换到公开范围后使用。</p>
          ) : null}
          <div className="entry-command-actions">
            {mode !== 'local' ? (
              <button
                className="secondary-action"
                disabled={busy || blocked || !webQuery.trim()}
                onClick={() =>
                  void run(async () => {
                    setAnswer(undefined);
                    const result = await researchCommand<
                      NonNullable<typeof search>
                    >('web_search', {
                      requestKey: key.current,
                      query: webQuery,
                    });
                    if (scope.current === queryIdentity) {
                      setResultScope(queryIdentity);
                      setSearch(result);
                    }
                  })
                }
              >
                只搜索网页
              </button>
            ) : null}
            <button
              className="primary-action"
              disabled={
                busy ||
                blocked ||
                !question.trim() ||
                (mode !== 'local' && !webQuery.trim())
              }
              onClick={() =>
                void run(async () => {
                  const result = await researchCommand<ResearchAnswer>(
                    'research_answer',
                    {
                      requestKey: key.current,
                      question,
                      mode,
                      query,
                      ...(mode === 'local' ? {} : {webQuery}),
                    },
                  );
                  if (scope.current === queryIdentity) {
                    setResultScope(queryIdentity);
                    setAnswer(result);
                  }
                })
              }
            >
              {busy ? '正在处理…' : '根据材料回答'}
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          {message ? <p role="status">{message}</p> : null}
          {search?.warnings.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
          {answer ? (
            <section aria-label="回答与引用">
              <p className="research-answer">{answer.answer}</p>
              {answer.claims.map((c, i) => (
                <p key={i}>
                  {c.statement} <small>{c.evidenceRefs.join(' · ')}</small>
                </p>
              ))}
              {answer.limitations.map((s, i) => (
                <p className="field-help" key={i}>
                  {s}
                </p>
              ))}
              {answer.evidence.map((e) => (
                <article className="research-result" key={e.handle}>
                  <strong>
                    {e.handle} · {e.titlePath}
                  </strong>
                  <small>
                    {e.origin === 'local'
                      ? '库内已确认资料'
                      : e.contentKind === 'body'
                        ? '网页正文'
                        : '网页摘要'}
                    {e.retrievedAt
                      ? ' · 获取于 ' + new Date(e.retrievedAt).toLocaleString()
                      : ''}
                  </small>
                  <p>{e.excerpt}</p>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      打开网页
                    </a>
                  ) : null}
                  {e.sessionId &&
                  e.index !== undefined &&
                  e.contentKind === 'body' ? (
                    <button
                      className="secondary-action"
                      disabled={busy}
                      onClick={() =>
                        e.sessionId && e.index !== undefined
                          ? void save(e.sessionId, e.index)
                          : undefined
                      }
                    >
                      保存到待审核
                    </button>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
          {search && !answer ? (
            <section aria-label="网页结果">
              {search.results.length === 0 ? <p>没有找到结果。</p> : null}
              {search.results.map((r, i) => (
                <article className="research-result" key={r.url}>
                  <h3>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                    </a>
                  </h3>
                  <small>
                    {r.contentKind === 'body' ? '已取得正文' : '只有摘要'} ·{' '}
                    {new Date(r.retrievedAt).toLocaleString()}
                  </small>
                  <p>{r.summary || r.content.slice(0, 600)}</p>
                  <button
                    className="secondary-action"
                    disabled={busy || r.contentKind !== 'body'}
                    onClick={() => void save(search.sessionId, i)}
                  >
                    保存到待审核
                  </button>
                </article>
              ))}
            </section>
          ) : null}
        </>
      )}
      {settingsOnly && error ? <p role="alert">{error}</p> : null}
      {settingsOnly && message ? <p role="status">{message}</p> : null}
    </section>
  );
}
