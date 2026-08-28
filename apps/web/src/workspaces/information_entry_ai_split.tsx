import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {
  AiSplitProposalDecisionResponse,
  AiSplitProposalListResponse,
  AiSplitProposalStartResponse,
  EvidenceSnapshot,
  M1cHttpResponse,
  ProcessingProposalView,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';

type EvidenceSnapshotReadResponse =
  | Readonly<{status: 'ok'; snapshot: Readonly<EvidenceSnapshot>}>
  | Readonly<{status: 'not_found'}>
  | Readonly<{status: 'rejected'; issue: Readonly<{code: string}>}>;

export interface InformationEntryAiSplitProps {
  readonly enabled: boolean;
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly alreadyMaterialized: boolean;
  readonly onLoadSnapshot: (
    snapshotId: string,
  ) => Promise<M1cHttpResponse<EvidenceSnapshotReadResponse>>;
  readonly onList: (
    snapshotId: string,
  ) => Promise<M1cHttpResponse<AiSplitProposalListResponse>>;
  readonly onStart: (
    snapshotId: string,
    requestKey: string,
  ) => Promise<M1cHttpResponse<AiSplitProposalStartResponse>>;
  readonly onAccept: (
    snapshotId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiSplitProposalDecisionResponse>>;
  readonly onReject: (
    snapshotId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiSplitProposalDecisionResponse>>;
  readonly onAccepted: () => Promise<void>;
}

export function InformationEntryAiSplit({
  enabled,
  snapshotId,
  isPrivate,
  alreadyMaterialized,
  onAccept,
  onAccepted,
  onList,
  onLoadSnapshot,
  onReject,
  onStart,
}: InformationEntryAiSplitProps) {
  const [proposals, setProposals] = useState<
    readonly Readonly<ProcessingProposalView>[]
  >([]);
  const [snapshot, setSnapshot] = useState<Readonly<EvidenceSnapshot>>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const requestGeneration = useRef(0);

  const loadReview = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!enabled || snapshotId === '' || isPrivate || alreadyMaterialized) {
      setProposals([]);
      setSnapshot(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [proposalResponse, snapshotResponse] = await Promise.all([
        onList(snapshotId),
        onLoadSnapshot(snapshotId),
      ]);
      if (generation !== requestGeneration.current) return;
      if (
        proposalResponse.body.status === 'ok' &&
        snapshotResponse.body.status === 'ok'
      ) {
        setProposals(proposalResponse.body.proposals);
        setSnapshot(snapshotResponse.body.snapshot);
      } else {
        setProposals([]);
        setSnapshot(undefined);
        setFeedback({
          kind: 'error',
          title: '无法读取拆分提案',
          detail: '本地 Evidence 或提案状态当前不可用；文档没有变化。',
        });
      }
    } catch {
      if (generation !== requestGeneration.current) return;
      setFeedback(connectionFailure());
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [
    alreadyMaterialized,
    enabled,
    isPrivate,
    onList,
    onLoadSnapshot,
    snapshotId,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFeedback(undefined);
      void loadReview();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestGeneration.current += 1;
    };
  }, [loadReview]);

  async function startProposal() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const requestKey = 'split-' + Date.now().toString(36);
      const response = await onStart(snapshotId, requestKey);
      if (
        response.body.status === 'created' ||
        response.body.status === 'existing'
      ) {
        setFeedback({
          kind: 'success',
          title: 'AI 拆分提案已生成',
          detail: '请核对每组原文；只有点击接受后才会生成 Entry。',
        });
        await loadReview();
      } else {
        setFeedback(
          splitFailure(
            'issue' in response.body
              ? response.body.issue.code
              : 'ai_provider_invalid_response',
          ),
        );
      }
    } catch {
      setFeedback(connectionFailure());
    } finally {
      setBusy(false);
    }
  }

  async function decide(
    proposal: Readonly<ProcessingProposalView>,
    decision: 'accept' | 'reject',
  ) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const response =
        decision === 'accept'
          ? await onAccept(snapshotId, proposal.proposalId)
          : await onReject(snapshotId, proposal.proposalId);
      if ('proposal' in response.body) {
        setFeedback({
          kind: 'success',
          title: decision === 'accept' ? '已生成信息条目' : '已拒绝拆分提案',
          detail:
            decision === 'accept'
              ? 'Entry 已由原始 Fragment 精确组成；Snapshot 与 Fragment 未被改写。'
              : '没有生成 Entry，原始材料保持不变。',
        });
        if (decision === 'accept') await onAccepted();
        await loadReview();
      } else {
        setFeedback(
          splitFailure(
            'issue' in response.body
              ? response.body.issue.code
              : 'ai_proposal_invalid',
          ),
        );
      }
    } catch {
      setFeedback(connectionFailure());
    } finally {
      setBusy(false);
    }
  }

  const selectedProposal =
    proposals.find((proposal) => proposal.status === 'pending_review') ??
    proposals[0];

  return (
    <section className="entry-ai-split" aria-labelledby="entry-ai-split-title">
      <header className="console-heading">
        <div>
          <p className="section-index">OPTIONAL AI PROPOSAL</p>
          <h2 id="entry-ai-split-title">OpenAI 拆分提案</h2>
        </div>
        <span className="origin-label origin-label--ai">
          AI 生成 · 待人工确认
        </span>
      </header>

      {!enabled ? (
        <p className="entry-ai-split__boundary">
          未配置 OpenAI Provider。上方按结构拆分仍可完整离线使用。
        </p>
      ) : snapshotId === '' ? (
        <p className="entry-ai-split__boundary">请先选择一份来源文档。</p>
      ) : isPrivate ? (
        <p className="entry-ai-split__boundary">
          隐私文档不会发送给外部 Provider；请使用上方本地结构规则。
        </p>
      ) : alreadyMaterialized ? (
        <p className="entry-ai-split__boundary">
          当前文档已经生成 Entry。为避免两套拆分互相覆盖，不再创建 AI 拆分提案。
        </p>
      ) : (
        <>
          <p className="entry-ai-split__boundary">
            只有点击下方按钮后，当前公开文档的段落原文才会发送给已配置的 OpenAI
            Provider。文档标识、其他文档和隐私内容不会发送；结果不会自动写入。
          </p>
          <div className="entry-ai-split__actions">
            <button
              className="secondary-action"
              type="button"
              disabled={busy || loading}
              onClick={() => void startProposal()}
            >
              {busy ? '处理中…' : '生成 AI 拆分提案'}
            </button>
            <span>
              {loading
                ? '读取既有提案…'
                : proposals.length.toString() + ' 个提案'}
            </span>
          </div>
          {selectedProposal === undefined ? (
            <p className="entry-ai-split__empty">
              尚无提案。你也可以直接使用上方确定性结构规则。
            </p>
          ) : (
            <SplitProposalCard
              proposal={selectedProposal}
              {...(snapshot === undefined ? {} : {snapshot})}
              disabled={busy}
              onAccept={() => void decide(selectedProposal, 'accept')}
              onReject={() => void decide(selectedProposal, 'reject')}
            />
          )}
        </>
      )}
      <ActionNotice feedback={feedback} />
    </section>
  );
}

function SplitProposalCard({
  disabled,
  onAccept,
  onReject,
  proposal,
  snapshot,
}: {
  readonly disabled: boolean;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly proposal: Readonly<ProcessingProposalView>;
  readonly snapshot?: Readonly<EvidenceSnapshot>;
}) {
  const fragmentById = useMemo(
    () =>
      new Map(
        (
          snapshot?.structures.flatMap((structure) => structure.fragments) ?? []
        ).map((fragment) => [fragment.fragmentId, fragment] as const),
      ),
    [snapshot],
  );
  const payload = proposal.splitPayload;

  return (
    <article className="entry-ai-split__proposal">
      <header>
        <div>
          <strong>{proposal.summary}</strong>
          <span>
            {payload === undefined
              ? '载荷不可用'
              : payload.entries.length.toString() + ' 个候选条目'}
          </span>
        </div>
        <span className="entry-ai-split__status">
          {proposalStatusLabel(proposal.status)}
        </span>
      </header>

      {payload === undefined ? (
        <p>该提案缺少可审核的拆分载荷，不能接受。</p>
      ) : (
        <>
          <p className="entry-ai-split__provider">
            来源：{payload.providerModel} · {payload.promptVersion}
          </p>
          <ol className="entry-ai-split__groups">
            {payload.entries.map((entry, index) => (
              <li key={entry.fragmentIds.join(':')}>
                <details open={index === 0}>
                  <summary>
                    <strong>{entry.titlePath}</strong>
                    <span>
                      {entry.fragmentIds.length.toString()} 个原文段落
                    </span>
                  </summary>
                  <div className="entry-ai-split__fragments">
                    {entry.fragmentIds.map((fragmentId) => {
                      const fragment = fragmentById.get(fragmentId);
                      return fragment === undefined ? (
                        <p className="entry-ai-split__missing" key={fragmentId}>
                          原文片段无法读取，不能安全接受本提案。
                        </p>
                      ) : (
                        <article key={fragmentId}>
                          <span>原文段落</span>
                          <pre>{fragment.selectedText}</pre>
                        </article>
                      );
                    })}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}

      {proposal.status === 'pending_review' && payload !== undefined ? (
        <div className="entry-ai-split__decision-actions">
          <button
            className="primary-action"
            type="button"
            disabled={disabled || snapshot === undefined}
            onClick={onAccept}
          >
            接受并生成条目
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={disabled}
            onClick={onReject}
          >
            拒绝提案
          </button>
        </div>
      ) : null}
    </article>
  );
}

function proposalStatusLabel(status: ProcessingProposalView['status']): string {
  if (status === 'pending_review') return '待确认';
  if (status === 'accepted') return '已接受';
  if (status === 'rejected') return '已拒绝';
  return '已被替代';
}

function splitFailure(code: string): ActionFeedback {
  const known: Readonly<Record<string, string>> = Object.freeze({
    ai_private_snapshot_forbidden: '隐私文档不会发送给外部 Provider。',
    ai_provider_not_configured: '当前服务未配置 OpenAI Provider。',
    ai_provider_timeout: 'OpenAI 请求超时，文档没有变化。',
    ai_provider_unavailable: 'OpenAI 暂时不可用，文档没有变化。',
    ai_provider_rejected: 'OpenAI 拒绝了本次请求，文档没有变化。',
    ai_provider_invalid_response: 'OpenAI 返回的拆分结构无效，文档没有变化。',
    ai_split_input_unsupported: '当前文档结构不适合本次 AI 拆分。',
    ai_snapshot_already_materialized: '当前文档已经生成 Entry。',
    stale_split_materialization: '文档已通过其他方式生成 Entry；请刷新。',
  });
  return {
    kind: 'error',
    title: '拆分提案操作未完成',
    detail: known[code] ?? '服务返回：' + code,
  };
}

function connectionFailure(): ActionFeedback {
  return {
    kind: 'error',
    title: '无法连接拆分提案服务',
    detail: '文档与 Entry 均未改变；服务恢复后可以重试。',
  };
}
