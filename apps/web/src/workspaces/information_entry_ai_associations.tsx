import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  AiAssociationProposalDecisionResponse,
  AiAssociationProposalListResponse,
  AiAssociationProposalStartResponse,
  InformationEntry,
  InformationEntryGraphDirection,
  M1cHttpResponse,
  ProcessingProposalView,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';

export interface InformationEntryAiAssociationsProps {
  readonly enabled: boolean;
  readonly entry: Readonly<InformationEntry>;
  readonly relatedEntry: Readonly<InformationEntry>;
  readonly onAccepted: () => Promise<void>;
  readonly onListAiAssociationProposals: (
    entryId: string,
    relatedEntryId: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalListResponse>>;
  readonly onStartAiAssociationProposal: (
    entryId: string,
    relatedEntryId: string,
    requestKey: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalStartResponse>>;
  readonly onAcceptAiAssociationProposal: (
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>>;
  readonly onRejectAiAssociationProposal: (
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>>;
}

export function InformationEntryAiAssociations({
  enabled,
  entry,
  onAccepted,
  onAcceptAiAssociationProposal,
  onListAiAssociationProposals,
  onRejectAiAssociationProposal,
  onStartAiAssociationProposal,
  relatedEntry,
}: InformationEntryAiAssociationsProps) {
  const [proposals, setProposals] = useState<
    readonly Readonly<ProcessingProposalView>[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const requestGeneration = useRef(0);
  const isPrivate = entry.value.isPrivate || relatedEntry.value.isPrivate;

  const loadProposals = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!enabled || isPrivate) {
      setProposals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await onListAiAssociationProposals(
        entry.entryId,
        relatedEntry.entryId,
      );
      if (generation !== requestGeneration.current) return;
      if (response.body.status === 'ok') {
        setProposals(response.body.proposals);
      } else {
        setFeedback(
          failureFeedback(
            'issue' in response.body
              ? response.body.issue.code
              : 'ai_provider_invalid_response',
          ),
        );
      }
    } catch {
      if (generation !== requestGeneration.current) return;
      setFeedback(connectionFailure());
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [
    enabled,
    entry.entryId,
    isPrivate,
    onListAiAssociationProposals,
    relatedEntry.entryId,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProposals();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestGeneration.current += 1;
    };
  }, [entry.revision, loadProposals, relatedEntry.revision]);

  async function startProposal() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const requestKey = [
        'pair',
        entry.revision.toString(),
        relatedEntry.revision.toString(),
        Date.now().toString(36),
      ].join('-');
      const response = await onStartAiAssociationProposal(
        entry.entryId,
        relatedEntry.entryId,
        requestKey,
      );
      if (
        response.body.status === 'created' ||
        response.body.status === 'existing'
      ) {
        setFeedback({
          kind: 'success',
          title: 'AI 关系建议已生成',
          detail: '请核对关系名称和方向；接受之前不会修改知识图谱。',
        });
        await loadProposals();
      } else {
        setFeedback(
          failureFeedback(
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
          ? await onAcceptAiAssociationProposal(
              entry.entryId,
              relatedEntry.entryId,
              proposal.proposalId,
            )
          : await onRejectAiAssociationProposal(
              entry.entryId,
              relatedEntry.entryId,
              proposal.proposalId,
            );
      if (
        response.body.status === 'accepted' ||
        (response.body.status === 'rejected' && 'proposal' in response.body) ||
        response.body.status === 'unchanged'
      ) {
        setFeedback({
          kind: 'success',
          title: decision === 'accept' ? 'AI 关系已保存' : '已忽略 AI 关系建议',
          detail:
            decision === 'accept'
              ? '该边已标记为 AI 辅助，仍可继续人工修改或隐藏。'
              : '知识图谱没有发生变化。',
        });
        if (decision === 'accept') await onAccepted();
        await loadProposals();
      } else {
        setFeedback(
          failureFeedback(
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

  const latest = proposals[0];
  return (
    <section
      className="entry-ai-associations"
      aria-labelledby="entry-ai-associations-title"
    >
      <header className="console-heading">
        <div>
          <h3 id="entry-ai-associations-title">AI 关系建议</h3>
        </div>
      </header>

      {!enabled ? (
        <p className="entry-ai-associations__boundary">
          OpenAI 未启用，仍可查看相似条目并人工编辑关系。
        </p>
      ) : isPrivate ? (
        <p className="entry-ai-associations__boundary">
          隐私条目不会发送给 OpenAI，请使用人工关系编辑。
        </p>
      ) : (
        <>
          <p className="entry-ai-associations__boundary">
            点击生成后，当前两个公开条目的标题、正文和标签会发送给
            OpenAI。其他条目不会发送，结果需要你确认后才会保存。
          </p>
          <div className="entry-ai-associations__actions">
            <button
              className="secondary-action"
              type="button"
              disabled={busy || loading}
              onClick={() => void startProposal()}
            >
              {busy ? '处理中…' : '生成 AI 关系建议'}
            </button>
            <span>
              {loading
                ? '读取已有建议…'
                : `${proposals.length.toString()} 条建议`}
            </span>
          </div>
          {latest === undefined ? null : (
            <ProposalCard
              entryId={entry.entryId}
              relatedEntryId={relatedEntry.entryId}
              proposal={latest}
              disabled={busy}
              onAccept={() => void decide(latest, 'accept')}
              onReject={() => void decide(latest, 'reject')}
            />
          )}
        </>
      )}
      <ActionNotice feedback={feedback} />
    </section>
  );
}

function ProposalCard({
  disabled,
  entryId,
  onAccept,
  onReject,
  proposal,
  relatedEntryId,
}: {
  readonly disabled: boolean;
  readonly entryId: string;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly proposal: Readonly<ProcessingProposalView>;
  readonly relatedEntryId: string;
}) {
  const payload = proposal.associationPayload;
  return (
    <article className="entry-ai-associations__proposal">
      <header>
        <strong>{proposal.summary}</strong>
        <span>{proposalStatusLabel(proposal.status)}</span>
      </header>
      {payload === undefined ? (
        <p>这条建议没有可用的关系内容。</p>
      ) : (
        <dl>
          <div>
            <dt>关系</dt>
            <dd>{payload.relationLabel}</dd>
          </div>
          <div>
            <dt>方向</dt>
            <dd>
              {proposalDirectionLabel(
                payload.direction,
                entryId,
                relatedEntryId,
              )}
            </dd>
          </div>
        </dl>
      )}
      {proposal.status === 'pending_review' && payload !== undefined ? (
        <div className="entry-ai-associations__decision-actions">
          <button
            className="primary-action"
            type="button"
            disabled={disabled}
            onClick={onAccept}
          >
            接受并写入图谱
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

function proposalDirectionLabel(
  direction: InformationEntryGraphDirection,
  entryId: string,
  relatedEntryId: string,
): string {
  if (direction === 'symmetric') return '双向';
  const entryIsLow = entryId < relatedEntryId;
  return (direction === 'low_to_high') === entryIsLow
    ? '当前条目指向相关条目'
    : '相关条目指向当前条目';
}

function proposalStatusLabel(status: ProcessingProposalView['status']): string {
  if (status === 'pending_review') return '待确认';
  if (status === 'accepted') return '已接受';
  if (status === 'rejected') return '已拒绝';
  return '已被替代';
}

function failureFeedback(code: string): ActionFeedback {
  const known: Readonly<Record<string, string>> = Object.freeze({
    ai_association_entry_not_found: '选中的条目已不存在；请刷新图谱。',
    ai_private_entry_forbidden: '隐私条目不会发送给 OpenAI。',
    ai_provider_not_configured: '当前服务未启用 OpenAI。',
    ai_provider_timeout: 'OpenAI 请求超时，知识图谱没有变化。',
    ai_provider_unavailable: 'OpenAI 暂时不可用，知识图谱没有变化。',
    ai_provider_rejected: 'OpenAI 拒绝了本次请求，知识图谱没有变化。',
    ai_provider_invalid_response: 'OpenAI 返回的关系结构无效。',
    stale_entry_revision: '条目已被修改；请刷新后重新生成建议。',
    stale_association_revision: '关系已被修改；请刷新后重新生成建议。',
  });
  return {
    kind: 'error',
    title: 'AI 关系操作未完成',
    detail: known[code] ?? `服务返回：${code}`,
  };
}

function connectionFailure(): ActionFeedback {
  return {
    kind: 'error',
    title: '无法连接 AI 关系服务',
    detail: '知识图谱没有变化；服务恢复后可以重试。',
  };
}
