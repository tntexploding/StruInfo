import {useRef, useState} from 'react';
import {researchCommand, researchError} from '../api/research_client.js';
import type {useDatabaseResearch} from './use_database_research.js';
import {safeReadingLink} from '../components/reading_text.js';
export function DatabaseResearchResults({
  value,
  onRead,
}: {
  value: ReturnType<typeof useDatabaseResearch>;
  onRead: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false),
    [message, setMessage] = useState('');
  const lock = useRef(false);
  async function capture(sessionId: string, index: number) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setMessage('');
    try {
      await researchCommand('web_capture', {sessionId, index});
      setMessage('已加入待审核队列。');
    } catch (e) {
      setMessage(researchError(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  const answer = value.output?.answer,
    search = value.output?.search;
  return (
    <div className="database-research-results">
      {value.busy ? <p role="status">正在查询…</p> : null}
      {value.error ? <p role="alert">{value.error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {answer ? (
        <section aria-label="回答与引用">
          <p className="research-answer">{answer.answer}</p>
          {answer.claims.map((c, i) => (
            <p key={i}>
              {c.statement} <small>{c.evidenceRefs.join(' · ')}</small>
            </p>
          ))}
          {answer.limitations.map((v, i) => (
            <p className="field-help" key={i}>
              {v}
            </p>
          ))}
          {answer.evidence.map((e) => (
            <article className="research-result" key={e.handle}>
              <strong>
                {e.handle} · {e.titlePath}
              </strong>
              <small>
                {e.origin === 'local'
                  ? '库内资料'
                  : e.contentKind === 'body'
                    ? '网页正文'
                    : '网页摘要'}
              </small>
              <p>{e.excerpt}</p>
              {e.entryId ? (
                <button
                  className="text-action"
                  onClick={() => {
                    if (e.entryId) onRead(e.entryId);
                  }}
                >
                  查看条目
                </button>
              ) : null}
              {e.url && safeReadingLink(e.url) ? (
                <a href={e.url} target="_blank" rel="noreferrer">
                  打开网页
                </a>
              ) : null}
              {e.sessionId &&
              e.index !== undefined &&
              e.contentKind === 'body' ? (
                <button
                  disabled={saving}
                  className="secondary-action"
                  onClick={() => {
                    if (e.sessionId && e.index !== undefined)
                      void capture(e.sessionId, e.index);
                  }}
                >
                  保存到待审核
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {search ? (
        <section aria-label="网页结果">
          {search.warnings.map((v, i) => (
            <p key={i}>{v}</p>
          ))}
          {!search.results.length ? <p>没有找到结果。</p> : null}
          {search.results.map((r, i) => (
            <article className="research-result" key={r.url}>
              <h3>
                {safeReadingLink(r.url) ? (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}
              </h3>
              <small>
                {r.contentKind === 'body' ? '已取得正文' : '只有摘要'}
              </small>
              <p>{r.summary || r.content.slice(0, 600)}</p>
              <button
                className="secondary-action"
                disabled={saving || r.contentKind !== 'body'}
                onClick={() => void capture(search.sessionId, i)}
              >
                保存到待审核
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
