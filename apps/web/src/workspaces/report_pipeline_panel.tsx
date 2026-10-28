import {useCallback, useEffect, useRef, useState} from 'react';
import {
  researchCommand,
  researchError,
  type PipelineStatus,
  type ReportSchedule,
  type PipelineRow,
} from '../api/research_client.js';
import type {ReportRecord} from '../api/report_client.js';
const names: Record<string, string> = {
  queued: '等待创建',
  generating: '生成中',
  ready: '已生成，待发布',
  published: '已发布',
  failed: '未完成',
  skipped: '已跳过',
  paused: '已暂停',
};
const emptySchedule = (): ReportSchedule => ({
  name: '每天的资料摘要',
  enabled: false,
  cadence: 'daily',
  localTime: '09:00',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  missed: 'once',
  publish: false,
  request: {
    kind: 'daily',
    composition: 'collection',
    date: new Intl.DateTimeFormat('en-CA').format(new Date()),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeField: 'received',
    topics: [],
    sources: [],
    excludedEntryIds: [],
    maxItems: 6,
    maxModelCalls: 12,
  },
});
export function ReportPipelinePanel({
  active,
  report,
  onReport,
}: {
  active: boolean;
  report?: ReportRecord;
  onReport?: (id: string) => void;
}) {
  const [data, updateData] = useState<PipelineStatus>();
  const dirty = useRef(false);
  const setData = (next: PipelineStatus) => {
    dirty.current = true;
    updateData(next);
  };
  const [form, setForm] = useState(emptySchedule),
    [selected, setSelected] = useState<PipelineRow>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const lock = useRef(false),
    epoch = useRef({value: 0});
  const load = useCallback(async () => {
    const version = ++epoch.current.value;
    const next = await researchCommand<PipelineStatus>(
      'report_pipeline_status',
    );
    if (version === epoch.current.value && Array.isArray(next.schedules))
      updateData((previous) =>
        dirty.current && previous
          ? {
              ...next,
              settings: previous.settings,
              settingsVersion: previous.settingsVersion,
            }
          : next,
      );
  }, []);
  useEffect(() => {
    if (!active) return;
    void load().catch((e: unknown) => {
      setError(researchError(e));
    });
    const id = setInterval(() => void load().catch(() => undefined), 15000);
    const pending = epoch.current;
    return () => {
      clearInterval(id);
      pending.value++;
    };
  }, [active, load]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await load();
    } catch (e) {
      setError(researchError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const patch = (v: Partial<ReportSchedule>) => {
    setForm({...form, ...v});
  };
  const terms = (s: string) => s.split(/[,，]/u);
  const cleanTerms = (values: readonly string[]) =>
    values.map((v) => v.trim()).filter(Boolean);
  return (
    <section className="research-panel" aria-label="定时报告与站内通知">
      <p>
        定时选材 → 生成报告 → 发布站内通知。Markdown 和 PDF
        在报告中导出。没有外部推送。
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {report ? (
        <div className="entry-command-actions">
          <button
            className="secondary-action"
            disabled={
              busy || !['ready', 'reviewed'].includes(report.state.status)
            }
            onClick={() =>
              void run(async () => {
                await researchCommand('report_publish', {
                  reportId: report.reportId,
                  expectedVersion: report.version,
                });
                setMessage('这份报告已发布到站内通知。');
              })
            }
          >
            将当前报告发布到站内
          </button>
        </div>
      ) : null}
      <fieldset disabled={busy}>
        <legend>{selected ? '修改定时任务' : '新建定时任务'}</legend>
        <div className="research-fields">
          <label>
            名称
            <input
              value={form.name}
              maxLength={100}
              onChange={(e) => {
                patch({name: e.target.value});
              }}
            />
          </label>
          <label>
            周期
            <select
              value={form.cadence}
              onChange={(e) => {
                const cadence = e.target.value as ReportSchedule['cadence'];
                patch({cadence, request: {...form.request, kind: cadence}});
              }}
            >
              <option value="daily">每日（上一天）</option>
              <option value="weekly">每周一（上一周）</option>
              <option value="monthly">每月 1 日（上个月）</option>
            </select>
          </label>
          <label>
            时区
            <input
              value={form.timeZone}
              onChange={(e) => {
                patch({timeZone: e.target.value});
              }}
            />
          </label>
          <label>
            当地时间
            <input
              type="time"
              value={form.localTime}
              onChange={(e) => {
                patch({localTime: e.target.value});
              }}
            />
          </label>
          <label>
            生成方式
            <select
              value={form.request.composition ?? 'ai'}
              onChange={(e) => {
                patch({
                  request: {
                    ...form.request,
                    composition: e.target.value as 'ai' | 'collection',
                  },
                });
              }}
            >
              <option value="collection">原文摘录，不调用 AI</option>
              <option value="ai">AI 总结</option>
            </select>
          </label>
          <label>
            遗漏时段
            <select
              value={form.missed}
              onChange={(e) => {
                patch({missed: e.target.value as 'once' | 'skip'});
              }}
            >
              <option value="once">补最近一期</option>
              <option value="skip">超过 1 小时就跳过</option>
            </select>
          </label>
          <label>
            专题关键词
            <input
              value={form.request.topics.join('，')}
              onChange={(e) => {
                patch({
                  request: {...form.request, topics: terms(e.target.value)},
                });
              }}
            />
          </label>
          <label>
            来源关键词
            <input
              value={form.request.sources.join('，')}
              onChange={(e) => {
                patch({
                  request: {...form.request, sources: terms(e.target.value)},
                });
              }}
            />
          </label>
          <label>
            条目上限（0 为不限）
            <input
              type="number"
              min={0}
              max={512}
              value={form.request.maxItems}
              onChange={(e) => {
                patch({
                  request: {...form.request, maxItems: Number(e.target.value)},
                });
              }}
            />
          </label>
          {form.request.composition !== 'collection' ? (
            <>
              <label>
                每期最多模型调用
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={form.request.maxModelCalls}
                  onChange={(e) => {
                    patch({
                      request: {
                        ...form.request,
                        maxModelCalls: Number(e.target.value),
                      },
                    });
                  }}
                />
              </label>
              <label>
                使用预算
                <select
                  value={form.request.batchId ?? ''}
                  onChange={(e) => {
                    patch({
                      request: {...form.request, batchId: e.target.value},
                    });
                  }}
                >
                  <option value="">请选择可用预算</option>
                  {data?.budget ? (
                    <option
                      value={data.budget.batchId}
                      disabled={data.budget.paused}
                    >
                      {data.budget.batchId} · 剩余 ¥
                      {data.budget.remainingCny.toFixed(2)}
                      {data.budget.paused ? ' · 已暂停' : ''}
                    </option>
                  ) : null}
                </select>
              </label>
            </>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => {
                patch({enabled: e.target.checked});
              }}
            />
            启用定时任务
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.publish}
              onChange={(e) => {
                patch({publish: e.target.checked});
              }}
            />
            生成后自动发布到站内
          </label>
        </div>
        <div className="entry-command-actions">
          <button
            className="primary-action"
            onClick={() =>
              void run(async () => {
                await researchCommand('report_schedule_save', {
                  id: selected?.id ?? crypto.randomUUID(),
                  expectedVersion: selected?.version ?? 0,
                  schedule: {
                    ...form,
                    request: {
                      ...form.request,
                      topics: cleanTerms(form.request.topics),
                      sources: cleanTerms(form.request.sources),
                    },
                  },
                });
                setSelected(undefined);
                setForm(emptySchedule());
                setMessage('定时任务已保存。');
              })
            }
          >
            保存定时任务
          </button>
          {selected ? (
            <button
              className="secondary-action"
              onClick={() => {
                setSelected(undefined);
                setForm(emptySchedule());
              }}
            >
              取消修改
            </button>
          ) : null}
        </div>
      </fieldset>
      <section>
        <h3>定时任务</h3>
        {!data?.schedules.length ? (
          <p>暂无定时任务。</p>
        ) : (
          data.schedules.map((r) => (
            <article className="research-result" key={r.id}>
              <strong>{r.value.schedule?.name}</strong>
              <p>
                {r.value.schedule?.enabled ? '已开启' : '已暂停'} ·{' '}
                {r.value.schedule?.localTime} · {r.value.schedule?.timeZone}
              </p>
              <button
                className="secondary-action"
                disabled={busy}
                onClick={() => {
                  setSelected(r);
                  if (r.value.schedule) setForm(r.value.schedule);
                }}
              >
                修改
              </button>
            </article>
          ))
        )}
      </section>
      <section>
        <h3>生成与发布队列</h3>
        {!data?.runs.length ? (
          <p>暂无执行记录。</p>
        ) : (
          data.runs.map((r) => (
            <article className="research-result" key={r.id}>
              <strong>
                {names[r.value.status ?? ''] ?? r.value.status} · {r.value.slot}
              </strong>
              {r.value.errorCode ? (
                <p>{researchError(new Error(r.value.errorCode))}</p>
              ) : null}
              {r.value.reportId && onReport ? (
                <button
                  className="secondary-action"
                  onClick={() => {
                    if (r.value.reportId) onReport(r.value.reportId);
                  }}
                >
                  打开报告
                </button>
              ) : null}
            </article>
          ))
        )}
      </section>
      {data ? (
        <fieldset disabled={busy}>
          <legend>资料更新通知</legend>
          <p>
            同一文档的更新合并显示。紧急词命中的资料立即提醒，其余遵守间隔和静默时间。
          </p>
          <div className="research-fields">
            <label>
              <input
                type="checkbox"
                checked={data.settings.notices.enabled}
                onChange={(e) => {
                  setData({
                    ...data,
                    settings: {
                      ...data.settings,
                      notices: {
                        ...data.settings.notices,
                        enabled: e.target.checked,
                      },
                    },
                  });
                }}
              />
              开启资料更新通知
            </label>
            <label>
              来源关键词（留空为全部）
              <input
                value={data.settings.notices.sources.join('，')}
                onChange={(e) => {
                  setData({
                    ...data,
                    settings: {
                      ...data.settings,
                      notices: {
                        ...data.settings.notices,
                        sources: terms(e.target.value),
                      },
                    },
                  });
                }}
              />
            </label>
            <label>
              紧急词（留空则无紧急通知）
              <input
                value={data.settings.notices.urgentTerms.join('，')}
                onChange={(e) => {
                  setData({
                    ...data,
                    settings: {
                      ...data.settings,
                      notices: {
                        ...data.settings.notices,
                        urgentTerms: terms(e.target.value),
                      },
                    },
                  });
                }}
              />
            </label>
            <label>
              通知间隔（分钟）
              <input
                type="number"
                min={1}
                max={1440}
                value={data.settings.notices.intervalMinutes}
                onChange={(e) => {
                  setData({
                    ...data,
                    settings: {
                      ...data.settings,
                      notices: {
                        ...data.settings.notices,
                        intervalMinutes: Number(e.target.value),
                      },
                    },
                  });
                }}
              />
            </label>
            <label>
              静默开始
              <input
                type="time"
                value={data.settings.notices.quietFrom}
                onChange={(e) => {
                  setData({
                    ...data,
                    settings: {
                      ...data.settings,
                      notices: {
                        ...data.settings.notices,
                        quietFrom: e.target.value,
                      },
                    },
                  });
                }}
              />
            </label>
            <label>
              静默结束
              <input
                type="time"
                value={data.settings.notices.quietTo}
                onChange={(e) => {
                  setData({
                    ...data,
                    settings: {
                      ...data.settings,
                      notices: {
                        ...data.settings.notices,
                        quietTo: e.target.value,
                      },
                    },
                  });
                }}
              />
            </label>
            <label>
              通知时区
              <input
                value={data.settings.notices.timeZone}
                onChange={(e) => {
                  setData({
                    ...data,
                    settings: {
                      ...data.settings,
                      notices: {
                        ...data.settings.notices,
                        timeZone: e.target.value,
                      },
                    },
                  });
                }}
              />
            </label>
          </div>
          <button
            className="secondary-action"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await researchCommand('research_settings_save', {
                  expectedVersion: data.settingsVersion,
                  settings: {
                    ...data.settings,
                    notices: {
                      ...data.settings.notices,
                      sources: cleanTerms(data.settings.notices.sources),
                      urgentTerms: cleanTerms(
                        data.settings.notices.urgentTerms,
                      ),
                    },
                  },
                });
                dirty.current = false;
                setMessage('通知设置已保存。');
              })
            }
          >
            保存通知设置
          </button>
          <button
            className="text-action"
            disabled={busy}
            onClick={() =>
              void run(() => {
                dirty.current = false;
                return Promise.resolve();
              })
            }
          >
            放弃修改并重读
          </button>
        </fieldset>
      ) : null}
      <section>
        <h3>站内通知</h3>
        {!data?.notices.length ? (
          <p>暂无通知。</p>
        ) : (
          data.notices.map((r) => (
            <article className="research-result" key={r.id}>
              <strong>
                {r.value.urgent ? '紧急 · ' : ''}
                {r.value.correction ? '更新 · ' : ''}
                {r.value.title}
              </strong>
              <small>
                {r.value.read ? '已读' : '未读'} ·{' '}
                {new Date(r.value.createdAt ?? r.updatedAt).toLocaleString()}
              </small>
              {r.value.markdown ? (
                <details>
                  <summary>阅读发布版本</summary>
                  <p>{r.value.markdown}</p>
                </details>
              ) : null}
              {r.value.reportId && onReport ? (
                <button
                  className="secondary-action"
                  onClick={() => {
                    if (r.value.reportId) onReport(r.value.reportId);
                  }}
                >
                  打开报告
                </button>
              ) : null}
              <button
                className="text-action"
                disabled={busy || r.value.read}
                onClick={() =>
                  void run(async () => {
                    await researchCommand('notice_read', {
                      id: r.id,
                      expectedVersion: r.version,
                    });
                  })
                }
              >
                标为已读
              </button>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
