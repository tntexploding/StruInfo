import {request} from './api.js';
export async function importDocument({name, text, file, isPrivate = false}) {
  const bytes = file
    ? new Uint8Array(await file.arrayBuffer())
    : new TextEncoder().encode(text);
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const resourceId = crypto.randomUUID(),
    snapshotId = crypto.randomUUID();
  const ext = file?.name.split('.').at(-1).toLowerCase();
  const format =
    ext === 'pdf' ? 'pdf' : ['html', 'htm'].includes(ext) ? 'html' : undefined;
  const body = {
    commandIdempotencyKey: 'import-' + snapshotId,
    resource: {
      resourceId,
      resourceKind: file ? 'uploaded_file' : 'manual_text',
      sourceKey: `${name || file?.name || '手动文本'}#sha256:${digest}`,
      isPrivate,
    },
    snapshot: {
      snapshotId,
      resourceId,
      capturedAt: new Date().toISOString(),
      mediaType:
        format === 'pdf'
          ? 'application/pdf'
          : format === 'html'
            ? 'text/html'
            : ext === 'txt'
              ? 'text/plain'
              : 'text/markdown',
    },
    gitObservations: [],
    profile: 'commonmark-v1',
  };
  if (file) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    body.sourceBase64 = btoa(binary);
  } else body.sourceText = text;
  if (format) body.documentFormat = format;
  return request(format ? 'imports/document' : 'imports/markdown', body);
}
