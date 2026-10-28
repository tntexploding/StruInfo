import {reportPeriod} from './report_selection.js';
import type {
  ReportRecord,
  ReportState,
  ReportSource,
  ReportStory,
} from './report_contract.js';
import {OperationError} from './operation_error.js';

export function validateStory(
  story: ReportStory,
  allowed: ReadonlySet<number>,
) {
  for (const point of story.points) {
    if (
      new Set(point.sources).size !== point.sources.length ||
      point.sources.some((id) => !allowed.has(id))
    )
      throw new OperationError('invalid_input', 'invalid_report_citation');
  }
}
export function validateReportState(state: ReportState) {
  const period = reportPeriod(state.request);
  if (
    period.from !== state.period.from ||
    period.to !== state.period.to ||
    state.totalEligible < state.sources.length ||
    new Set(state.sources.map((source) => source.entryId)).size !==
      state.sources.length ||
    (!state.planned && state.items.length)
  )
    throw new OperationError('invalid_input', 'invalid_report_state');
  const all = new Set(state.sources.map((s) => s.handle));
  if (
    all.size !== state.sources.length ||
    (state.request.maxItems > 0 &&
      state.items.length > state.request.maxItems) ||
    state.calls > state.request.maxModelCalls
  )
    throw new OperationError('invalid_input', 'invalid_report_state');
  const grouped = new Set<number>();
  for (const item of state.items) {
    const allowed = new Set(item.group.sources);
    if (
      allowed.size !== item.group.sources.length ||
      item.group.sources.some((id) => !all.has(id) || grouped.has(id))
    )
      throw new OperationError('invalid_input', 'invalid_report_group');
    item.group.sources.forEach((id) => grouped.add(id));
    if (item.draft) validateStory(item.draft, allowed);
    if (item.edited) validateStory(item.edited, allowed);
  }
  for (const group of state.otherGroups ?? []) {
    if (
      new Set(group.sources).size !== group.sources.length ||
      group.sources.some((id) => !all.has(id) || grouped.has(id))
    )
      throw new OperationError('invalid_input', 'invalid_report_group');
    group.sources.forEach((id) => grouped.add(id));
  }
  if (
    state.otherGroups !== undefined &&
    (!state.planned || grouped.size !== all.size)
  )
    throw new OperationError('invalid_input', 'incomplete_report_selection');
  if (
    ['ready', 'reviewed'].includes(state.status) &&
    state.items.some((i) => !i.draft && !i.edited)
  )
    throw new OperationError('invalid_input', 'incomplete_report');
}
export function renderReportMarkdown(report: ReportRecord) {
  const {state} = report;
  const lines = [
    '# ' + plain(state.title),
    '',
    state.status === 'reviewed' ? '状态：已人工核对。' : '状态：待复核草稿。',
    '统计窗口：' +
      state.period.from +
      ' 至 ' +
      state.period.to +
      '（' +
      state.request.timeZone +
      '；' +
      (state.request.timeField === 'received' ? '接收日期' : '发布日期') +
      '）。',
    '',
    ...(state.sources.some((s) => s.textTruncated)
      ? ['部分长资料使用固定摘录，完整正文见来源。', '']
      : []),
    '选材：' +
      String(state.sources.length) +
      ' / ' +
      String(state.totalEligible) +
      ' 条候选；' +
      String(state.duplicateCount) +
      ' 条重复记录已排除。',
    '',
  ];
  const cited = new Set<number>();
  for (const item of state.items.filter((i) => i.included)) {
    const story = item.edited ?? item.draft;
    if (!story) continue;
    const sources = [...new Set(story.points.flatMap((p) => p.sources))].sort(
      (a, b) => a - b,
    );
    sources.forEach((id) => cited.add(id));
    lines.push('## ' + plain(story.title), '');
    for (const point of story.points) {
      lines.push(
        plain(point.text) +
          (sources.length > 1
            ? ' ' + point.sources.map((id) => '[' + String(id) + ']').join(' ')
            : ''),
        '',
      );
    }
    lines.push(
      '来源：' +
        sources.map((id) => '[' + String(id) + ']').join(' ') +
        ' · ' +
        (item.edited
          ? '人工编辑'
          : state.origin === 'search_results'
            ? '检索摘录'
            : 'AI 草稿') +
        '。',
      '',
    );
  }
  if (state.otherGroups?.length) {
    lines.push(
      '## 其他阅读',
      '',
      '以下事件未纳入本期摘要，保留出处供继续阅读。',
      '',
    );
    for (const group of state.otherGroups) {
      group.sources.forEach((id) => cited.add(id));
      lines.push(
        '- ' +
          plain(group.title) +
          ' ' +
          group.sources.map((id) => '[' + String(id) + ']').join(' '),
      );
    }
    lines.push('');
  }
  lines.push('## 出处', '');
  for (const source of state.sources.filter((s) => cited.has(s.handle))) {
    const url = safeUrl(source.url);
    lines.push(
      '[' +
        String(source.handle) +
        '] ' +
        plain(source.title) +
        (url ? ' — ' + url : ''),
      sourceDates(source, state),
      '条目 ' +
        source.entryId +
        ' · 版本 ' +
        String(source.revision) +
        ' · 原文快照 ' +
        source.snapshotId,
      '',
    );
  }
  lines.push('摘要依据所列材料整理，事实请结合原文核对。');
  return lines.join('\n') + '\n';
}
function sourceDates(source: ReportSource, state: ReportState) {
  const published =
    source.publishedDate ??
    (state.request.timeField === 'published' ? source.date : undefined);
  const received =
    source.receivedDate ??
    (state.request.timeField === 'received' ? source.date : undefined);
  return (
    '发布：' +
    (published ?? '未知') +
    (source.publicationInferred ? '（推定）' : '') +
    ' · 接收：' +
    (received ?? '未知') +
    (published && published < state.period.from
      ? ' · 补充阅读（早于本期）'
      : '')
  );
}
function plain(text: string) {
  return text.replace(/[\r\n]+/gu, ' ').replace(/[\\`*_[\]<>#]/gu, '\\$&');
}
function safeUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      ? url.href.replace(/[\r\n<>]/gu, '')
      : undefined;
  } catch {
    return undefined;
  }
}
