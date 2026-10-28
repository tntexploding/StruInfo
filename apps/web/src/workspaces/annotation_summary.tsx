import type {InformationEntry} from '../api/m1c_api_contract.js';

export function AnnotationSummary({entry}: {entry: InformationEntry}) {
  const a = entry.value.annotations;
  if (!a) return null;
  const stale = a.inputBodySha256 !== entry.value.bodySha256;
  const status = {
    complete: '已标注',
    partial: '部分已知',
    unknown: '暂不确定',
    none: '无需标签',
  }[a.status];
  return (
    <section className="annotation-summary" aria-label="结构化标注">
      <p>
        <strong>{stale ? '正文已修改，标注需核对' : status}</strong> ·{' '}
        {a.origin === 'ai'
          ? 'AI 标注'
          : a.origin === 'manual'
            ? '人工标注'
            : '规则标注'}{' '}
        ·{' '}
        {
          {unread: '未读', reading: '在读', read: '已读', archived: '已归档'}[
            a.readingState
          ]
        }
      </p>
      <div className="annotation-summary__labels">
        {a.labels.map((l) => (
          <details key={l.term.id}>
            <summary>
              {a.dimensions.find((d) => d.id === l.dimensionId)?.name}：
              {l.term.label}
              {l.primary ? ' · 主要' : ''}
            </summary>
            <p>{l.term.meaning}</p>
            <blockquote>{l.evidence.quote}</blockquote>
          </details>
        ))}
      </div>
      {a.claims.length > 0 && (
        <details>
          <summary>明确观点 · {a.claims.length}</summary>
          {a.claims.map((c, i) => (
            <div key={i}>
              <strong>{c.statement}</strong>
              <p>
                {c.speaker || '提出者未知'} ·{' '}
                {{supports: '赞同', opposes: '反对', reports: '转述'}[c.stance]}
                {c.time ? ` · ${c.time}` : ''}
              </p>
              {c.conditions && <p>条件：{c.conditions}</p>}
              <blockquote>{c.evidence.quote}</blockquote>
            </div>
          ))}
        </details>
      )}
      {a.note && <p>{a.note}</p>}
    </section>
  );
}
