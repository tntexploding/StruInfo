import type {AiIntakePolicy} from '../api/ai_workflow_client.js';

export function IntakeOptions({
  value,
  onChange,
}: {
  readonly value: AiIntakePolicy;
  readonly onChange: (value: AiIntakePolicy) => void;
}) {
  return (
    <fieldset className="ai-source-scope">
      <legend>接收质量与内容选择</legend>
      <label>
        <input
          type="checkbox"
          checked={value.fetchFullText}
          onChange={(e) => {
            onChange({...value, fetchFullText: e.currentTarget.checked});
          }}
        />{' '}
        获取订阅文章的网页正文，另存原文快照
      </label>
      <p>
        正文不完整或无法确认时暂缓。以下类型可按需拦截，之后可在收件箱人工放行。
      </p>
      <div className="entry-command-actions">
        {(
          [
            ['event_notice', '活动预告'],
            ['promotion', '推广信息'],
            ['update_notice', '更新通知'],
          ] as const
        ).map(([kind, label]) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={value.blockedKinds.includes(kind)}
              onChange={(e) => {
                onChange({
                  ...value,
                  blockedKinds: e.currentTarget.checked
                    ? [...value.blockedKinds, kind]
                    : value.blockedKinds.filter((k) => k !== kind),
                });
              }}
            />{' '}
            {label}
          </label>
        ))}
      </div>
      <label className="field">
        <span>优先话题（留空不限定，每行一个）</span>
        <textarea
          rows={2}
          maxLength={1600}
          value={value.preferredTopics.join('\n')}
          onChange={(e) => {
            onChange({
              ...value,
              preferredTopics: e.currentTarget.value.split('\n'),
            });
          }}
          onBlur={() => {
            onChange({
              ...value,
              preferredTopics: value.preferredTopics
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        />
      </label>
      <label className="field">
        <span>排除话题（每行一个）</span>
        <textarea
          rows={2}
          maxLength={1600}
          value={value.excludedTopics.join('\n')}
          onChange={(e) => {
            onChange({
              ...value,
              excludedTopics: e.currentTarget.value.split('\n'),
            });
          }}
          onBlur={() => {
            onChange({
              ...value,
              excludedTopics: value.excludedTopics
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        />
      </label>
    </fieldset>
  );
}
