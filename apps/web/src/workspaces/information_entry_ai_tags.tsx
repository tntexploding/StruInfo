import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  InformationEntry,
  ProcessingProposalView,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';
import type {InformationEntryServices} from './information_entry_components.js';
import {DOMAIN_LABELS, TYPE_LABELS} from './information_entry_shared.js';

export interface InformationEntryAiTagsProps extends Pick<
  InformationEntryServices,
  | 'onAcceptAiTagProposal'
  | 'onListAiTagProposals'
  | 'onRejectAiTagProposal'
  | 'onStartAiTagProposal'
> {
  readonly enabled: boolean;
  readonly entry: Readonly<InformationEntry>;
  readonly onAccepted: () => Promise<void>;
}

export function InformationEntryAiTags({
  enabled,
  entry,
  onAccepted,
  onAcceptAiTagProposal,
  onListAiTagProposals,
  onRejectAiTagProposal,
  onStartAiTagProposal,
}: InformationEntryAiTagsProps) {
  const [proposals, setProposals] = useState<
    readonly Readonly<ProcessingProposalView>[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const requestGeneration = useRef(0);

  const loadProposals = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!enabled || entry.value.isPrivate) {
      setProposals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await onListAiTagProposals(entry.entryId);
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
  }, [enabled, entry.entryId, entry.value.isPrivate, onListAiTagProposals]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProposals();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestGeneration.current += 1;
    };
  }, [entry.revision, loadProposals]);

  async function startProposal() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const requestKey = `entry-${entry.revision.toString()}-${Date.now().toString(36)}`;
      const response = await onStartAiTagProposal(entry.entryId, requestKey);
      if (
        response.body.status === 'created' ||
        response.body.status === 'existing'
      ) {
        setFeedback({
          kind: 'success',
          title: 'AI 标签建议已生成',
          detail: '请核对关键词、类型和领域；只有点击接受后才会修改条目。',
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
          ? await onAcceptAiTagProposal(entry.entryId, proposal.proposalId)
          : await onRejectAiTagProposal(entry.entryId, proposal.proposalId);
      if (
        response.body.status === 'accepted' ||
        (response.body.status === 'rejected' && 'proposal' in response.body) ||
        response.body.status === 'unchanged'
      ) {
        setFeedback({
          kind: 'success',
          title:
            decision === 'accept' ? '已应用 AI 标签' : '已忽略 AI 标签建议',
          detail:
            decision === 'accept'
              ? '标签已应用，仍可在下方人工修改。'
              : '条目内容没有发生变化。',
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
    <section className="entry-ai-tags" aria-labelledby="entry-ai-tags-title">
      <header className="console-heading">
        <div>
          <h3 id="entry-ai-tags-title">AI 标签建议</h3>
        </div>
      </header>

      {!enabled ? (
        <p className="entry-ai-tags__boundary">
          OpenAI 未启用，仍可使用人工评分和自动标签建议。
        </p>
      ) : entry.value.isPrivate ? (
        <p className="entry-ai-tags__boundary">
          隐私条目不会发送给 OpenAI，请使用人工编辑。
        </p>
      ) : (
        <>
          <p className="entry-ai-tags__boundary">
            点击生成后，当前条目的标题、正文和标签会发送给
            OpenAI。其他条目不会发送，结果需要你确认后才会保存。
          </p>
          <div className="entry-ai-tags__actions">
            <button
              className="secondary-action"
              type="button"
              disabled={busy || loading}
              onClick={() => void startProposal()}
            >
              {busy ? '处理中…' : '生成 AI 标签建议'}
            </button>
            <span>
              {loading
                ? '读取已有建议…'
                : `${proposals.length.toString()} 条建议`}
            </span>
          </div>
          {latest === undefined ? null : (
            <ProposalCard
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
  onAccept,
  onReject,
  proposal,
}: {
  readonly disabled: boolean;
  readonly onAccept: () => void;
  readonly onReject: () => void;
  readonly proposal: Readonly<ProcessingProposalView>;
}) {
  const payload = proposal.tagPayload;
  return (
    <article className="entry-ai-tags__proposal">
      <header>
        <strong>{proposal.summary}</strong>
        <span>{proposalStatusLabel(proposal.status)}</span>
      </header>
      {payload === undefined ? (
        <p>这条建议没有可用的标签内容。</p>
      ) : (
        <dl>
          <div>
            <dt>关键词</dt>
            <dd>
              {payload.contentKeywords
                .map((value) => value.displayValue)
                .join(' · ') || '无'}
            </dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>
              {payload.typeCustomName ?? TYPE_LABELS[payload.typeKeyword]}
            </dd>
          </div>
          <div>
            <dt>领域</dt>
            <dd>
              {payload.domains
                .map(
                  (value) => value.customName ?? DOMAIN_LABELS[value.keyword],
                )
                .join(' · ') || '无'}
            </dd>
          </div>
        </dl>
      )}
      {proposal.status === 'pending_review' && payload !== undefined ? (
        <div className="entry-ai-tags__decision-actions">
          <button
            className="primary-action"
            type="button"
            disabled={disabled}
            onClick={onAccept}
          >
            接受并写入条目
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

function failureFeedback(code: string): ActionFeedback {
  const known: Readonly<Record<string, string>> = Object.freeze({
    ai_private_entry_forbidden: '隐私条目不会发送给 OpenAI。',
    ai_provider_not_configured: '当前服务未启用 OpenAI。',
    ai_provider_timeout: 'OpenAI 请求超时，条目没有变化。',
    ai_provider_unavailable: 'OpenAI 暂时不可用，条目没有变化。',
    ai_provider_rejected: 'OpenAI 拒绝了本次请求，条目没有变化。',
    ai_provider_invalid_response: 'OpenAI 返回的标签结构无效，条目没有变化。',
    stale_entry_revision: '条目已被修改；请刷新后重新生成建议。',
  });
  return {
    kind: 'error',
    title: 'AI 标签操作未完成',
    detail: known[code] ?? `服务返回：${code}`,
  };
}

function connectionFailure(): ActionFeedback {
  return {
    kind: 'error',
    title: '无法连接 AI 标签服务',
    detail: '条目没有变化；服务恢复后可以重试。',
  };
}
