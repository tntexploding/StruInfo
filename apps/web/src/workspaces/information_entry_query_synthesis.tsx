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
          <h2 id="entry-query-synthesis-title">AI 回答</h2>
        </div>
      </header>

      <p className="entry-query-synthesis__disclosure" id="ai-disclosure">
        点击回答后，你的问题和最多 8 条公开结果会发送给
        OpenAI。隐私内容不会发送，回答也不会保存。
      </p>

      {!enabled ? (
        <p className="entry-query-synthesis__notice" aria-live="polite">
          AI 未启用：请先在服务配置中添加 OpenAI API Key
          和模型；本地查询仍可使用。
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
          <span>希望 AI 根据这些搜索结果回答什么？</span>
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
                ? '使用知识库回答'
                : '根据当前结果回答'}
          </button>
        </div>
      </form>

      <div className="entry-query-synthesis__status" aria-live="polite">
        {synthesis.state.status === 'loading' ? (
          <p>OpenAI 正在生成回答；你仍可继续阅读搜索结果。</p>
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
          <strong>{evidenceStatusLabel(response.evidenceStatus)}</strong>
        </div>
      </header>
      <p className="entry-query-synthesis-answer__text">{response.answer}</p>

      <section aria-labelledby="ai-claims-title">
        <h3 id="ai-claims-title">回答依据</h3>
        {response.claims.length === 0 ? (
          <p className="entry-query-synthesis__notice">
            AI 没有为回答标出可核对的来源，请谨慎使用。
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
          查看发送给 OpenAI 的 {response.evidence.length.toString()} 条公开内容
        </summary>
        <ol>
          {response.evidence.map((item) => (
            <li key={item.handle}>
              <header>
                <strong>
                  来源 {item.handle} · {item.titlePath || '未命名条目'}
                </strong>
                <EvidenceAction
                  evidence={item}
                  onOpenEvidence={onOpenEvidence}
                />
              </header>
              <p>{item.excerpt}</p>
              {item.truncated ? <span>这里只显示部分正文</span> : null}
            </li>
          ))}
        </ol>
      </details>

      {response.limitations.length > 0 ? (
        <section
          className="entry-query-synthesis-limitations"
          aria-labelledby="ai-limitations-title"
        >
          <h3 id="ai-limitations-title">注意事项</h3>
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
      查看来源 {evidence.handle}
    </button>
  );
}

function evidenceStatusLabel(
  status: 'supported' | 'partial' | 'insufficient',
): string {
  if (status === 'supported') return '引用完整';
  if (status === 'partial') return '部分内容没有引用';
  return '引用不足';
}
