import {documentPage} from './api.js';
import {documentRead} from './api.js';
import {pageContext} from '../../runtime/route.js';
const page = pageContext('reading');
import {request, ingestion, tasks} from './api.js';
import {textOf, titleOf} from '../../runtime/documents.js';
export const articles = [],
  annotations = {},
  topics = [];
const loaded = new Map(),
  drafts = new Map(),
  edges = new Map();
let vocabulary;
export let loadError = '';
export let privateScope = false;
export function setPrivateScope(value) {
  privateScope = Boolean(value);
  loaded.clear();
  articles.length = 0;
  edges.clear();
  topics.length = 0;
}
export const anyDraft = () => drafts.size > 0;
export const original = (id) => articles.find((a) => a.id === id);
export const config = (id) => drafts.get(id) || {};
export const readState = (id) =>
  config(id).readingState ||
  loaded.get(id)?.entries[0]?.value.annotations?.readingState ||
  original(id)?.summaryRecord.readingState ||
  'unread';
export const setReadState = (id, value) =>
  saveDraft(id, {...config(id), readingState: value});
const words = (s) => [
  ...new Set(
    String(s || '')
      .split(/[,，、\n]/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
function entryAt(d, index) {
  const r = d.ranges?.[index];
  if (!r) return;
  return (
    loaded.get(d.id)?.entries.find((x) =>
      x.value.fragmentRanges?.some((g, j) => {
        const f = loaded
          .get(d.id)
          .snapshot.structures.flatMap((s) => s.fragments)
          .find((f) => f.fragmentId === x.value.fragmentIds[j]);
        const start = (f?.codePointRange.start || 0) + g.startCodePoint;
        return (
          r.start >= start &&
          r.start < start + g.endCodePoint - g.startCodePoint
        );
      }),
    ) ||
    loaded
      .get(d.id)
      ?.entries.find((x) =>
        x.value.body.includes(d.paragraphs[index]?.[1] || '\u0000'),
      )
  );
}
function annotate(d) {
  annotations[d.id] = d.paragraphs.map((_, i) => {
    const a = entryAt(d, i)?.value.annotations;
    const v = entryAt(d, i)?.value;
    const result = {
      domain: v?.domains.map((d) => d.customName || d.keyword).join('、') || '',
      subject: v?.contentKeywords.map((t) => t.displayValue).join('、') || '',
      purpose: '',
    };
    if (a) {
      for (const [key, role] of [
        ['domain', 'domain'],
        ['subject', 'issue'],
        ['purpose', 'purpose'],
      ]) {
        const ids = a.dimensions
          .filter((d) => d.role === role)
          .map((d) => d.id);
        const labels = a.labels
          .filter((l) => ids.includes(l.dimensionId))
          .map((l) => l.wording);
        if (labels.length) result[key] = labels.join('、');
      }
    }
    return result;
  });
}
export async function loadDocument(id) {
  if (loaded.has(id)) return original(id);
  if (!original(id)) {
    const result = await documentPage(privateScope, {limit: 1, snapshotId: id});
    if (!result.documents.length)
      throw new Error('该文档不存在，或不在当前查看范围');
    remember(result.documents[0]);
  }
  const [result, publication] = await Promise.all([
    documentRead(id, privateScope),
    tasks('document_publication_status', {snapshotId: id}),
  ]);
  const d = original(id);
  if (!d) throw new Error('文档不在当前查看范围');
  const text = textOf(result.snapshot),
    points = Array.from(text),
    ranges = [];
  let offset = 0;
  for (const part of text.split(/(\n\s*\n)/u)) {
    const length = Array.from(part).length;
    if (part.trim()) {
      ranges.push({start: offset, end: offset + length, text: part});
    }
    offset += length;
  }
  if (!ranges.length) ranges.push({start: 0, end: points.length, text});
  // Blank lines remain in the source interval; the reader does not rewrite evidence.
  ranges.forEach((r, i) => (r.end = ranges[i + 1]?.start ?? points.length));
  d.ranges = ranges;
  d.paragraphs = ranges.map((r) => {
    const m = r.text.match(/^#{1,6}\s+(.+)(?:\n|$)/u);
    return [m?.[1] || '', m ? r.text.slice(m[0].length) : r.text];
  });
  d.title = text.match(/^#\s+([^\n]+)/u)?.[1] || titleOf(d.summaryRecord);
  d.tags = d.summaryRecord.currentTags?.value.tags.map((t) =>
    typeof t === 'string' ? t : t.displayValue,
  ) || [
    ...new Set(
      result.entries.flatMap((e) =>
        e.value.contentKeywords.map((t) => t.displayValue),
      ),
    ),
  ];
  d.type =
    result.entries[0]?.value.typeCustomName ||
    result.entries[0]?.value.typeKeyword ||
    '文档';
  loaded.set(id, {...result, publication});
  annotate(d);
  const starts = new Set([0]);
  for (const entry of result.entries) {
    const idx = d.paragraphs.findIndex(
      (_, i) => entryAt(d, i)?.entryId === entry.entryId,
    );
    if (idx >= 0) starts.add(idx);
  }
  d.starts = [...starts].sort((a, b) => a - b);
  d.linksStatus = 'loading';
  d.linksReady = loadLinks(id, d)
    .then(() => {
      d.linksStatus = 'ready';
      page.root.dispatchEvent(new CustomEvent('document-links', {detail: id}));
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        d.linksStatus = 'error';
        d.linksError = error.message;
        page.root.dispatchEvent(
          new CustomEvent('document-links', {detail: id}),
        );
      }
    });
  return d;
}
export async function retryLinks(id) {
  const d = original(id);
  if (!d) return;
  d.linksStatus = 'loading';
  try {
    await loadLinks(id, d);
    d.linksStatus = 'ready';
  } catch (e) {
    d.linksStatus = 'error';
    d.linksError = e.message;
    throw e;
  } finally {
    page.root.dispatchEvent(new CustomEvent('document-links', {detail: id}));
  }
}
async function loadLinks(id, d) {
  const result = await ingestion('topics_list', {snapshotId: id});
  if (!loaded.has(id)) return;
  for (const entry of loaded.get(id).entries) {
    for (const topic of result.topics) {
      if (!topics.some((t) => t.id === topic.id))
        topics.push({
          id: topic.id,
          name: topic.value.name,
          description: topic.value.scope,
          ids: [id],
        });
      const t = topics.find((t) => t.id === topic.id);
      if (!t.ids.includes(id)) t.ids.push(id);
      for (const relation of topic.value.relations.filter((r) => !r.blocked)) {
        const own =
          relation.from.entryId === entry.entryId
            ? relation.from
            : relation.to.entryId === entry.entryId
              ? relation.to
              : null;
        if (!own) continue;
        const other = own === relation.from ? relation.to : relation.from;
        const target = topic.entries.find((e) => e.entryId === other.entryId);
        if (!target?.snapshotId) continue;
        const key =
          topic.id + ':' + relation.from.entryId + ':' + relation.to.entryId;
        edges.set(key, {
          id: key,
          topicId: topic.id,
          version: topic.version,
          relation,
          a: id,
          ai: Math.max(
            0,
            d.paragraphs.findIndex(
              (_, i) => entryAt(d, i)?.entryId === entry.entryId,
            ),
          ),
          b: target.snapshotId,
          targetTitle: target.title,
          bi: 0,
          label: topic.value.name,
          reason: relation.reason,
          kind: relation.kind,
        });
        if (!t.ids.includes(target.snapshotId)) t.ids.push(target.snapshotId);
      }
    }
  }
}
export function documentById(id) {
  const d = original(id);
  if (!d) return null;
  const c = config(id),
    starts = new Set(c.starts || d.starts || [0]);
  starts.add(0);
  const groups = [];
  d.paragraphs.forEach((p, i) => {
    if (starts.has(i))
      groups.push({
        title:
          entryAt(d, i)?.value.titlePath ||
          p[0] ||
          `第 ${groups.length + 1} 段`,
        indices: [],
        blocks: [],
      });
    groups.at(-1).indices.push(i);
    groups.at(-1).blocks.push(p);
  });
  return {
    ...d,
    tags: c.tags || d.tags,
    groups,
    paragraphs: groups.map((g) => [
      g.title,
      ...g.blocks.flatMap((b, i) => (i ? b : b.slice(1))),
    ]),
  };
}
export function sectionAnnotations(d, index) {
  const c = config(d.id),
    values = d.groups[index].indices.map((i) => ({
      ...annotations[d.id]?.[i],
      ...c.sectionTags?.[i],
    }));
  const join = (key) =>
    [...new Set(values.flatMap((v) => words(v[key])))].join('、');
  return {
    domain: join('domain'),
    subject: join('subject'),
    purpose: join('purpose'),
  };
}
export function docLinks(id) {
  return (
    config(id).relations ||
    [...edges.values()].filter((e) => e.a === id || e.b === id)
  ).map((e) => {
    const own = e.a === id,
      target = own ? e.b : e.a,
      ownBase = own ? e.ai : e.bi,
      targetBase = own ? e.bi : e.ai;
    return {
      ...e,
      target,
      ownBase,
      targetBase,
      ownIndex: Math.max(
        0,
        documentById(id).groups.findIndex((g) => g.indices.includes(ownBase)),
      ),
      targetIndex: Math.max(
        0,
        documentById(target)?.groups.findIndex((g) =>
          g.indices.includes(targetBase),
        ) || 0,
      ),
    };
  });
}
const groupsFor = (id) => {
  const d = documentById(id),
    whole = loaded
      .get(id)
      .snapshot.structures.flatMap((s) => s.fragments)
      .find((f) => f.nodeKind === 'document');
  if (!whole) throw new Error('缺少全文定位');
  return d.groups.map((g) => ({
    titlePath: g.title,
    fragments: [
      {
        fragmentId: whole.fragmentId,
        startCodePoint: d.ranges[g.indices[0]].start,
        endCodePoint: d.ranges[g.indices.at(-1)].end,
      },
    ],
  }));
};
export async function saveDraft(id, change) {
  if (!Object.keys(change).length) {
    drafts.delete(id);
    return;
  }
  drafts.set(id, structuredClone(change));
  if (change.starts) {
    if (!loaded.get(id).entries.length) {
      config(id).plan = {
        initial: true,
        resultingEntryCount: groupsFor(id).length,
        annotationReviewCount: 0,
        collapsedRelationshipCount: 0,
        conflictingRelationshipCount: 0,
      };
    } else {
      const preview = await request('entries/restructure/preview', {
        snapshotId: id,
        includePrivate: privateScope,
        groups: groupsFor(id),
      });
      config(id).plan = preview;
    }
  }
}
export function discard(id) {
  drafts.delete(id);
}
export const draftNote = (id) => {
  const plan = config(id).plan;
  return plan
    ? `确认后生成 ${plan.resultingEntryCount} 个条目，${plan.annotationReviewCount} 个标注需复核，${plan.collapsedRelationshipCount + plan.conflictingRelationshipCount} 条联系受影响。`
    : '修改尚未确认';
};
function annotationDraft(entry) {
  const a = entry.value.annotations;
  return {
    status: a?.status || 'partial',
    note: a?.note || '',
    readingState: a?.readingState || 'unread',
    labels: structuredClone(a?.labels || []),
    claims: structuredClone(a?.claims || []),
  };
}
async function saveAnnotation(entry, annotation) {
  const result = await ingestion('entry_annotations_save', {
    entryId: entry.entryId,
    expectedRevision: entry.revision,
    includePrivate: privateScope,
    vocabularyRevision: vocabulary.revision,
    annotation,
  });
  return result;
}
export async function saveChanges(id) {
  const base = loaded.get(id),
    d = original(id),
    change = config(id),
    latest = await documentRead(id, privateScope);
  const versions = (x) =>
    JSON.stringify(x.map((e) => [e.entryId, e.revision]).sort());
  if (versions(latest.entries) !== versions(base.entries))
    throw new Error('文档已被修改，请重新打开后编辑');
  if (change.starts) {
    if (!change.plan) throw new Error('先保存分段草稿');
    if (change.plan.initial)
      await request('entries/materialize/manual', {
        snapshotId: id,
        includePrivate: privateScope,
        groups: groupsFor(id),
      });
    else
      await request('entries/restructure/apply', {
        snapshotId: id,
        includePrivate: privateScope,
        groups: groupsFor(id),
        planSha256: change.plan.planSha256,
        acknowledgeAnnotationChanges: true,
        acknowledgeRelationshipChanges: true,
      });
    base.entries = (await documentRead(id, privateScope)).entries;
    delete change.starts;
    delete change.plan;
  }
  if (change.tags) {
    await request(
      `entry-documents/${id}/tags`,
      {
        expectedRevision: d.summaryRecord.currentTags?.revision || 0,
        includePrivate: privateScope,
        tags: change.tags,
      },
      'PUT',
    );
    delete change.tags;
  }
  const fresh = await documentRead(id, privateScope);
  base.entries = fresh.entries;
  if (change.sectionTags || change.readingState) {
    const next = structuredClone(vocabulary);
    for (const tags of Object.values(change.sectionTags || {})) {
      for (const [key, role, label] of [
        ['domain', 'domain', '领域'],
        ['subject', 'issue', '议题'],
        ['purpose', 'purpose', '用途'],
      ]) {
        let dimension = next.dimensions.find((d) => d.role === role);
        if (!dimension) {
          dimension = {
            id: crypto.randomUUID(),
            name: label,
            role,
            description: '',
            enabled: true,
          };
          next.dimensions.push(dimension);
        }
        for (const word of words(tags[key]))
          if (
            !next.terms.some(
              (t) => t.label === word && t.dimensionId === dimension.id,
            )
          )
            next.terms.push({
              id: crypto.randomUUID(),
              dimensionId: dimension.id,
              label: word,
              meaning: '',
            });
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(vocabulary))
      vocabulary = (
        await ingestion('annotation_vocabulary_save', {
          expectedRevision: vocabulary.revision,
          vocabulary: next,
        })
      ).vocabulary;
    const updates = new Map();
    for (const [index, tags] of Object.entries(change.sectionTags || {})) {
      const entry = entryAt(d, Number(index));
      if (!entry) throw new Error('这段原文尚未生成条目，请先确认分段');
      const a = updates.get(entry.entryId) || annotationDraft(entry);
      for (const [key, role] of [
        ['domain', 'domain'],
        ['subject', 'issue'],
        ['purpose', 'purpose'],
      ]) {
        const dimension = vocabulary.dimensions.find((d) => d.role === role);
        a.labels = a.labels.filter((l) => l.dimensionId !== dimension.id);
        const quote = Array.from(entry.value.body).slice(0, 500).join('');
        for (const word of words(tags[key])) {
          const term = vocabulary.terms.find(
            (t) => t.dimensionId === dimension.id && t.label === word,
          );
          a.labels.push({
            dimensionId: dimension.id,
            term,
            wording: word,
            primary: true,
            evidence: {start: 0, end: Array.from(quote).length, quote},
          });
        }
      }
      updates.set(entry.entryId, a);
    }
    for (const entry of fresh.entries) {
      const a = updates.get(entry.entryId) || annotationDraft(entry);
      if (change.readingState) a.readingState = change.readingState;
      if (updates.has(entry.entryId) || change.readingState) {
        await saveAnnotation(entry, a);
        base.entries = (await documentRead(id, privateScope)).entries;
      }
    }
    delete change.sectionTags;
    delete change.readingState;
  }
  await reloadDocument(id);
}
export async function publishDocument(id) {
  const before = await documentRead(id, privateScope);
  await tasks('document_publish', {
    snapshotId: id,
    expectedEntries: before.entries.map((e) => ({
      entryId: e.entryId,
      revision: e.revision,
    })),
  });
  await reloadDocument(id);
}
export async function saveRelations(id) {
  const change = config(id);
  if (change.relations) {
    for (const edge of change.relations) {
      if (edge.id) continue;
      await loadDocument(edge.b);
      const a = entryAt(original(edge.a), edge.ai),
        b = entryAt(original(edge.b), edge.bi);
      if (!a || !b) throw new Error('关联的两段原文都需要先生成条目');
      const created = edge.topicId
        ? {topicId: edge.topicId}
        : await ingestion('topic_save', {
            expectedVersion: 0,
            name: edge.label.slice(0, 160),
            scope: edge.reason,
          });
      edge.topicId = created.topicId;
      let topic = (await ingestion('topics_list')).topics.find(
        (t) => t.id === created.topicId,
      );
      const evidence = (entry) => ({
        entryId: entry.entryId,
        revision: entry.revision,
        quote: Array.from(entry.value.body).slice(0, 500).join(''),
      });
      for (const entry of [a, b]) {
        if (
          topic.value.members.some(
            (m) => m.entryId === entry.entryId && m.decision === 'pinned',
          )
        )
          continue;
        await ingestion('topic_member_set', {
          topicId: topic.id,
          expectedVersion: topic.version,
          member: {...evidence(entry), reason: edge.reason, decision: 'pinned'},
        });
        topic = (await ingestion('topics_list')).topics.find(
          (t) => t.id === topic.id,
        );
      }
      await ingestion('topic_relation_set', {
        topicId: topic.id,
        expectedVersion: topic.version,
        relation: {
          from: evidence(a),
          to: evidence(b),
          kind: edge.kind,
          reason: edge.reason,
          blocked: false,
        },
      });
      edge.id = topic.id;
    }
    for (const edge of [...edges.values()].filter(
      (e) => e.a === id || e.b === id,
    )) {
      if (change.relations.some((e) => e.id === edge.id)) continue;
      await ingestion('topic_relation_set', {
        topicId: edge.topicId,
        expectedVersion: (await ingestion('topics_list')).topics.find(
          (t) => t.id === edge.topicId,
        )?.version,
        relation: {
          ...Object.fromEntries(
            Object.entries(edge.relation).filter(([key]) => key !== 'origin'),
          ),
          blocked: true,
        },
      });
    }
    delete change.relations;
  }

  await reloadDocument(id);
}
export function publicationState(id) {
  return loaded.get(id)?.publication;
}
export const localContentChanges = (id) =>
  Object.keys(config(id)).some((k) => k !== 'relations');
export const relationChanges = (id) => Boolean(config(id).relations);
async function reloadDocument(id) {
  const change = config(id);
  if (!Object.keys(change).length) drafts.delete(id);
  loaded.delete(id);
  for (const [key, edge] of edges)
    if (edge.a === id || edge.b === id) edges.delete(key);
  const summary = (await documentPage(privateScope, {limit: 1, snapshotId: id}))
    .documents[0];
  if (summary) original(id).summaryRecord = summary;
  await loadDocument(id);
}
export const browse = {
  ids: [],
  totalCount: 0,
  nextCursor: null,
  query: '',
  type: '',
  readingState: '',
  types: [],
};
let browseSequence = 0;
function remember(d) {
  const found = original(d.snapshotId);
  const value = {
    id: d.snapshotId,
    title: titleOf(d),
    source: d.canonicalUri
      ? new URL(d.canonicalUri).hostname
      : d.resourceKind === 'manual_text' || d.resourceKind === 'uploaded_file'
        ? '手动导入'
        : d.sourceKey,
    date: new Date(d.capturedAt).toLocaleDateString(),
    type: d.types?.join('、') || '文档',
    tags:
      d.currentTags?.value.tags.map((t) =>
        typeof t === 'string' ? t : t.displayValue,
      ) || [],
    summary: '',
    paragraphs: [[titleOf(d), '']],
    summaryRecord: d,
  };
  if (found) {
    found.summaryRecord = d;
    return found;
  }
  articles.push(value);
  return value;
}
export async function loadDocuments({
  q = '',
  type = '',
  readingState = '',
  append = false,
} = {}) {
  const sequence = ++browseSequence;
  loadError = '';
  try {
    const after = append ? browse.nextCursor : null;
    const result = await documentPage(privateScope, {
      limit: 50,
      q,
      ...(type ? {type} : {}),
      ...(readingState ? {readingState} : {}),
      ...(after
        ? {afterCapturedAt: after.capturedAt, afterSnapshotId: after.snapshotId}
        : {}),
    });
    if (sequence !== browseSequence) return;
    result.documents.forEach(remember);
    browse.ids = append
      ? [...browse.ids, ...result.documents.map((d) => d.snapshotId)]
      : result.documents.map((d) => d.snapshotId);
    Object.assign(browse, {
      totalCount: result.totalCount,
      nextCursor: result.nextCursor || null,
      query: q,
      type,
      readingState,
      types: result.facets?.types || [],
    });
    if (!vocabulary)
      vocabulary = (await ingestion('annotation_vocabulary')).vocabulary;
  } catch (error) {
    if (error.name !== 'AbortError') loadError = error.message;
    throw error;
  }
}
