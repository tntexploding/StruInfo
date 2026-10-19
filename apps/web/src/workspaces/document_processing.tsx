import type {
  DocumentProcessing,
  ProcessingStageId,
} from './document_processing_state.js';
import './document_processing.css';

export function DocumentProcessingStrip({
  value,
  error,
  onOpen,
  onRefresh,
}: {
  readonly value?: DocumentProcessing | undefined;
  readonly error?: string | undefined;
  readonly onOpen: (stage?: ProcessingStageId) => void;
  readonly onRefresh: () => void;
}) {
  const running =
    !error &&
    !value?.historical &&
    value?.task?.runtimeStatus === 'running' &&
    value.task.state.status === 'running';
  return (
    <section
      className="document-processing-strip"
      aria-label="本文 AI 处理"
      data-running={running}
    >
      <div className="document-processing-heading">
        <span
          className="ef-document-process"
          aria-live="polite"
          data-tone={value?.tone}
        >
          {running ? (
            <span className="ef-lamp" aria-hidden="true">
              <i />
            </span>
          ) : null}
          {error
            ? '处理状态读取失败'
            : value?.historical
              ? '历史正文 · 处理结果见当前正文'
              : (value?.label ?? '正在读取 AI 处理状态…')}
        </span>
        <button
          type="button"
          className="text-action"
          onClick={() => {
            if (error) onRefresh();
            else onOpen();
          }}
        >
          {error ? '重试状态' : '处理详情'}
        </button>
      </div>
      {error ? <p role="status">{error} 原文仍可阅读。</p> : null}
    </section>
  );
}
export function DocumentProcessingDetails({
  value,
  snapshotId,
  stage,
  onOpenDocument,
  onReadEntries,
  onOpenTool,
}: {
  readonly value: DocumentProcessing;
  readonly snapshotId: string;
  readonly stage?: ProcessingStageId | undefined;
  readonly onOpenDocument: (id: string) => void;
  readonly onReadEntries: () => void;
  readonly onOpenTool: (id: string) => void;
}) {
  const task = value.task;
  const currentBody =
    value.targetSnapshotId === snapshotId && !value.historical;
  return (
    <div className="document-processing-details">
      <div aria-live="polite">
        <strong data-tone={value.tone}>{value.label}</strong>
        <p>{value.reason}</p>
      </div>
      {!currentBody ? (
        <div className="processing-body-note">
          <p>
            {value.historical
              ? '这是历史保留正文。下方任务对应当前整理正文，不表示这份旧正文已被处理。'
              : '当前阅读的快照不是本次任务整理的正文，处理结果保存在另一份关联正文中。'}
          </p>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              onOpenDocument(value.targetSnapshotId);
            }}
          >
            打开处理正文
          </button>
        </div>
      ) : null}
      {task ? (
        <p className="processing-task-meta">
          {task.request.kind === 'document' ? '内置 AI' : '外部 Agent'} ·{' '}
          {task.model} · {task.state.calls} 次调用尝试
          <br />
          {task.updatedAt
            ? `更新于 ${new Date(task.updatedAt).toLocaleString('zh-CN')} · 本机时区`
            : ''}
        </p>
      ) : null}
      <p className="processing-legend">
        原文中的虚线表示条目分界，标签与联系展示在文首。记录说明曾执行的动作，当前内容可能已人工调整。
      </p>
      {value.stages.map((item) => (
        <section
          key={item.id}
          className="processing-stage-detail processing-marker"
          data-stage={item.id}
          data-selected={stage === item.id}
          data-running={
            item.state === 'active' &&
            task?.runtimeStatus === 'running' &&
            task.state.status === 'running'
          }
        >
          <h3>
            {item.label} <span>{item.detail}</span>
          </h3>
          {item.id === 'intake' ? (
            <p>
              {value.intake?.value.reason ?? '没有保存接收审核结论。'}
              {value.intake?.value.origin === 'manual' ? '（人工决定）' : ''}
            </p>
          ) : null}
          {item.id === 'split' ? (
            <>
              <p>
                {item.state === 'done'
                  ? '正文来自原文。连贯文章保留整篇，合集按条目拆分。'
                  : '尚未完成条目生成，完整原文仍保留。'}
              </p>
              {currentBody && item.state === 'done' ? (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={onReadEntries}
                >
                  查看生成的条目
                </button>
              ) : null}
            </>
          ) : null}
          {item.id === 'tags' ? (
            <>
              <p>完成数来自本次任务的标签写入记录，不包含人工标注。</p>
              {currentBody &&
              task?.state.steps.some((s) => s.kind === 'tags' && s.complete) ? (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    onOpenTool('tags');
                  }}
                >
                  查看当前条目标签
                </button>
              ) : null}
            </>
          ) : null}
          {item.id === 'relations' ? (
            <>
              <p>
                未建立联系表示缺少明确依据；达到上限而跳过的候选单独计为未评估。
              </p>
              {currentBody &&
              task?.state.steps.some(
                (s) =>
                  s.kind === 'relation' &&
                  s.complete &&
                  s.proposalId &&
                  !s.outcome,
              ) ? (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    onOpenTool('links');
                  }}
                >
                  查看当前条目联系
                </button>
              ) : null}
              {task?.state.steps
                .filter((s) => s.kind === 'relation')
                .map((s, i) => (
                  <details key={i} className="processing-candidate">
                    <summary>
                      候选 {i + 1} ·{' '}
                      {s.outcome === 'no_relation'
                        ? '未建立联系'
                        : s.outcome === 'edge_budget_reached'
                          ? '达到上限，未评估'
                          : s.complete && s.proposalId
                            ? '已建立联系'
                            : '待评估'}
                    </summary>
                    <p>
                      {s.candidateReasons?.join('；') ?? '没有保存召回理由。'}
                    </p>
                  </details>
                ))}
            </>
          ) : null}
        </section>
      ))}
      {task ? (
        <details>
          <summary>任务标识与控制位置</summary>
          <p className="processing-task-id">{task.taskId}</p>
          <p>暂停、继续和取消位于「设置 → AI 设置 → 独立任务与阶段明细」。</p>
        </details>
      ) : null}
    </div>
  );
}
