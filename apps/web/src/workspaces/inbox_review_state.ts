import {
  aiError,
  type IntakeRecord,
  type AiTask,
} from '../api/ai_workflow_client.js';
import {receiptTaskStatus} from './use_inbox_ai_review.js';

/** Session-only navigation; it never carries a privacy opt-in or a saved decision. */
export interface InboxReviewTarget {
  readonly snapshotId?: string;
}

/** Receipt acceptance and permission to process are independent owner decisions. */
export function intakeReviewKind(
  record: IntakeRecord | undefined,
): 'receipt' | 'processing' | undefined {
  if (
    !record ||
    record.value.receipt === 'rejected' ||
    record.value.decision !== 'held'
  )
    return undefined;
  return record.value.receipt === 'pending' ? 'receipt' : 'processing';
}

export function intakeReviewHint(record: IntakeRecord): string {
  return intakeReviewKind(record) === 'receipt'
    ? '请核对原文后选择接受或拒绝；接受后如需整理，可在“核对原因”中人工放行。'
    : '资料已接收，整理仍被暂缓；请在“核对原因”中检查正文并人工放行、重新审核或拦截。';
}

/** Current owner choices take precedence over historical AI task results. */
export function inboxReceiptPresentation(
  record: IntakeRecord | undefined,
  task: AiTask | undefined,
  tasksReady: boolean,
): {
  tone: 'pending' | 'review' | 'accepted' | 'rejected';
  label: string;
  reasonLabel: string;
  reason: string;
} {
  const value = record?.value;
  if (value?.receipt === 'rejected')
    return {
      tone: 'rejected',
      label: '已拒绝',
      reasonLabel:
        value.decision === 'held' && value.reason ? '原暂缓原因' : '接收说明',
      reason:
        value.decision === 'held' && value.reason
          ? value.reason
          : '你已拒绝接收这份资料；原文保留，可恢复为待接受。',
    };
  if (value?.decision === 'blocked')
    return {
      tone: 'rejected',
      label: '已拦截',
      reasonLabel: '拦截原因',
      reason:
        value.reason || '这份资料已被人工拦截；可在接收审核中查看并调整决定。',
    };
  if (value?.decision === 'held')
    return {
      tone: 'review',
      label:
        value.receipt === 'pending'
          ? '需人工核对 · 待接受'
          : '需人工核对 · 整理暂缓',
      reasonLabel: '暂缓原因',
      reason: value.reason || '审核未记录详细原因，请查看原文后决定是否放行。',
    };
  if (value?.receipt !== 'pending')
    return {
      tone: 'accepted',
      label:
        value?.receiptOrigin === 'model'
          ? '已接受 · AI 接受'
          : value?.receipt
            ? '已接受'
            : '既有资料',
      reasonLabel: '接收说明',
      reason: '资料已在资料库，可继续阅读与整理。',
    };
  if (!tasksReady)
    return {
      tone: 'pending',
      label: '待接受',
      reasonLabel: '审核状态',
      reason: '尚未确认最新审核进度；你也可以直接查看原文并决定。',
    };
  if (value.decision === 'admitted')
    return {
      tone: 'pending',
      label: '审核通过 · 待接受',
      reasonLabel: '待接收原因',
      reason: '本篇已通过审核，接收决定尚未保存。可以直接接受。',
    };
  if (task && !['succeeded', 'cancelled'].includes(task.state.status)) {
    const interrupted =
      task.runtimeStatus === 'interrupted' ||
      (['queued', 'running'].includes(task.state.status) &&
        task.runtimeStatus !== 'running');
    const paused =
      task.pauseRequested === true || task.cancelRequested === true;
    const reason = interrupted
      ? '上次审核已中断，需要手动继续；也可以直接接受或拒绝。'
      : paused
        ? '本篇审核已请求暂停或取消，尚未完成接收。可以查看原文后手动决定。'
        : task.state.errorCode
          ? aiError(new Error(task.state.errorCode))
          : task.state.status === 'paused'
            ? '本篇审核已暂停，尚未完成接收；可以手动继续或直接决定。'
            : task.state.status === 'failed'
              ? '审核未能完成，尚无接收结论；可以重试或手动决定。'
              : '已提交 AI 接收审核，尚未完成；你也可以先查看原文并决定。';
    return {
      tone:
        task.state.status === 'failed' || interrupted ? 'review' : 'pending',
      label: interrupted ? '审核已中断 · 待决定' : receiptTaskStatus(task),
      reasonLabel: '待接收原因',
      reason,
    };
  }
  if (task?.state.status === 'cancelled')
    return {
      tone: 'pending',
      label: '审核已取消 · 待接受',
      reasonLabel: '待接收原因',
      reason: '接收审核已取消，资料仍由你决定接受或拒绝。',
    };
  return {
    tone: 'pending',
    label: '待接受 · 尚未审核',
    reasonLabel: '待接收原因',
    reason: '新接收的资料尚未审核，等待你决定是否加入资料库。',
  };
}
