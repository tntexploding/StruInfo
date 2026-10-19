import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {log} from 'node:console';
import {readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {TextDecoder, TextEncoder} from 'node:util';

// Run inside the final image, with this file mounted read-only. No network,
// database, personal data or model access is required.
const serverRoot = '/opt/struinfo/apps/server';
const require = createRequire(resolve(serverRoot, 'package.json'));
assert.equal(require('./package.json').version, '0.4.0');
assert.equal(process.getuid(), 10001);
assert.equal(
  readdirSync(resolve(serverRoot, 'node_modules'), {recursive: true}).some(
    (name) => name.endsWith('.node'),
  ),
  false,
  'The runtime must not inherit native binaries from the glibc build stage.',
);
assert.equal(typeof require('pg').Pool, 'function');
await import(
  pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'))
);
const {projectStructuredDocument} = await import(
  pathToFileURL(
    resolve(
      serverRoot,
      'dist/modules/evidence/documents/document_projection.js',
    ),
  )
);
const html = await projectStructuredDocument(
  'html',
  new TextEncoder().encode(
    '<article><h1>Example</h1><p>Synthetic HTML text.</p></article>',
  ),
);
assert.equal(html.status, 'projected');
assert.match(
  new TextDecoder().decode(html.value.sourceUtf8),
  /Synthetic HTML text/u,
);

const stream = 'BT\n/F1 18 Tf\n72 720 Td\n(Synthetic PDF text) Tj\nET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = [];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets)
  pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const document = await projectStructuredDocument(
  'pdf',
  new TextEncoder().encode(pdf),
);
assert.equal(document.status, 'projected');
assert.equal(document.value.pageCount, 1);
assert.match(
  new TextDecoder().decode(document.value.sourceUtf8),
  /Synthetic PDF text/u,
);
log(
  'Runtime image: non-root, JavaScript dependencies, MCP, HTML and PDF passed.',
);
