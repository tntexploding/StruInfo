import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {ADMITTED_PARSER_ARTIFACT_ORACLE} from '../tests/fixtures/markdown/frozen_markdown_oracles.js';
import {
  ALL_STATIC_SYNTHETIC_TEXTS,
  MARKDOWN_BUDGET_LIMITS,
  createDepthBudgetMarkdown,
  createDiagnosticBudgetMarkdown,
  createFragmentBudgetMarkdown,
  createLinkBudgetMarkdown,
  createMediaBudgetMarkdown,
  createNodeBudgetMarkdown,
  createSourceBudgetUtf8,
} from '../tests/fixtures/markdown/synthetic_markdown_fixtures.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

const INDEPENDENT_TRACKED_PATHS = Object.freeze([
  'tests/fixtures/markdown/synthetic_markdown_fixtures.ts',
  'tests/fixtures/markdown/frozen_markdown_oracles.ts',
  'tools/markdown_contract_oracles.test.ts',
  'tools/markdown_fixture_provenance.test.ts',
]);

const ALLOWED_HAN_RUNS = new Set([
  '不是新条目',
  '代码中的编号',
  '列表中的编号',
  '列表标题',
  '副标题',
  '合成',
  '合成任务标记',
  '合成删除线',
  '合成前言',
  '合成周报',
  '合成块',
  '合成导航内容',
  '合成嵌套项',
  '合成引用',
  '合成无编号内容',
  '合成有序项',
  '合成条目丁',
  '合成条目丙',
  '合成条目乙',
  '合成条目甲',
  '合成标题',
  '合成段落',
  '合成深度标题',
  '合成甲',
  '合成自定义内容',
  '合成乙',
  '合成封面',
  '合成图片',
  '合成引用',
  '图片',
  '封面图',
  '工具',
  '引用中的编号',
  '引用内标题',
  '引用标题',
  '往年回顾',
  '未闭合',
  '末行',
  '正文内部',
  '段落',
  '科技动态',
  '自定义栏目',
  '转义标签',
  '链接',
  '内联',
]);

function repositoryPath(path: string): string {
  return resolve(repositoryRoot, ...path.split('/'));
}

function readRepositoryBytes(path: string): Uint8Array {
  return readFileSync(repositoryPath(path));
}

function readRepositoryText(path: string): string {
  return new TextDecoder('utf-8', {fatal: true}).decode(
    readRepositoryBytes(path),
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function extractTextualHosts(text: string): readonly string[] {
  const hosts: string[] = [];
  for (const match of text.matchAll(/\b(?:https?|file):\/\/([^\s/)\]]+)/giu)) {
    const authority = match[1];
    if (authority === undefined) {
      throw new TypeError('Synthetic URI authority capture is missing.');
    }
    const hostAndPort = authority.includes('@')
      ? authority.slice(authority.lastIndexOf('@') + 1)
      : authority;
    const host = hostAndPort.split(':')[0];
    if (host === undefined) {
      throw new TypeError('Synthetic URI host capture is missing.');
    }
    hosts.push(host.toLowerCase());
  }
  for (const match of text.matchAll(/\bmailto:[^@\s]+@([A-Za-z0-9.-]+)/giu)) {
    const host = match[1];
    if (host === undefined) {
      throw new TypeError('Synthetic mail host capture is missing.');
    }
    hosts.push(host.toLowerCase());
  }
  return hosts;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

describe('synthetic Markdown fixture provenance', () => {
  it('allows only the frozen synthetic Han vocabulary and no private material', () => {
    const corpus = ALL_STATIC_SYNTHETIC_TEXTS.join('\n');
    const actualHanRuns = new Set(corpus.match(/\p{Script=Han}+/gu) ?? []);

    expect(actualHanRuns).toEqual(ALLOWED_HAN_RUNS);
    expect(corpus).not.toMatch(/ruanyf|github\.com\/[^\s]*weekly/iu);
    expect(corpus).not.toMatch(/\.agents[\\/]stage-0/iu);
    expect(corpus).not.toMatch(/-----BEGIN [^-\r\n]*PRIVATE KEY-----/u);
    expect(corpus).not.toMatch(
      /(?:^|[\r\n])\s*(?:API_KEY|ACCESS_TOKEN|PASSWORD|CLIENT_SECRET)\s*=/iu,
    );
    expect(corpus).not.toMatch(/\b[A-Za-z]:[\\/]/u);
    expect(corpus).not.toMatch(/(?:^|\s)\\\\[^\s]+/u);
    expect(corpus).not.toMatch(/\/(?:home|Users)\/[^\s/]+/u);
  });

  it('uses only reserved example.invalid hosts and synthetic userinfo', () => {
    const corpus = ALL_STATIC_SYNTHETIC_TEXTS.join('\n');
    const hosts = extractTextualHosts(corpus);

    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host).toMatch(/(?:^|\.)example\.invalid$/u);
    }
    for (const match of corpus.matchAll(
      /\bhttps?:\/\/([^:@/\s]+):([^@/\s]+)@/giu,
    )) {
      expect(match[1]).toBe('synthetic');
      expect(match[2]).toBe('synthetic');
    }
  });

  it('keeps generated at/over boundary fixtures synthetic and bounded', () => {
    const generatedText = [
      createNodeBudgetMarkdown(MARKDOWN_BUDGET_LIMITS.nodes + 1),
      createFragmentBudgetMarkdown(MARKDOWN_BUDGET_LIMITS.fragments + 1),
      createLinkBudgetMarkdown(MARKDOWN_BUDGET_LIMITS.links + 1),
      createMediaBudgetMarkdown(MARKDOWN_BUDGET_LIMITS.media + 1),
      createDiagnosticBudgetMarkdown(MARKDOWN_BUDGET_LIMITS.diagnostics + 1),
      createDepthBudgetMarkdown(MARKDOWN_BUDGET_LIMITS.depth + 1, 'paragraph'),
      createDepthBudgetMarkdown(MARKDOWN_BUDGET_LIMITS.depth + 1, 'image'),
    ].join('\n');
    const sourceBytes = createSourceBudgetUtf8(
      MARKDOWN_BUDGET_LIMITS.sourceBytes + 1,
    );

    expect(new Set(sourceBytes)).toEqual(new Set([0x78]));
    expect(generatedText).not.toMatch(/ruanyf|weekly|credential|private/iu);
    expect(generatedText).not.toMatch(/\b[A-Za-z]:[\\/]/u);
    for (const host of extractTextualHosts(generatedText)) {
      expect(host).toMatch(/(?:^|\.)example\.invalid$/u);
    }
  });
});

describe('admitted Markdown parser provenance', () => {
  it('pins the parser-specific license bytes', () => {
    expect(
      sha256(
        readRepositoryBytes(
          'docs/dependencies/licenses/npm/mdast-util-from-markdown@2.0.3/license',
        ),
      ),
    ).toBe(ADMITTED_PARSER_ARTIFACT_ORACLE.licenseSha256);
  });

  it('records the exact runtime version, MIT notice and SBOM tarball identity', () => {
    const serverPackage = JSON.parse(
      readRepositoryText('apps/server/package.json'),
    ) as unknown;
    expect(isRecord(serverPackage)).toBe(true);
    if (!isRecord(serverPackage) || !isRecord(serverPackage.dependencies)) {
      throw new TypeError('Server package dependency shape is invalid.');
    }
    expect(serverPackage.dependencies['mdast-util-from-markdown']).toBe(
      ADMITTED_PARSER_ARTIFACT_ORACLE.version,
    );

    const lock = readRepositoryText('pnpm-lock.yaml');
    expect(lock).toContain(
      `  mdast-util-from-markdown@${ADMITTED_PARSER_ARTIFACT_ORACLE.version}:\n    resolution: {integrity: sha512-${ADMITTED_PARSER_ARTIFACT_ORACLE.lockIntegritySha512}}`,
    );

    const notice = readRepositoryText('THIRD_PARTY_NOTICES.md');
    expect(notice).toContain(
      '| `mdast-util-from-markdown@2.0.3` | runtime | `MIT` | ROUTINE_REVIEW |',
    );
    const license = readRepositoryText(
      'docs/dependencies/licenses/npm/mdast-util-from-markdown@2.0.3/license',
    );
    expect(license).toMatch(/^\(The MIT License\)/u);

    const sbom = JSON.parse(
      readRepositoryText('docs/dependencies/sbom/npm-closure.spdx.json'),
    ) as unknown;
    if (!isRecord(sbom) || !Array.isArray(sbom.packages)) {
      throw new TypeError('SBOM package shape is invalid.');
    }
    const packages = sbom.packages.filter(
      (value): value is Readonly<Record<string, unknown>> =>
        isRecord(value) && value.name === 'mdast-util-from-markdown',
    );
    expect(packages).toHaveLength(1);
    const parserPackage = packages[0];
    if (parserPackage === undefined) {
      throw new RangeError('Admitted parser package is missing from the SBOM.');
    }
    expect(parserPackage.versionInfo).toBe(
      ADMITTED_PARSER_ARTIFACT_ORACLE.version,
    );
    expect(parserPackage.licenseDeclared).toBe(
      ADMITTED_PARSER_ARTIFACT_ORACLE.license,
    );
    expect(parserPackage.downloadLocation).toBe(
      ADMITTED_PARSER_ARTIFACT_ORACLE.downloadLocation,
    );
    expect(parserPackage.externalRefs).toContainEqual(
      expect.objectContaining({
        referenceLocator: ADMITTED_PARSER_ARTIFACT_ORACLE.packageUrl,
      }),
    );
    expect(parserPackage.checksums).toContainEqual({
      algorithm: 'SHA256',
      checksumValue: ADMITTED_PARSER_ARTIFACT_ORACLE.tarballSha256,
    });
  });

  it('keeps all four independent files free of product-module imports', () => {
    for (const path of INDEPENDENT_TRACKED_PATHS) {
      const source = readRepositoryText(path);
      expect(source).not.toMatch(
        /from ['"][^'"]*(?:apps\/server|modules\/evidence)/u,
      );
      expect(source).not.toMatch(
        /from ['"][^'"]*markdown_(?:parser|material)/u,
      );
    }
  });
});
