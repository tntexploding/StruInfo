import {useCallback, useEffect, useRef, useState} from 'react';
import type {SourceSubscriptionView} from '../api/m1c_api_contract.js';
import {aiWorkflowCommand} from '../api/ai_workflow_client.js';
interface Article {
  id: string;
  subscriptionId: string;
  url: string;
  title: string;
  titleFromUrl?: boolean;
  publishedAt?: string;
  dateInferred?: boolean;
  access: string;
  existingSnapshotId?: string;
}
interface Selection {
  articles: Pick<Article, 'id' | 'subscriptionId'>[];
}
interface AppliedQuery {
  key: string;
  subscriptionIds: string[];
  from: string;
  to: string;
}
interface SourceState {
  subscriptionId: string;
  label: string;
  count: number;
  pending: number;
  status: string;
  methods: string[];
  errors: {url: string; code: string}[];
}
interface Directory {
  sessionId: string;
  sources: SourceState[];
  articles: Article[];
  total: number;
  undated: number;
  offset: number;
}
interface ItemResult {
  id: string;
  status: string;
  code?: string;
}
export const STATUS: Record<string, string> = {
  more: '可继续读取',
  waiting: '网站限流，等待手动重试',
  loading: '读取中',
  directory_complete: '公开目录已读完',
  index_complete: '公开索引已读完',
  partial: '部分目录未能读取',
  limited: '目录未读完',
};
export function failure(e: unknown) {
  const code = e instanceof Error ? e.message : String(e);
  return (
    (
      {
        history_session_expired:
          '目录会话已过期，请重新读取目录。已补收的资料会保留。',
        history_selection_too_large:
          '一次最多选择 5,000 篇，请缩小日期或来源范围。',
        history_archive_not_same_site: '目录地址须属于该订阅的同一网站。',
        history_source_changed: '订阅配置已改变，请重新读取目录。',
        history_invalid_request: '请检查时间范围、每来源数量与目录地址。',
        history_source_limit_exceeded:
          '选择超过每来源数量限制，请减少勾选后重试。',
        history_selection_changed:
          '查询范围或补收清单已变化，请重新查询并确认选择。',
        history_response_too_large: '远端页面超过读取容量。',
        history_article_unreadable: '正文无法解析，请查看原网页。',
        history_article_empty: '未能取得可读正文。',
        history_http_403: '网站拒绝访问。',
        history_http_429:
          '网站暂时限制请求，已停止该来源。稍后点击重试失败目录。',
        history_http_404: '远端页面已不存在。',
        history_read_failed: '读取失败，可重试或设置目录地址。',
        history_import_failed: '补收失败，可重试。',
      } as Record<string, string>
    )[code] ?? '操作未完成，可重试（' + code + '）。'
  );
}
export function useSourceHistory({
  sources,
  initialSource,
  onImported,
}: {
  sources: readonly SourceSubscriptionView[];
  initialSource: string;
  onImported: () => void;
}) {
  const supported = sources.filter(
    (s) => !s.isPrivate && (s.kind === 'rss_atom' || s.kind === 'web'),
  );
  const [chosen, setChosen] = useState(
    () =>
      new Set(
        supported.some((s) => s.subscriptionId === initialSource)
          ? [initialSource]
          : supported.map((s) => s.subscriptionId),
      ),
  );
  const [archives, setArchives] = useState<Record<string, string>>({});
  const [session, setSession] = useState(''),
    [states, setStates] = useState<SourceState[]>([]);
  const [directory, setDirectory] = useState<Directory>(),
    [checked, setChecked] = useState(new Map<string, string>());
  const [text, setText] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0);
  const [limitText, setLimitText] = useState('20');
  const [resultSource, setResultSource] = useState('all');
  const [applied, setApplied] = useState<AppliedQuery>();
  const perSourceLimit = limitText.trim() ? Number(limitText) : undefined;
  const validLimit =
    perSourceLimit === undefined ||
    (Number.isInteger(perSourceLimit) &&
      perSourceLimit >= 1 &&
      perSourceLimit <= 5000);
  const validDates =
    (!from || !to || from <= to) &&
    [from, to].every(
      (d) =>
        !d ||
        (/^\d{4}-\d{2}-\d{2}$/u.test(d) &&
          Number.isFinite(Date.parse(d)) &&
          new Date(d).toISOString().startsWith(d)),
    );
  const [busy, setBusy] = useState(''),
    [message, setMessage] = useState(''),
    [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, ItemResult>>({}),
    [progress, setProgress] = useState<{
      done: number;
      total: number;
      action: string;
    }>();
  const stop = useRef(false),
    live = useRef(true),
    operation = useRef(false);
  const [preview, setPreview] = useState<{
    item: Article;
    body: string;
    access: string;
  }>();
  const dialog = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const openedConfig = useRef('');
  const configKey = JSON.stringify(
    [...chosen].sort().map((id) => [id, archives[id]?.trim() ?? '']),
  );
  const chosenKey = [...chosen].sort().join(',');
  const scopeKey = JSON.stringify([
    chosenKey,
    from,
    to,
    limitText,
    [...chosen].sort().map((id) => archives[id]?.trim() ?? ''),
  ]);
  const currentQuery = applied?.key === scopeKey;
  const canQuery = Boolean(chosen.size) && validDates && validLimit;
  const selectedCounts = new Map<string, number>();
  for (const sourceId of checked.values())
    selectedCounts.set(sourceId, (selectedCounts.get(sourceId) ?? 0) + 1);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
  }, [preview]);
  useEffect(
    () => () => {
      if (session)
        void aiWorkflowCommand('history_close', {sessionId: session}).catch(
          () => undefined,
        );
    },
    [session],
  );
  const query = useCallback(
    () => ({
      sessionId: session,
      subscriptionIds:
        resultSource === 'all'
          ? (applied?.subscriptionIds ?? [])
          : [resultSource],
      text,
      ...(applied?.from ? {from: applied.from} : {}),
      ...(applied?.to ? {to: applied.to} : {}),
    }),
    [session, applied, text, resultSource],
  );
  useEffect(() => {
    if (!session || !applied) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void aiWorkflowCommand<Directory>('history_list', {...query(), offset})
        .then((value) => {
          if (active) {
            setDirectory(value);
            setStates(value.sources);
          }
        })
        .catch((e: unknown) => {
          if (active) setMessage(failure(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session, applied, query, offset, refresh]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    stop.current = false;
    setBusy(label);
    setMessage('');
    setProgress(undefined);
    try {
      await action();
    } catch (e) {
      if (live.current) setMessage(failure(e));
    } finally {
      operation.current = false;
      if (live.current) {
        setBusy('');
        setRefresh((n) => n + 1);
      }
    }
  };
  const requestStop = () => {
    stop.current = true;
    setMessage('当前请求结束后停止。已完成的操作会保留。');
  };
  const stopped = () => stop.current;
  const read = async (restart = false, retry = false) =>
    run('查询往期', async () => {
      if (!canQuery) throw new Error('history_invalid_request');
      setChecked(new Map());
      setDirectory(undefined);
      setOffset(0);
      setResultSource('all');
      const nextQuery = {key: scopeKey, subscriptionIds: [...chosen], from, to};
      setApplied(nextQuery);
      let id = session,
        current = states;
      const newSource = [...chosen].some(
        (key) => !states.some((s) => s.subscriptionId === key),
      );
      if (!id || restart || newSource || openedConfig.current !== configKey) {
        const opened = await aiWorkflowCommand<{
          sessionId: string;
          sources: SourceState[];
        }>('history_open', {
          sources: supported
            .filter((s) => chosen.has(s.subscriptionId))
            .map((s) => ({
              subscriptionId: s.subscriptionId,
              ...(archives[s.subscriptionId]?.trim()
                ? {archiveUrl: archives[s.subscriptionId]?.trim()}
                : {}),
            })),
        });
        openedConfig.current = configKey;
        id = opened.sessionId;
        current = opened.sources;
        setSession(id);
        setStates(current);
        setChecked(new Map());
        setOffset(0);
        setResults({});
      }
      const retryIds = new Set(
        retry
          ? current
              .filter((s) => chosen.has(s.subscriptionId) && s.errors.length)
              .map((s) => s.subscriptionId)
          : [],
      );
      // One bounded remote page per call. Stop takes effect after the current page.
      for (let round = 0; round < 1000; round++) {
        if (stopped()) break;
        const pending = current.filter(
          (s) =>
            chosen.has(s.subscriptionId) &&
            (s.pending > 0 || retryIds.has(s.subscriptionId)),
        );
        if (!pending.length) break;
        for (const source of pending) {
          if (stopped()) break;
          setMessage('正在读取 ' + source.label + ' 的历史目录…');
          const value = await aiWorkflowCommand<{sources: SourceState[]}>(
            'history_scan',
            {
              sessionId: id,
              subscriptionId: source.subscriptionId,
              retry: retryIds.delete(source.subscriptionId),
            },
          );
          current = value.sources;
          if (live.current) {
            setStates(current);
            setRefresh((n) => n + 1);
          }
        }
      }
      if (live.current) {
        const selection = await aiWorkflowCommand<Selection>('history_select', {
          sessionId: id,
          subscriptionIds: nextQuery.subscriptionIds,
          text,
          ...(from ? {from} : {}),
          ...(to ? {to} : {}),
          ...(perSourceLimit === undefined ? {} : {perSourceLimit}),
        });
        setChecked(
          new Map(selection.articles.map((a) => [a.id, a.subscriptionId])),
        );
        setMessage(
          `${stop.current ? '已停止查询，仅显示已读取的目录' : '查询完成'}；按每来源数量预选 ${String(selection.articles.length)} 篇，可调整勾选后加入待审核队列。`,
        );
      }
    });
  const toggle = (id: string) => {
    setChosen((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setOffset(0);
  };
  const selectFiltered = () =>
    run('选择文章', async () => {
      if (!currentQuery) throw new Error('history_selection_changed');
      const value = await aiWorkflowCommand<Selection>('history_select', {
        ...query(),
        ...(perSourceLimit === undefined ? {} : {perSourceLimit}),
      });
      setChecked(new Map(value.articles.map((a) => [a.id, a.subscriptionId])));
      setMessage(
        '已选中当前筛选结果中未接收的 ' +
          String(value.articles.length) +
          ' 篇，已应用每来源限额，包含其他分页。',
      );
    });
  const importSelected = () =>
    run('补收文章', async () => {
      if (!currentQuery) throw new Error('history_selection_changed');
      const ids = [...checked.keys()];
      const {planId} = await aiWorkflowCommand<{planId: string}>(
        'history_prepare_import',
        {
          sessionId: session,
          ids,
          subscriptionIds: applied.subscriptionIds,
          ...(applied.from ? {from: applied.from} : {}),
          ...(applied.to ? {to: applied.to} : {}),
          ...(perSourceLimit === undefined ? {} : {perSourceLimit}),
        },
      );
      let done = 0,
        created = 0,
        existing = 0,
        failed = 0;
      for (const id of ids) {
        if (stopped()) break;
        if (live.current)
          setProgress({done, total: ids.length, action: '补收'});
        let row: ItemResult;
        try {
          row = (
            await aiWorkflowCommand<{results: ItemResult[]}>('history_import', {
              sessionId: session,
              planId,
              ids: [id],
            })
          ).results[0] ?? {id, status: 'failed'};
        } catch (e) {
          row = {
            id,
            status: 'failed',
            code: e instanceof Error ? e.message : 'history_import_failed',
          };
        }
        done++;
        if (row.status === 'imported') created++;
        else if (row.status === 'existing') existing++;
        else failed++;
        if (live.current) {
          setResults((old) => ({...old, [id]: row}));
          setProgress({done, total: ids.length, action: '补收'});
          if (row.status !== 'failed')
            setChecked((old) => {
              const next = new Map(old);
              next.delete(id);
              return next;
            });
        }
      }
      onImported();
      if (live.current)
        setMessage(
          `已放入待审核 ${String(created)} 篇，已存在 ${String(existing)} 篇，失败 ${String(failed)} 篇${stop.current ? '；剩余选择已保留' : ''}。`,
        );
    });
  const showPreview = (item: Article) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    void run('读取原文', async () => {
      setPreview(
        await aiWorkflowCommand('history_preview', {
          sessionId: session,
          id: item.id,
        }),
      );
    });
  };
  const enrich = () =>
    run('补全日期与标题', async () => {
      const articles =
        directory?.articles.filter((a) => !a.publishedAt || a.titleFromUrl) ??
        [];
      let done = 0,
        failed = 0;
      for (const item of articles) {
        if (stopped()) break;
        try {
          await aiWorkflowCommand('history_preview', {
            sessionId: session,
            id: item.id,
          });
        } catch {
          failed++;
        }
        done++;
        if (live.current)
          setProgress({done, total: articles.length, action: '补全目录'});
      }
      if (live.current)
        setMessage(
          `已核查本页 ${String(done)} 篇的标题与发布日期${failed ? `，${String(failed)} 篇未能读取` : ''}。没有发布日期的资料不会被按时间选中。`,
        );
    });
  const closePreview = () => {
    dialog.current?.close();
    setPreview(undefined);
    returnFocus.current?.focus();
  };
  const rows = directory?.articles ?? [],
    eligible = rows.filter(
      (a) =>
        !a.existingSnapshotId &&
        !['imported', 'existing'].includes(results[a.id]?.status ?? ''),
    );
  const canAdd = (item: Pick<Article, 'id' | 'subscriptionId'>) =>
    currentQuery &&
    (checked.has(item.id) ||
      (checked.size < 5000 &&
        (perSourceLimit === undefined ||
          (selectedCounts.get(item.subscriptionId) ?? 0) < perSourceLimit)));
  const chooseArticles = (
    items: Pick<Article, 'id' | 'subscriptionId'>[],
    selected: boolean,
  ) => {
    if (!currentQuery) return;
    setChecked((old) => {
      const next = new Map(old),
        counts = new Map<string, number>();
      for (const sourceId of next.values())
        counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
      for (const item of items) {
        if (!selected) {
          next.delete(item.id);
          continue;
        }
        if (next.has(item.id)) continue;
        const count = counts.get(item.subscriptionId) ?? 0;
        if (
          next.size >= 5000 ||
          (perSourceLimit !== undefined && count >= perSourceLimit)
        )
          continue;
        next.set(item.id, item.subscriptionId);
        counts.set(item.subscriptionId, count + 1);
      }
      return next;
    });
  };
  return {
    supported,
    applied,
    limitText,
    setLimitText,
    validLimit,
    validDates,
    canQuery,
    currentQuery,
    selectedCounts,
    resultSource,
    setResultSource,
    canAdd,
    chooseArticles,
    chosen,
    setChosen,
    archives,
    setArchives,
    session,
    states,
    directory,
    checked,
    setChecked,
    text,
    setText,
    from,
    setFrom,
    to,
    setTo,
    offset,
    setOffset,
    busy,
    message,
    setMessage,
    loading,
    results,
    progress,
    requestStop,
    preview,
    dialog,
    read,
    toggle,
    selectFiltered,
    importSelected,
    showPreview,
    enrich,
    closePreview,
    rows,
    eligible,
    setRefresh,
  };
}
