import assert from 'node:assert/strict';
import {deriveUuidV5} from './information_entry_identity.js';
import type {
  CurrentInformationEntry,
  InformationEntryRevisionValue,
} from './information_entry_contract.js';
import {
  canonicalAnnotationTerm,
  structuredAnnotationsSchema,
  withDefaultAnnotationDimensions,
  type AnnotationVocabulary,
  type StructuredAnnotations,
} from './structured_annotations.js';

export const LEGACY_TAG_MIGRATION = 'legacy-tags.v1';
const namespace = '3ec7a461-8fa8-546b-9844-f42b70675e75';
const types: Record<string, string> = {
  factual_material: '事实资料',
  knowledge_explanation: '知识解释',
  operating_guideline: '操作指南',
  investigation_analysis: '调查分析',
  argument: '观点论述',
  personal_experience: '个人经历',
  interactive_collaboration: '互动协作',
  public_communication: '公共传播',
  literary_creation: '文学创作',
  other: '其他',
};
const domains: Record<string, string> = {
  mathematics_formal: '数学与形式科学',
  nature_environment: '自然与环境',
  engineering_computing: '工程与计算',
  life_health: '生命与健康',
  society_public_affairs: '社会与公共事务',
  economy_business: '经济与商业',
  law_policy_governance: '法律与治理',
  humanities_history: '人文与历史',
  language_education: '语言与教育',
  culture_arts: '文化与艺术',
  daily_life: '日常生活',
  other: '其他',
};

export function legacyTagVocabulary(
  vocabulary: AnnotationVocabulary,
): AnnotationVocabulary {
  const v = withDefaultAnnotationDimensions(vocabulary);
  const defaults = withDefaultAnnotationDimensions({...v, dimensions: []});
  const dimensions = [...v.dimensions];
  for (const role of ['form', 'domain'] as const) {
    if (!dimensions.some((d) => d.role === role)) {
      const dimension = defaults.dimensions.find((d) => d.role === role);
      assert(dimension);
      dimensions.push(dimension);
    }
  }
  const id = deriveUuidV5(namespace, 'legacy-unclassified');
  if (!dimensions.some((d) => d.id === id))
    dimensions.push({
      id,
      name: '未分类',
      role: 'custom',
      description: '迁移的旧关键词，尚未补充类别与原文依据。',
      enabled: false,
    });
  return {...v, dimensions};
}

export function migrateLegacyEntryTags(
  entry: CurrentInformationEntry,
  vocabulary: AnnotationVocabulary,
): CurrentInformationEntry {
  const value = entry.value;
  const old = value.annotations;
  if (
    !value.contentKeywords.length &&
    !value.domains.length &&
    !value.typeKeyword
  )
    return entry;
  // A newer annotation set is authoritative. Never merge retired fields over it.
  if (old && old.originVersion !== 'reading-state.v1')
    return {...entry, value: clearLegacy(value, old)};
  const v = legacyTagVocabulary(vocabulary);
  const labels: StructuredAnnotations['labels'] = [];
  const append = (
    role: 'form' | 'domain' | 'custom',
    label: string,
    key: string,
    source: 'content_keyword' | 'type' | 'domain',
    origin: 'manual' | 'ai' | 'rule',
    originVersion: string,
  ) => {
    const dimensionId =
      role === 'custom'
        ? deriveUuidV5(namespace, 'legacy-unclassified')
        : v.dimensions.find((d) => d.role === role)?.id;
    assert(dimensionId);
    const term = canonicalAnnotationTerm(
      {id: deriveUuidV5(dimensionId, key), dimensionId, label, meaning: ''},
      v,
    );
    if (!labels.some((l) => l.term.id === term.id))
      labels.push({
        dimensionId,
        term,
        wording: label,
        primary: true,
        legacy: {source, key, origin, originVersion},
      });
  };
  for (const t of value.contentKeywords)
    append(
      'custom',
      t.displayValue,
      t.normalizedValue,
      'content_keyword',
      t.origin,
      t.originVersion,
    );
  if (value.typeKeyword)
    append(
      'form',
      value.typeCustomName ?? types[value.typeKeyword] ?? value.typeKeyword,
      value.typeKeyword,
      'type',
      'rule',
      LEGACY_TAG_MIGRATION,
    );
  for (const t of value.domains)
    append(
      'domain',
      t.customName ?? domains[t.keyword] ?? t.keyword,
      t.keyword,
      'domain',
      t.origin,
      t.originVersion,
    );
  const annotations = structuredAnnotationsSchema.parse({
    schemaVersion: 1,
    dimensions: v.dimensions,
    vocabularyRevision: v.revision,
    inputRevision: entry.revision,
    inputBodySha256: value.bodySha256,
    origin: labels.some((l) => 'legacy' in l && l.legacy.origin === 'manual')
      ? 'manual'
      : 'rule',
    originVersion: LEGACY_TAG_MIGRATION,
    status: 'partial',
    note: '由旧标签迁移，未补充原文依据。',
    readingState: old?.readingState ?? 'unread',
    labels,
    claims: [],
  });
  return {...entry, value: clearLegacy(value, annotations)};
}

function clearLegacy(
  value: InformationEntryRevisionValue,
  annotations: StructuredAnnotations,
): InformationEntryRevisionValue {
  const next = {...value, annotations, contentKeywords: [], domains: []};
  delete next.typeKeyword;
  delete next.typeCustomName;
  return next;
}
