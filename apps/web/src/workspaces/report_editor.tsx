import {useState} from 'react';
import type {
  ReportEdit,
  ReportRecord,
  ReportStory,
} from '../api/report_client.js';

export function ReportEditor({
  report,
  busy,
  onSave,
  onClose,
  onOpenSource,
}: {
  report: ReportRecord;
  busy: boolean;
  onSave: (edit: ReportEdit) => Promise<boolean>;
  onClose: () => void;
  onOpenSource: (snapshotId: string) => void;
}) {
  const [title, setTitle] = useState(report.state.title);
  const [items, setItems] = useState<
    {
      included: boolean;
      title: string;
      allowed: number[];
      points: {
        text: string;
        sources: string;
        role?: ReportStory['points'][number]['role'];
      }[];
    }[]
  >(() =>
    report.state.items.length
      ? report.state.items.map((item) => ({
          included: item.included,
          title: (item.edited ?? item.draft)?.title ?? item.group.title,
          allowed: item.group.sources,
          points: (
            (item.edited ?? item.draft)?.points ?? [
              {text: '', sources: item.group.sources},
            ]
          ).map((p: ReportStory['points'][number]) => ({
            text: p.text,
            sources: p.sources.join(', '),
            role: p.role,
          })),
        }))
      : [
          {
            included: true,
            title: '',
            allowed: report.state.sources.map((s) => s.handle),
            points: [
              {
                text: '',
                sources: String(report.state.sources[0]?.handle ?? ''),
                role: undefined as ReportStory['points'][number]['role'],
              },
            ],
          },
        ],
  );
  const [error, setError] = useState('');
  const save = async (reviewed: boolean) => {
    const edit: ReportEdit = {
      title,
      reviewed,
      items: items.map((i) => ({
        included: i.included,
        story: {
          title: i.title,
          points: i.points.map((p) => ({
            text: p.text,
            ...(p.role ? {role: p.role} : {}),
            sources: p.sources
              .split(/[,，\s]+/u)
              .filter(Boolean)
              .map(Number),
          })),
        },
      })),
    };
    if (
      !title.trim() ||
      edit.items.some(
        (i, index) =>
          !i.story.title.trim() ||
          i.story.points.some(
            (p) =>
              !p.text.trim() ||
              !p.sources.length ||
              p.sources.some((id) => !items[index]?.allowed.includes(id)) ||
              new Set(p.sources).size !== p.sources.length,
          ),
      )
    ) {
      setError('请填写标题、摘要和有效出处编号。每条摘要都需要至少一个出处。');
      return;
    }
    if (reviewed && !items.some((i) => i.included)) {
      setError('请至少保留一条报告内容。');
      return;
    }
    setError('');
    if (await onSave(edit)) onClose();
  };
  return (
    <form
      className="report-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <p className="report-muted">
        修改另存为人工版本，AI
        初稿仍保留。收起工作台或回看原文时，本次编辑保留在当前页面；刷新页面前请保存。
      </p>
      <label className="field">
        报告标题
        <input
          value={title}
          maxLength={200}
          required
          disabled={busy}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </label>
      {items.map((item, index) => (
        <fieldset key={index} className="report-editor-item">
          <legend>第 {index + 1} 条</legend>
          <label className="report-check">
            <input
              type="checkbox"
              checked={item.included}
              disabled={busy}
              onChange={(e) => {
                setItems(
                  items.map((v, i) =>
                    i === index ? {...v, included: e.target.checked} : v,
                  ),
                );
              }}
            />
            纳入本期
          </label>
          <label className="field">
            条目标题
            <input
              value={item.title}
              maxLength={160}
              required
              disabled={busy}
              onChange={(e) => {
                setItems(
                  items.map((v, i) =>
                    i === index ? {...v, title: e.target.value} : v,
                  ),
                );
              }}
            />
          </label>
          {item.points.map((point, pointIndex) => (
            <div className="report-point-editor" key={pointIndex}>
              <label className="field">
                摘要 {pointIndex + 1}
                <textarea
                  value={point.text}
                  rows={4}
                  maxLength={600}
                  required
                  disabled={busy}
                  onChange={(e) => {
                    setItems(
                      items.map((v, i) =>
                        i === index
                          ? {
                              ...v,
                              points: v.points.map((p, j) =>
                                j === pointIndex
                                  ? {...p, text: e.target.value}
                                  : p,
                              ),
                            }
                          : v,
                      ),
                    );
                  }}
                />
              </label>
              <div className="report-actions">
                <label className="field">
                  出处编号
                  <input
                    value={point.sources}
                    placeholder="如 1, 2"
                    required
                    disabled={busy}
                    onChange={(e) => {
                      setItems(
                        items.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                points: v.points.map((p, j) =>
                                  j === pointIndex
                                    ? {...p, sources: e.target.value}
                                    : p,
                                ),
                              }
                            : v,
                        ),
                      );
                    }}
                  />
                </label>
                {item.points.length > 1 ? (
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setItems(
                        items.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                points: v.points.filter(
                                  (_, j) => j !== pointIndex,
                                ),
                              }
                            : v,
                        ),
                      );
                    }}
                  >
                    移除此段
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <div className="report-actions">
            {item.points.length < 4 ? (
              <button
                className="secondary-action"
                type="button"
                disabled={busy}
                onClick={() => {
                  setItems(
                    items.map((v, i) =>
                      i === index
                        ? {
                            ...v,
                            points: [
                              ...v.points,
                              {text: '', sources: String(v.allowed[0] ?? '')},
                            ],
                          }
                        : v,
                    ),
                  );
                }}
              >
                添加摘要段
              </button>
            ) : null}
          </div>
          <div
            className="report-editor-sources"
            role="group"
            aria-label={'第 ' + String(index + 1) + ' 条可引用来源'}
          >
            <p className="report-muted">本条可引用 · 点击回看原文</p>
            {report.state.sources
              .filter((s) => item.allowed.includes(s.handle))
              .map((s) => (
                <button
                  key={s.handle}
                  className="report-source-link"
                  type="button"
                  onClick={() => {
                    onOpenSource(s.snapshotId);
                  }}
                >
                  [{s.handle}] {s.title}
                </button>
              ))}
          </div>
        </fieldset>
      ))}
      {!report.state.items.length &&
      items.length < report.state.request.maxItems ? (
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={() => {
            setItems([
              ...items,
              {
                included: true,
                title: '',
                allowed: report.state.sources.map((s) => s.handle),
                points: [{text: '', sources: ''}],
              },
            ]);
          }}
        >
          添加报告条目
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="report-actions report-editor-actions">
        <button className="secondary-action" type="submit" disabled={busy}>
          保存草稿
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={() => void save(true)}
        >
          确认已核对
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          放弃本次编辑
        </button>
      </div>
    </form>
  );
}
