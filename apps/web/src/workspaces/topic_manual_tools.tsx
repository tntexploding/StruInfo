import {useState} from 'react';
import type {TopicView, TopicRelation} from '../api/topic_contract.js';
export function TopicManualTools({
  topic,
  busy,
  save,
}: {
  topic: TopicView;
  busy: boolean;
  save: (command: string, input: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(topic.value.name),
    [scope, setScope] = useState(topic.value.scope);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [fromQuote, setFromQuote] = useState(''),
    [toQuote, setToQuote] = useState(''),
    [reason, setReason] = useState('');
  const [kind, setKind] = useState<TopicRelation['kind']>('supports');
  const members = topic.value.members.filter(
    (m) =>
      m.decision !== 'excluded' &&
      !topic.entries.find((e) => e.entryId === m.entryId)?.stale,
  );
  const title = (id: string) =>
    topic.entries.find((e) => e.entryId === id)?.title ?? '查看条目';
  return (
    <>
      <details>
        <summary>修改主题名称与范围</summary>
        <form
          className="topic-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save('topic_save', {
              topicId: topic.id,
              expectedVersion: topic.version,
              name,
              scope,
            });
          }}
        >
          <label>
            主题名称
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <label>
            主题范围
            <textarea
              required
              maxLength={800}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
              }}
            />
          </label>
          <button
            disabled={busy || !name.trim() || !scope.trim()}
            className="secondary-action"
          >
            保存主题
          </button>
        </form>
      </details>
      <details>
        <summary>手动建立或修改联系</summary>
        <p>
          选择两个成员，填写两端的正文依据。同一对成员已有联系时，将更新该联系。
        </p>
        <form
          className="topic-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            const a = members.find((m) => m.entryId === from),
              b = members.find((m) => m.entryId === to);
            if (!a || !b || a.entryId === b.entryId) return;
            void save('topic_relation_set', {
              topicId: topic.id,
              expectedVersion: topic.version,
              relation: {
                from: {
                  entryId: a.entryId,
                  revision: a.revision,
                  quote: fromQuote,
                },
                to: {entryId: b.entryId, revision: b.revision, quote: toQuote},
                kind,
                reason,
                blocked: false,
              },
            });
          }}
        >
          <label>
            起点条目
            <select
              required
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setFromQuote('');
              }}
            >
              <option value="">选择成员</option>
              {members.map((m) => (
                <option key={m.entryId} value={m.entryId}>
                  {title(m.entryId)}
                </option>
              ))}
            </select>
          </label>
          <label>
            起点正文依据
            <textarea
              required
              maxLength={2000}
              value={fromQuote}
              onChange={(e) => {
                setFromQuote(e.target.value);
              }}
            />
          </label>
          <label>
            联系类型
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as TopicRelation['kind']);
              }}
            >
              <option value="supports">支持</option>
              <option value="contradicts">反驳</option>
              <option value="continues">延续</option>
              <option value="replaces">替代</option>
            </select>
          </label>
          <label>
            终点条目
            <select
              required
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setToQuote('');
              }}
            >
              <option value="">选择成员</option>
              {members
                .filter((m) => m.entryId !== from)
                .map((m) => (
                  <option key={m.entryId} value={m.entryId}>
                    {title(m.entryId)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            终点正文依据
            <textarea
              required
              maxLength={2000}
              value={toQuote}
              onChange={(e) => {
                setToQuote(e.target.value);
              }}
            />
          </label>
          <label>
            联系说明
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </label>
          <button
            disabled={
              busy ||
              !from ||
              !to ||
              from === to ||
              !fromQuote.trim() ||
              !toQuote.trim() ||
              !reason.trim()
            }
            className="secondary-action"
          >
            保存联系
          </button>
        </form>
      </details>
    </>
  );
}
