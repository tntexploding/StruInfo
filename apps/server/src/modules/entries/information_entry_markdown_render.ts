import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {EvidenceSnapshotReadState} from '../evidence/evidence_read_repository.js';
import type {MaterializedEvidenceSnapshotReadState} from '../evidence/materialized_evidence_snapshot.js';
import type {InformationEntrySourceReviewItem} from './information_entry_source_review_list.js';
import type {EntryMarkdownPrivacyScope} from './information_entry_markdown_export.js';

export interface EntryMarkdownSource {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly snapshot: Readonly<EvidenceSnapshotReadState>;
  readonly materialized: Readonly<MaterializedEvidenceSnapshotReadState>;
}
const PRIVACY_LABELS = {
  public: '仅公开',
  include_private: '含隐私',
  private_only: '仅隐私',
} as const;
const ORIGIN_LABELS = {
  automatically_calculated: '自动计算的相似性',
  user_created: '人工创建',
  user_edited: '人工编辑',
  ai_assisted: 'AI 辅助关系',
} as const;
const REVIEW_LABELS = {
  unreviewed: '未复核',
  source_checked: '已核对来源',
  needs_review: '需复核',
} as const;

export function renderEntryMarkdown(
  workspaceId: string,
  title: string,
  privacyScope: EntryMarkdownPrivacyScope,
  sources: readonly Readonly<EntryMarkdownSource>[],
  relations: readonly Readonly<InformationEntrySourceReviewItem>[],
): string {
  const lines = [
    '# ' + escapeMarkdown(title),
    '',
    '范围：' +
      PRIVACY_LABELS[privacyScope] +
      ' · ' +
      sources.length.toString() +
      ' 条 · ' +
      relations.length.toString() +
      ' 条清单内关系',
    '工作区：' + workspaceId,
    '',
    '这是一份所选资料的版本快照。条目摘录可能经过人工编辑；来源摘录来自本地不可变证据。未包含会话内 AI 综合。',
    '摘录按 Unicode 字符截取，截断处明确标注。关系与来源复核状态不等于事实核验结论。',
    '',
  ];
  for (const [index, source] of sources.entries()) {
    const {entry, snapshot} = source;
    const publication = snapshot.publication;
    lines.push(
      '## ' +
        (index + 1).toString() +
        '. ' +
        escapeMarkdown(entry.value.titlePath || '未命名条目'),
      '',
      '- 隐私：' + (entry.value.isPrivate ? '隐私资料' : '公开资料'),
      '- Entry：' +
        entry.entryId +
        ' · 版本 ' +
        entry.revision.toString() +
        ' · revisionId ' +
        entry.revisionId,
      '- Resource：' + entry.resourceId,
      '- Snapshot：' + entry.snapshotId,
      '- 来源标识：' + escapeMarkdown(entry.sourceKey),
      '- 来源地址：' + sourceAddress(entry.canonicalUri),
      '- 采集时间：' + entry.capturedAt,
      '- 发布时间：' +
        (publication?.instant ?? '未提供') +
        (publication === undefined
          ? ''
          : ' · ' +
            (publication.inferred ? '推断时间' : '来源记录') +
            (publication.precision === undefined
              ? ''
              : ' · 精度 ' + publication.precision) +
            (publication.sourceTimezone === undefined
              ? ''
              : ' · 时区 ' + escapeMarkdown(publication.sourceTimezone))),
      '- 原始文件 SHA-256：' + snapshot.rawSha256,
      '- 当前正文 SHA-256：' + entry.value.bodySha256,
      '',
      '### 当前条目摘录',
      '',
      excerptBlock(entry.value.body, 1200),
      '',
      '### 原始来源摘录与精确引用',
      '',
      ...renderCitations(source),
      '',
    );
  }
  lines.push(
    '## 清单内已有关系',
    '',
    '仅列出两端均在清单中的当前可见关系；已屏蔽关系和过期自动投影不包含在内。',
    '',
  );
  const ordinals = new Map(
    sources.map(({entry}, index) => [entry.entryId, index + 1]),
  );
  if (relations.length === 0) lines.push('当前没有清单内可见关系。', '');
  for (const {edge, review} of relations) {
    const low = ordinals.get(edge.entryLowId);
    const high = ordinals.get(edge.entryHighId);
    const direction =
      edge.direction === 'symmetric'
        ? '双向'
        : edge.direction === 'low_to_high'
          ? '前者指向后者'
          : '后者指向前者';
    lines.push(
      '### 条目 ' +
        String(low) +
        (edge.direction === 'symmetric'
          ? ' ↔ 条目 '
          : edge.direction === 'low_to_high'
            ? ' → 条目 '
            : ' ← 条目 ') +
        String(high),
      '',
      '- 关系：' + escapeMarkdown(edge.label) + ' · ' + direction,
      '- 语义类型：' + edge.semanticKind,
      '- 来源：' + ORIGIN_LABELS[edge.origin],
      '- 关系版本：' + edge.overrideRevision.toString(),
      '- 来源复核：' +
        REVIEW_LABELS[review.status] +
        (review.reason === 'entry_changed'
          ? '（端点版本已变化）'
          : review.reason === 'unbound'
            ? '（历史记录未绑定版本）'
            : ''),
      ...(review.reviewedRevisions === undefined
        ? []
        : [
            '- 上次复核版本：' +
              review.reviewedRevisions.entryLowRevision.toString() +
              ' / ' +
              review.reviewedRevisions.entryHighRevision.toString(),
          ]),
      ...(edge.projection === undefined
        ? []
        : [
            '- 自动计算：' +
              escapeMarkdown(edge.projection.algorithmVersion) +
              ' · 当前得分 ' +
              edge.effectiveScore.toString(),
          ]),
      '- 维护说明：',
      '',
      literalBlock(edge.note || '未填写'),
      '',
    );
  }
  return lines.join('\n') + '\n';
}

function renderCitations({
  entry,
  snapshot,
  materialized,
}: Readonly<EntryMarkdownSource>): string[] {
  let remaining = 600;
  const lines: string[] = [];
  for (const [index, fragmentId] of entry.value.fragmentIds.entries()) {
    const structure = snapshot.structures.find((candidate) =>
      candidate.fragments.some(
        (fragment) => fragment.fragmentId === fragmentId,
      ),
    );
    const fragment = structure?.fragments.find(
      (candidate) => candidate.fragmentId === fragmentId,
    );
    const text = materialized.structures
      .flatMap((candidate) => candidate.fragments)
      .find((candidate) => candidate.fragmentId === fragmentId)?.selectedText;
    if (structure === undefined || fragment === undefined || text === undefined)
      throw new Error('Export evidence missing.');
    const codePoints = Array.from(text);
    const range = entry.value.fragmentRanges?.[index] ?? {
      startCodePoint: 0,
      endCodePoint: codePoints.length,
    };
    if (
      !Number.isSafeInteger(range.startCodePoint) ||
      !Number.isSafeInteger(range.endCodePoint) ||
      range.startCodePoint < 0 ||
      range.endCodePoint <= range.startCodePoint ||
      range.endCodePoint > codePoints.length
    )
      throw new Error('Export evidence range invalid.');
    const excerptEnd = Math.min(
      range.endCodePoint,
      range.startCodePoint + remaining,
    );
    const excerpt = codePoints.slice(range.startCodePoint, excerptEnd).join('');
    remaining -= excerptEnd - range.startCodePoint;
    lines.push(
      '- 引用 ' + (index + 1).toString() + '：Fragment ' + fragmentId,
      '  - Structure：' + structure.structureId,
      '  - Fragment 内 Unicode 范围：[' +
        range.startCodePoint.toString() +
        ', ' +
        range.endCodePoint.toString() +
        ')',
      '  - 结构全文 Unicode 范围：[' +
        (fragment.codePointRange.start + range.startCodePoint).toString() +
        ', ' +
        (fragment.codePointRange.start + range.endCodePoint).toString() +
        ')',
      '  - 结构文本 SHA-256：' + structure.textBlob.digest,
      '  - 完整 Fragment SHA-256：' + fragment.selectedTextSha256,
      '',
    );
    if (excerpt !== '') {
      lines.push(
        '来源摘录 · Fragment 内 [' +
          range.startCodePoint.toString() +
          ', ' +
          excerptEnd.toString() +
          ')：',
        '',
        literalBlock(excerpt),
        '',
      );
    }
    if (excerptEnd < range.endCodePoint)
      lines.push('（此引用的其余来源文字未摘录；完整定位保留在上方。）', '');
  }
  if (
    entry.value.fragmentIds.length === 0 ||
    (entry.value.fragmentRanges !== undefined &&
      entry.value.fragmentRanges.length !== entry.value.fragmentIds.length)
  )
    throw new Error('Export evidence partition invalid.');
  return lines;
}

function excerptBlock(value: string, limit: number): string {
  const points = Array.from(value);
  return (
    literalBlock(points.slice(0, limit).join('')) +
    (points.length > limit
      ? '\n\n（仅摘录前 ' +
        limit.toString() +
        ' 个 Unicode 字符，正文共 ' +
        points.length.toString() +
        ' 个字符。）'
      : '')
  );
}
/** Literal fences prevent captured HTML, links and images from becoming active Markdown. */
function literalBlock(value: string): string {
  const runs = value.match(/`+/gu) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return fence + 'text\n' + value + (value.endsWith('\n') ? '' : '\n') + fence;
}
function escapeMarkdown(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~]/gu, '\\$&')
    .replace(/[\r\n\t]/gu, ' ');
}
function sourceAddress(value: string | undefined): string {
  if (value === undefined) return '未提供';
  try {
    const url = new URL(value);
    if (
      ['https:', 'http:'].includes(url.protocol) &&
      url.username === '' &&
      url.password === ''
    ) {
      return (
        '[' +
        escapeMarkdown(value) +
        '](' +
        url.href
          .replaceAll('(', '%28')
          .replaceAll(')', '%29')
          .replaceAll('<', '%3C')
          .replaceAll('>', '%3E') +
        ')'
      );
    }
  } catch {
    /* Non-URL locators remain plain metadata. */
  }
  return escapeMarkdown(value);
}
