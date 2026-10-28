import type {CurrentInformationEntry} from '../modules/entries/index.js';
import type {IntakeRecord} from './document_intake_contract.js';
import {intakeTargetSnapshot} from './document_intake_contract.js';
import type {EvidenceSnapshotSummary} from '../modules/evidence/evidence_read_repository.js';
import type {ReportRequest, ReportSource} from './report_contract.js';
import {OperationError} from './operation_error.js';

export function reportPeriod(request: ReportRequest) {
  const day = new Date(request.date + 'T00:00:00.000Z');
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== request.date
  )
    throw new OperationError('invalid_input', 'invalid_report_date');
  try {
    new Intl.DateTimeFormat('en-CA', {timeZone: request.timeZone}).format(day);
  } catch {
    throw new OperationError('invalid_input', 'invalid_report_timezone');
  }
  if (request.kind === 'topic') return {from: '0001-01-01', to: '9999-12-31'};
  if (request.kind === 'monthly') day.setUTCDate(1);
  if (request.kind === 'weekly')
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const from = day.toISOString().slice(0, 10);
  if (request.kind === 'weekly') day.setUTCDate(day.getUTCDate() + 6);
  if (request.kind === 'monthly') {
    day.setUTCMonth(day.getUTCMonth() + 1);
    day.setUTCDate(0);
  }
  return {from, to: day.toISOString().slice(0, 10)};
}

export function selectReportSources(
  request: ReportRequest,
  entries: readonly CurrentInformationEntry[],
  records: readonly IntakeRecord[],
  snapshots: readonly Pick<
    EvidenceSnapshotSummary,
    'snapshotId' | 'capturedAt' | 'publication'
  >[],
) {
  const period = reportPeriod(request);
  const dates = new Map(snapshots.map((s) => [s.snapshotId, s.capturedAt]));
  const publications = new Map(
    snapshots.map((s) => [s.snapshotId, s.publication]),
  );
  const admission = new Map(
    records
      .filter((r) => r.value.decision === 'admitted')
      .map((r) => [intakeTargetSnapshot(r), r]),
  );
  const eligible = entries.filter((e) => {
    const intake = admission.get(e.snapshotId);
    if (
      e.value.isPrivate ||
      !intake ||
      (request.cutoff && e.capturedAt > request.cutoff)
    )
      return false;
    const timestamp =
      request.timeField === 'received'
        ? dates.get(intake.snapshotId)
        : e.publishedAt;
    const date = timestamp
      ? calendarDate(timestamp, request.timeZone)
      : undefined;
    return Boolean(date && date >= period.from && date <= period.to);
  });
  const newest = new Map<string, CurrentInformationEntry>();
  for (const e of eligible) {
    const key = e.canonicalUri ?? e.snapshotId,
      old = newest.get(key);
    if (
      !old ||
      e.capturedAt > old.capturedAt ||
      (e.capturedAt === old.capturedAt && e.snapshotId > old.snapshotId)
    )
      newest.set(key, e);
  }
  let duplicateCount = 0;
  const candidates: {
    entry: CurrentInformationEntry;
    source: Omit<ReportSource, 'handle'>;
    score: number;
  }[] = [];
  const seenBodies = new Set<string>();
  const excluded = new Set(request.excludedEntryIds);
  const sorted = [...eligible].sort(
    (a, b) =>
      b.capturedAt.localeCompare(a.capturedAt) ||
      a.value.documentOrder - b.value.documentOrder ||
      a.entryId.localeCompare(b.entryId),
  );
  for (const entry of sorted) {
    if (excluded.has(entry.entryId)) continue;
    if (request.cutoff && entry.capturedAt > request.cutoff) continue;
    const intake = admission.get(entry.snapshotId);
    if (!intake) continue;
    const timestamp =
      request.timeField === 'received'
        ? dates.get(intake.snapshotId)
        : entry.publishedAt;
    if (!timestamp) continue;
    const date = calendarDate(timestamp, request.timeZone);
    if (!date || date < period.from || date > period.to) continue;
    const sourceText = fold(
      [entry.sourceKey, entry.canonicalUri ?? ''].join(' '),
    );
    if (
      request.sources.length &&
      !request.sources.some((t) => sourceText.includes(fold(t)))
    )
      continue;
    const text = fold(
      [
        entry.value.titlePath,
        entry.value.body,
        ...entry.value.contentKeywords.map((k) => k.displayValue),
      ].join(' '),
    );
    const matching = request.topics.filter((t) => text.includes(fold(t)));
    if (request.topics.length && !matching.length) continue;
    if (
      newest.get(entry.canonicalUri ?? entry.snapshotId)?.snapshotId !==
      entry.snapshotId
    ) {
      duplicateCount++;
      continue;
    }
    const body = fold(entry.value.body).replace(/\s+/gu, ' ').trim();
    if (seenBodies.has(body)) {
      duplicateCount++;
      continue;
    }
    seenBodies.add(body);
    const receivedAt = dates.get(intake.snapshotId);
    const receivedDate = receivedAt
      ? calendarDate(receivedAt, request.timeZone)
      : undefined;
    const publication =
      publications.get(entry.snapshotId) ?? publications.get(intake.snapshotId);
    const publishedDate = entry.publishedAt
      ? calendarDate(entry.publishedAt, request.timeZone)
      : undefined;
    candidates.push({
      entry,
      score:
        matching.length * 10 +
        (entry.value.usefulnessScore ?? 0) +
        (entry.value.interestScore ?? 0),
      source: {
        entryId: entry.entryId,
        revision: entry.revision,
        snapshotId: entry.snapshotId,
        intakeSnapshotId: intake.snapshotId,
        title: entry.value.titlePath,
        sourceKey: entry.sourceKey,
        ...(entry.canonicalUri ? {url: entry.canonicalUri} : {}),
        date,
        ...(receivedDate ? {receivedDate} : {}),
        ...(publishedDate
          ? {publishedDate, publicationInferred: publication?.inferred ?? false}
          : {}),
        excerpt: entry.value.body.slice(0, 1200),
        keywords: entry.value.contentKeywords
          .slice(0, 64)
          .map((k) => k.displayValue),
        reason: (
          '本周期已放行' +
          (matching.length ? '；命中话题：' + matching.join('、') : '') +
          '；' +
          (request.timeField === 'received' ? '接收日期' : '发布日期') +
          ' ' +
          date
        ).slice(0, 500),
      },
    });
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.source.date.localeCompare(a.source.date) ||
      a.entry.entryId.localeCompare(b.entry.entryId),
  );
  const selected = candidates.filter(
    (c) =>
      !request.selectedEntryIds ||
      request.selectedEntryIds.includes(c.entry.entryId),
  );
  if (selected.length > 512)
    throw new OperationError('rejected', 'report_source_limit_exceeded');
  return {
    period,
    totalEligible: candidates.length,
    duplicateCount,
    sources: selected.map((c, i) => ({...c.source, handle: i + 1})),
  };
}
function fold(value: string) {
  return value.normalize('NFKC').toLowerCase();
}
function calendarDate(timestamp: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(timestamp)) return timestamp;
  const time = new Date(timestamp);
  if (!Number.isFinite(time.getTime())) return undefined;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);
}
