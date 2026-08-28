import type {SyntheticEvent} from 'react';

import type {
  EntryRetrievalMode,
  InformationEntryQuerySynthesisEvidence,
  InformationEntryQuerySynthesisResponse,
} from '../api/m1c_api_contract.js';
import type {InformationEntryServices} from './information_entry_components.js';
import {
  useInformationEntryQuerySynthesis,
  type InformationEntryQuerySynthesisAction,
} from './use_information_entry_query_synthesis.js';

export interface InformationEntryQuerySynthesisProps {
  readonly enabled: boolean;
  readonly retrievalMode?: EntryRetrievalMode;
  readonly includePrivate: boolean;
  readonly onlyPrivate: boolean;
  readonly resultCount: number;
  readonly searchRequest: Readonly<Record<string, unknown>>;
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onSynthesize: InformationEntryQuerySynthesisAction;
}

export function InformationEntryQuerySynthesis({
  enabled,
  retrievalMode,
  includePrivate,
  onlyPrivate,
  resultCount,
  searchRequest,
  onOpenEvidence,
  onSynthesize,
}: InformationEntryQuerySynthesisProps) {
  const synthesis = useInformationEntryQuerySynthesis({onSynthesize});
  const privateScope = includePrivate || onlyPrivate;
  const ragMode = retrievalMode !== undefined && retrievalMode !== 'lexical';
  const canSubmit =
    enabled &&
    !privateScope &&
    resultCount > 0 &&
    synthesis.question.trim().length > 0 &&
    synthesis.questionCodePoints <= 600 &&
    synthesis.state.status !== 'loading';

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canSubmit) void synthesis.execute(searchRequest);
  }

  return (
    <section
      className="entry-query-synthesis"
      aria-labelledby="entry-query-synthesis-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">AI SYNTHESIS / PUBLIC EVIDENCE</p>
          <h2 id="entry-query-synthesis-title">
            {ragMode
              ? 'RAG 综合 · 语义召回与本地证据'
              : 'AI 综合 · 仅基于当前公开查询结果'}
          </h2>
        </div>
        <span className="origin-label origin-label--ai">AI 生成 · 会话内</span>
      </header>

      <p className="entry-query-synthesis__disclosure" id="ai-disclosure">
        只有点击“{ragMode ? 'RAG 综合当前证据' : 'AI 综合当前结果'}
        ”后，你输入的问题，以及当前公开查询最多 8 条 Entry
        的标题、受限正文片段和标签才会发送给配置的 OpenAI
        模型。不会发送隐私文档、来源 URL、数据库身份或个人偏好，也不会保存回答。
      </p>

      {!enabled ? (
        <p className="entry-query-synthesis__notice" aria-live="polite">
          AI 未启用：请在外部运行配置中同时提供 OpenAI API Key
          与模型；本地查询保持完整可用。
        </p>
      ) : privateScope ? (
        <p className="entry-query-synthesis__notice" aria-live="polite">
          当前包含隐私范围。查看隐私内容不等于允许外发；请切换到“仅公开结果”后再综合。
        </p>
      ) : resultCount === 0 ? (
        <p className="entry-query-synthesis__notice" aria-live="polite">
          当前没有公开查询结果；先完成一次有结果的本地查询。
        </p>
      ) : null}

      <form className="entry-query-synthesis__form" onSubmit={submit}>
        <label className="field">
          <span>希望 AI 基于这些证据回答什么？</span>
          <textarea
            rows={3}
            value={synthesis.question}
            aria-describedby="ai-disclosure ai-question-count"
            onChange={(event) => {
              synthesis.setQuestion(event.currentTarget.value);
            }}
            placeholder="例如：这些结果共同说明了哪些方法与限制？"
          />
        </label>
        <div className="entry-query-synthesis__form-actions">
          <span id="ai-question-count" className="record-count">
            {synthesis.questionCodePoints.toString()} / 600 字
          </span>
          <button
            className="secondary-action"
            type="submit"
            disabled={!canSubmit}
          >
            {synthesis.state.status === 'loading'
              ? '正在综合…'
              : ragMode
                ? 'RAG 综合当前证据'
                : 'AI 综合当前结果'}
          </button>
        </div>
      </form>

      <div className="entry-query-synthesis__status" aria-live="polite">
        {synthesis.state.status === 'loading' ? (
          <p>OpenAI 正在处理受限公开证据；本地结果仍可继续阅读。</p>
        ) : synthesis.state.status === 'error' ? (
          <p role="alert">{synthesis.state.message}</p>
        ) : null}
      </div>

      {synthesis.state.status === 'ready' ? (
        <InformationEntryQuerySynthesisAnswer
          response={synthesis.state.response}
          onOpenEvidence={onOpenEvidence}
        />
      ) : null}
    </section>
  );
}

export function InformationEntryQuerySynthesisAnswer({
  response,
  onOpenEvidence,
}: {
  readonly response: Extract<
    InformationEntryQuerySynthesisResponse,
    {status: 'ok'}
  >;
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
}) {
  const evidence = new Map(
    response.evidence.map((item) => [item.handle, item]),
  );
  return (
    <article className="entry-query-synthesis-answer">
      <header>
        <div>
          <p className="section-index">GENERATED ANSWER</p>
          <strong>{evidenceStatusLabel(response.evidenceStatus)}</strong>
        </div>
        <dl>
          <div>
            <dt>模型</dt>
            <dd>{response.model}</dd>
          </div>
          <div>
            <dt>Prompt</dt>
            <dd>{response.promptVersion}</dd>
          </div>
        </dl>
      </header>
      <p className="entry-query-synthesis-answer__text">{response.answer}</p>

      <section aria-labelledby="ai-claims-title">
        <h3 id="ai-claims-title">有证据引用的要点</h3>
        {response.claims.length === 0 ? (
          <p className="entry-query-synthesis__notice">
            模型未形成可引用要点；请查看证据不足与局限说明。
          </p>
        ) : (
          <ol className="entry-query-synthesis-claims">
            {response.claims.map((claim, index) => (
              <li key={`${String(index)}:${claim.statement}`}>
                <p>{claim.statement}</p>
                <div>
                  {claim.evidenceRefs.map((reference) => {
                    const item = evidence.get(reference);
                    return item === undefined ? null : (
                      <EvidenceAction
                        key={reference}
                        evidence={item}
                        onOpenEvidence={onOpenEvidence}
                      />
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className="entry-query-synthesis-evidence">
        <summary>
          查看本次发送的 {response.evidence.length.toString()} 条公开证据
        </summary>
        <ol>
          {response.evidence.map((item) => (
            <li key={item.handle}>
              <header>
                <strong>
                  {item.handle} · {item.titlePath || '未命名条目'} · r
                  {item.entryRevision.toString()}
                </strong>
                <EvidenceAction
                  evidence={item}
                  onOpenEvidence={onOpenEvidence}
                />
              </header>
              <p>{item.excerpt}</p>
              {item.truncated ? <span>正文已按固定上限截断</span> : null}
            </li>
          ))}
        </ol>
      </details>

      {response.limitations.length > 0 ? (
        <section
          className="entry-query-synthesis-limitations"
          aria-labelledby="ai-limitations-title"
        >
          <h3 id="ai-limitations-title">局限</h3>
          <ul>
            {response.limitations.map((item, index) => (
              <li key={`${String(index)}:${item}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function EvidenceAction({
  evidence,
  onOpenEvidence,
}: {
  readonly evidence: Readonly<InformationEntryQuerySynthesisEvidence>;
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
}) {
  return (
    <button
      className="entry-query-synthesis-evidence-action"
      type="button"
      onClick={() => {
        onOpenEvidence(evidence.snapshotId, evidence.fragmentIds[0], false);
      }}
    >
      {evidence.handle} · 查看精确来源
    </button>
  );
}

function evidenceStatusLabel(
  status: 'supported' | 'partial' | 'insufficient',
): string {
  if (status === 'supported') return '证据支持';
  if (status === 'partial') return '部分证据支持';
  return '证据不足';
}
