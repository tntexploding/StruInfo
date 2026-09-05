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
          title: '无法读取 AI 拆分建议',
          detail: '原文或建议当前无法读取；文档没有变化。',
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
          title: 'AI 拆分建议已生成',
          detail: '请核对每组原文；只有点击接受后才会生成条目。',
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
          title:
            decision === 'accept' ? '已生成信息条目' : '已忽略 AI 拆分建议',
          detail:
            decision === 'accept'
              ? '条目已按原文片段生成，已导入的原文没有改变。'
              : '没有生成条目，原始材料保持不变。',
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
          <h2 id="entry-ai-split-title">AI 拆分建议</h2>
        </div>
      </header>

      {!enabled ? (
        <p className="entry-ai-split__boundary">
          OpenAI 未启用，仍可使用人工拆分和结构规则。
        </p>
      ) : snapshotId === '' ? (
        <p className="entry-ai-split__boundary">请先选择一份来源文档。</p>
      ) : isPrivate ? (
        <p className="entry-ai-split__boundary">
          隐私文档不会发送给 OpenAI，请使用人工拆分或结构规则。
        </p>
      ) : alreadyMaterialized ? (
        <p className="entry-ai-split__boundary">
          当前文档已经生成条目，不能再创建拆分建议。
        </p>
      ) : (
        <>
          <p className="entry-ai-split__boundary">
            点击生成后，当前公开文档的段落会发送给
            OpenAI。其他文档和隐私内容不会发送，结果需要你确认后才会保存。
          </p>
          <div className="entry-ai-split__actions">
            <button
              className="secondary-action"
              type="button"
              disabled={busy || loading}
              onClick={() => void startProposal()}
            >
              {busy ? '处理中…' : '生成 AI 拆分建议'}
            </button>
            <span>
              {loading
                ? '读取已有建议…'
                : proposals.length.toString() + ' 条建议'}
            </span>
          </div>
          {selectedProposal === undefined ? (
            <p className="entry-ai-split__empty">
              尚无建议。你也可以直接使用上方的结构规则。
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
              ? '内容不可用'
              : payload.entries.length.toString() + ' 个建议条目'}
          </span>
        </div>
        <span className="entry-ai-split__status">
          {proposalStatusLabel(proposal.status)}
        </span>
      </header>

      {payload === undefined ? (
        <p>这条建议没有可审核的拆分内容，不能使用。</p>
      ) : (
        <>
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
                          原文片段无法读取，不能使用这条建议。
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
            忽略建议
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
    ai_private_snapshot_forbidden: '隐私文档不会发送给 OpenAI。',
    ai_provider_not_configured: '当前服务未启用 OpenAI。',
    ai_provider_timeout: 'OpenAI 请求超时，文档没有变化。',
    ai_provider_unavailable: 'OpenAI 暂时不可用，文档没有变化。',
    ai_provider_rejected: 'OpenAI 拒绝了本次请求，文档没有变化。',
    ai_provider_invalid_response: 'OpenAI 返回的拆分结构无效，文档没有变化。',
    ai_split_input_unsupported: '当前文档结构不适合本次 AI 拆分。',
    ai_snapshot_already_materialized: '当前文档已经生成条目。',
    stale_split_materialization: '文档已通过其他方式生成条目，请刷新。',
  });
  return {
    kind: 'error',
    title: 'AI 拆分操作未完成',
    detail: known[code] ?? '服务返回：' + code,
  };
}

function connectionFailure(): ActionFeedback {
  return {
    kind: 'error',
    title: '无法连接 AI 拆分服务',
    detail: '文档与条目均未改变；服务恢复后可以重试。',
  };
}
