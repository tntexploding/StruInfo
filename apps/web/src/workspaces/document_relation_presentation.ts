import {fromMarkdown} from 'mdast-util-from-markdown';
import type {
  InformationEntry,
  InformationEntryAssociationView,
} from '../api/m1c_api_contract.js';
import {plainText, readingTitle} from '../components/reading_text.js';

export interface DocumentLink {
  entryId: string;
  snapshotId: string;
  title: string;
  originalTitle: string;
  isExcerpt: boolean;
  label: string;
  reasonLabel: string;
  reason: string;
  origin: string;
  review: string;
  note: string;
  broad: boolean;
}

function isNumberOnly(value: string): boolean {
  return /^(?:第\s*)?[\d一二三四五六七八九十百零〇]+(?:\s*[、.．:：)）-]|\s*[条章节项])?$/u.test(
    value.replace(/^[（(]\s*/u, '').trim(),
  );
}

function excerpt(body: string): string {
  const blocks = fromMarkdown(body).children;
  const text = blocks
    .filter((node) => !['definition', 'html', 'image'].includes(node.type))
    .map((node) => plainText(node).replace(/\s+/gu, ' ').trim())
    .find((value) => value !== '' && !isNumberOnly(value));
  const characters = Array.from(text ?? '未命名条目');
  return characters.slice(0, 80).join('') + (characters.length > 80 ? '…' : '');
}

export function documentRelationPresentation(
  entry: Readonly<InformationEntry>,
  relation: Readonly<InformationEntryAssociationView>,
): DocumentLink {
  const other = relation.relatedEntry;
  const graph = relation.override?.value.graph;
  const label = graph?.label ?? '内容相似';
  const originalTitle = readingTitle(other.value.titlePath);
  const isExcerpt =
    originalTitle === '未命名条目' || isNumberOnly(originalTitle);
  // Translate only the known generic wording, never invent a model explanation.
  const shared = /^shared\s+(.+?)\s+(?:focus|topic|theme|context)\.?$/iu.exec(
    label.trim(),
  );
  const mentions = shared
    ? entry.value.contentKeywords
        .map((tag) => tag.displayValue.trim())
        .filter(
          (tag) =>
            /\p{Script=Han}/u.test(tag) && tag.length >= 2 && tag.length <= 24,
        )
        .filter(
          (tag) =>
            entry.value.body.includes(tag) && other.value.body.includes(tag),
        )
    : [];
  const origin =
    graph?.origin === 'ai'
      ? 'AI'
      : graph?.origin === 'user'
        ? '人工'
        : '相似度';
  let reasonLabel = '关联说明';
  let reason = label;
  if (shared) {
    reasonLabel = mentions.length ? '共同提及' : '共同关注';
    reason = mentions.length
      ? [...new Set(mentions)].slice(0, 4).join('、')
      : (shared[1] ?? label);
  } else if (!/\p{Script=Han}/u.test(label)) {
    reasonLabel = '关系类型';
    reason = {
      similarity: '内容相似',
      related: '相关内容',
      supports: '支持',
      contradicts: '矛盾',
      part_of: '组成部分',
      causes: '因果',
      example_of: '实例',
      custom: '自定义联系',
    }[graph?.semanticKind ?? 'similarity'];
  }
  return {
    entryId: other.entryId,
    snapshotId: other.snapshotId,
    title: isExcerpt ? excerpt(other.value.body) : originalTitle,
    originalTitle,
    isExcerpt,
    label,
    reasonLabel,
    reason,
    origin,
    review:
      !graph || graph.origin === 'association'
        ? '自动计算'
        : graph.verificationStatus === 'source_checked'
          ? '已核对来源'
          : graph.verificationStatus === 'needs_review'
            ? '需要复核'
            : '尚未人工核查',
    note: graph?.note ?? '',
    broad: shared !== null,
  };
}
