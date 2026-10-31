import {request, ingestion} from './api.js';

export const titleOf = (value) =>
  value.title ||
  value.sourceAlias ||
  value.sourceKey?.replace(/#sha256:[a-f0-9]+$/, '') ||
  value.canonicalUri ||
  '未命名文档';
export const textOf = (snapshot) =>
  snapshot.structures?.find((s) => typeof s.normalizedText === 'string')
    ?.normalizedText || '';
export async function documentPage(
  includePrivate = false,
  options = {},
  client = {request},
) {
  const q = new URLSearchParams({
    includePrivate: String(includePrivate),
    ...Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined && v !== null),
    ),
  });
  return client.request('entry-documents?' + q);
}
export async function documentList(
  includePrivate = false,
  options = {},
  client = {request},
) {
  return (await documentPage(includePrivate, options, client)).documents;
}
export async function documentRead(
  id,
  includePrivate = false,
  client = {request},
) {
  return client.request(
    `evidence/snapshots/${encodeURIComponent(id)}?includePrivate=${includePrivate}`,
  );
}
export async function inbox(
  includePrivate = false,
  client = {request, ingestion},
) {
  const {request, ingestion} = client;
  const [evidence, intake] = await Promise.all([
    request(`evidence?limit=100&includePrivate=${includePrivate}`),
    ingestion('intake_status'),
  ]);
  const snapshots = [...evidence.snapshots];
  let cursor = evidence.nextCursor;
  while (cursor) {
    const page = await request(
      `evidence?limit=100&includePrivate=${includePrivate}&afterCapturedAt=${encodeURIComponent(cursor.capturedAt)}&afterSnapshotId=${cursor.snapshotId}`,
    );
    snapshots.push(...page.snapshots);
    cursor = page.nextCursor;
  }
  const records = intake.records || [];
  return snapshots
    .filter((s) => includePrivate || !s.isPrivate)
    .map((s) => ({
      ...s,
      intake: records.find((r) => r.snapshotId === s.snapshotId),
    }));
}
export function download(name, content, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createDocumentClient(client) {
  return {
    documentPage: (privacy, options) => documentPage(privacy, options, client),
    documentList: (privacy, options) => documentList(privacy, options, client),
    documentRead: (id, privacy) => documentRead(id, privacy, client),
    inbox: (privacy) => inbox(privacy, client),
  };
}
