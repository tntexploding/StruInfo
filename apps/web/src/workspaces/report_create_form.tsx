import {useRef, useState} from 'react';
import {
  reportCommand,
  reportError,
  type ReportPreview,
  type ReportRequest,
} from '../api/report_client.js';

export function ReportCreateForm({
  busy,
  onCreate,
  onOpenSource,
}: {
  busy: boolean;
  onCreate: (request: ReportRequest, key: string) => Promise<boolean>;
  onOpenSource: (snapshotId: string) => void;
}) {
  const [request, setRequest] = useState<ReportRequest>(() => ({
    kind: 'daily',
    date: new Intl.DateTimeFormat('en-CA').format(new Date()),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeField: 'received',
    topics: [],
    sources: [],
    excludedEntryIds: [],
    maxItems: 6,
    maxModelCalls: 12,
  }));
  const [topics, setTopics] = useState('');
  const [sources, setSources] = useState('');
  const [preview, setPreview] = useState<ReportPreview>();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const version = useRef(0);
  const disabled = busy || loading;
  const selectedCount = (preview?.sources.length ?? 0) - excluded.length;
  const update = (patch: Partial<ReportRequest>) => {
    version.current++;
    key.current = crypto.randomUUID();
    setRequest({...request, ...patch});
    setPreview(undefined);
    setExcluded([]);
    setError('');
  };
  const load = async () => {
    const current = ++version.current;
    setLoading(true);
    setError('');
    try {
      const result = await reportCommand<ReportPreview>(
        'report_preview',
        request,
      );
      if (current === version.current) {
        setPreview(result);
        setExcluded([]);
      }
    } catch (e) {
      if (current === version.current) {
        setError(reportError(e));
        setPreview(undefined);
      }
    } finally {
      setLoading(false);
    }
  };
  const terms = (text: string) =>
    text
      .split(/[,，\n]/u)
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <div className="report-create">
      <header>
        <p className="report-eyebrow">01 / 选材</p>
        <h2>创建报告</h2>
        <p>
          只收录已放行并已入库的公开条目。完整文章保留上下文，同一来源的重复记录会合并。
        </p>
      </header>
      <label className="field">
        内容方式
        <select
          value={request.composition ?? 'ai'}
          onChange={(e) => {
            update({composition: e.target.value as 'ai' | 'collection'});
          }}
        >
          <option value="ai">AI 梳理与总结</option>
          <option value="collection">检索结果摘录 · 不调用 AI</option>
        </select>
      </label>
      <div className="report-form-grid">
        <label className="field">
          报告类型
          <select
            value={request.kind}
            disabled={disabled}
            onChange={(e) => {
              update({kind: e.target.value as ReportRequest['kind']});
            }}
          >
            <option value="daily">日报</option>
            <option value="weekly">周报</option>
            <option value="monthly">月报</option>
            <option value="topic">专题 · 所有时间</option>
          </select>
        </label>
        <label className="field">
          {request.kind === 'weekly' ? '本周中的任意日期' : '报告日期'}
          <input
            type="date"
            value={request.date}
            disabled={disabled}
            onChange={(e) => {
              update({date: e.target.value});
            }}
          />
        </label>
        <label className="field">
          日期依据
          <select
            value={request.timeField}
            disabled={disabled}
            onChange={(e) => {
              update({timeField: e.target.value as ReportRequest['timeField']});
            }}
          >
            <option value="received">接收日期</option>
            <option value="published">发布日期</option>
          </select>
        </label>
        <label className="field">
          最多报告条目
          <select
            value={request.maxItems}
            disabled={disabled}
            onChange={(e) => {
              update({maxItems: Number(e.target.value)});
            }}
          >
            <option value={0}>不限制条目数量</option>
            {[1, 3, 6, 8, 12, 20, 40, 80].map((n) => (
              <option key={n} value={n}>
                {n} 条
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="report-muted">
        {request.kind === 'topic'
          ? '专题选材覆盖全部已放行内容，请填写话题或来源。'
          : request.kind === 'monthly'
            ? '月报覆盖所选日期所在的整月。'
            : request.kind === 'weekly'
              ? '周报覆盖所选日期所在的周一至周日，并重新梳理一周材料。'
              : '日报覆盖所选日期的完整一天。'}
        {request.timeField === 'published'
          ? '缺少发布日期的材料不会入选。'
          : '以首次接收快照的日期为准。'}
      </p>
      <details className="report-options">
        <summary>选材范围与调用额度</summary>
        <div className="report-form-grid">
          <label className="field">
            话题包含
            <input
              value={topics}
              placeholder="可留空；多个词用逗号分隔"
              maxLength={1000}
              disabled={disabled}
              onChange={(e) => {
                setTopics(e.target.value);
                update({topics: terms(e.target.value)});
              }}
            />
          </label>
          <label className="field">
            信源包含
            <input
              value={sources}
              placeholder="来源名称或域名，可留空"
              maxLength={1000}
              disabled={disabled}
              onChange={(e) => {
                setSources(e.target.value);
                update({sources: terms(e.target.value)});
              }}
            />
          </label>
          <label className="field">
            时区
            <input
              value={request.timeZone}
              maxLength={80}
              disabled={disabled}
              onChange={(e) => {
                update({timeZone: e.target.value});
              }}
            />
          </label>
          <label className="field">
            累计模型调用上限
            <input
              type="number"
              min={2}
              max={20}
              value={request.maxModelCalls}
              disabled={disabled}
              onChange={(e) => {
                update({maxModelCalls: Number(e.target.value)});
              }}
            />
          </label>
        </div>
        <p className="report-muted">
          筛选使用文字匹配；每次规划或摘要均计一次调用，继续生成也计入同一额度。加入生成队列后会按这些限制调用模型。
        </p>
      </details>
      <div className="report-actions report-create-actions">
        <button
          className="secondary-action"
          type="button"
          disabled={disabled || !request.date}
          onClick={() => void load()}
        >
          {loading ? '正在选材…' : '预览材料'}
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={disabled || !preview || selectedCount <= 0}
          onClick={() => {
            if (!preview || selectedCount <= 0) return;
            void onCreate(
              {
                ...request,
                excludedEntryIds: excluded,
                selectedEntryIds: preview.sources
                  .filter((s) => !excluded.includes(s.entryId))
                  .map((s) => s.entryId),
              },
              key.current,
            );
          }}
        >
          {request.composition === 'collection'
            ? '生成检索摘录'
            : '加入 AI 生成队列'}
          {selectedCount > 0 ? ` · ${String(selectedCount)} 条材料` : ''}
        </button>
      </div>
      <p className="report-muted">
        预览后创建。AI
        报告将加入生成队列，遵守额度与价格时段；模型未配置时保留草稿。不限制条目时仍保留调用额度，每次最多选取
        512 条材料。
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <section className="report-candidates" aria-label="选材预览">
          <h3>
            {request.kind === 'topic' ? '全部时间' : preview.period.from}
            {request.kind === 'weekly' || request.kind === 'monthly'
              ? ' — ' + preview.period.to
              : ''}
          </h3>
          <p>
            {preview.totalEligible} 条符合条件 · 已排除 {preview.duplicateCount}{' '}
            条重复记录
          </p>
          {!preview.sources.length ? (
            <p className="report-empty">
              本周期暂无可用材料。可调整日期，或先在文档入口接受，再到工作台整理入库。
            </p>
          ) : (
            preview.sources.map((source) => (
              <article className="report-candidate" key={source.entryId}>
                <label className="report-check">
                  <input
                    type="checkbox"
                    checked={!excluded.includes(source.entryId)}
                    disabled={disabled}
                    onChange={(e) => {
                      key.current = crypto.randomUUID();
                      setExcluded(
                        e.target.checked
                          ? excluded.filter((id) => id !== source.entryId)
                          : [...excluded, source.entryId],
                      );
                    }}
                  />
                  <strong>{source.title}</strong>
                </label>
                <p className="report-muted">
                  {source.sourceKey} · {source.date}
                </p>
                <p>
                  {source.excerpt.slice(0, 240)}
                  {source.excerpt.length > 240 ? '…' : ''}
                </p>
                <div className="report-actions">
                  <span className="report-muted">{source.reason}</span>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onOpenSource(source.snapshotId);
                    }}
                  >
                    阅读原文
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
