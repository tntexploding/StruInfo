import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
  CURATION_BACKEND_CANDIDATE_PATHS,
  CURATION_BACKEND_ENTRY_HASHES,
  CURATION_DEPENDENCY_ORACLE,
  CURATION_TEST_OWNED_PATHS,
} from '../tests/fixtures/curation/frozen_curation_oracles.js';
import {
  ALL_STATIC_SYNTHETIC_CURATION_TEXT,
  CURATION_SYNTHETIC_IDS,
  F_CUR_PROVENANCE,
} from '../tests/fixtures/curation/synthetic_curation_fixtures.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const allowedExternalImports = new Set([
  'node:crypto',
  'node:fs',
  'node:path',
  'node:url',
  'vitest',
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new TypeError(`${label} must be a string array.`);
  }
  return value;
}

function requiredPath(paths: readonly string[], index: number): string {
  const path = paths[index];
  if (path === undefined) {
    throw new RangeError(`Required path at index ${String(index)} is missing.`);
  }
  return path;
}

function extractModuleSpecifiers(source: string): readonly string[] {
  const modules: string[] = [];
  const pattern =
    /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const match of source.matchAll(pattern)) {
    const moduleSpecifier = match[1] ?? match[2];
    if (moduleSpecifier === undefined) {
      throw new TypeError('Import module capture is missing.');
    }
    modules.push(moduleSpecifier);
  }
  return modules;
}

function extractTextualHosts(text: string): readonly string[] {
  const hosts: string[] = [];
  for (const match of text.matchAll(/\bhttps?:\/\/([^\s/)\]]+)/giu)) {
    const authorityAndPath = match[1];
    if (authorityAndPath === undefined) {
      throw new TypeError('Synthetic URI authority capture is missing.');
    }
    const authority = authorityAndPath.split('/')[0];
    if (authority === undefined) {
      throw new TypeError('Synthetic URI authority is missing.');
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

describe('manual-curation independent fixture provenance', () => {
  it('contains only synthetic, value-free fixture text and reserved hosts', () => {
    const corpus = ALL_STATIC_SYNTHETIC_CURATION_TEXT.join('\n');
    const hosts = extractTextualHosts(corpus);

    expect(F_CUR_PROVENANCE).toEqual([
      'synthetic-label',
      'synthetic-description',
      'synthetic-note',
      '合成分类😀é',
      'synthetic-resource-key',
      'https://fixture.example.invalid/synthetic-item',
    ]);
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host).toMatch(/(?:^|\.)example\.invalid$/u);
    }
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

  it('uses only fixed synthetic identifiers and no opaque external workspace data', () => {
    const ids = Object.values(CURATION_SYNTHETIC_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
      );
      expect(id).not.toMatch(/[A-F]/u);
    }
  });

  it('keeps independent expected values out of Backend private helpers', () => {
    const fixtureSource = readRepositoryText(
      requiredPath(CURATION_TEST_OWNED_PATHS, 0),
    );
    const oracleSource = readRepositoryText(
      requiredPath(CURATION_TEST_OWNED_PATHS, 1),
    );
    const contractTestSource = readRepositoryText(
      requiredPath(CURATION_TEST_OWNED_PATHS, 2),
    );
    const provenanceTestSource = readRepositoryText(
      requiredPath(CURATION_TEST_OWNED_PATHS, 3),
    );
    const allSources = [
      fixtureSource,
      oracleSource,
      contractTestSource,
      provenanceTestSource,
    ];

    for (const moduleSpecifier of extractModuleSpecifiers(fixtureSource)) {
      expect(moduleSpecifier).not.toMatch(/apps\/server|modules\/curation/u);
    }
    for (const moduleSpecifier of extractModuleSpecifiers(oracleSource)) {
      expect(moduleSpecifier).not.toMatch(/apps\/server|modules\/curation/u);
    }
    expect(contractTestSource).toMatch(
      /from ['"]\.\.\/apps\/server\/src\/modules\/curation\/index\.js['"]/u,
    );
    expect(contractTestSource).not.toMatch(
      /from ['"][^'"]*(?:manual_curation_identity|closed_manual_curation_input|manual_curation_sql_lexical)['"]/u,
    );
    expect(contractTestSource).not.toMatch(
      /from ['"][^'"]*(?:manual_curation_contract|manual_curation_repository|manual_curation\.js)['"]/u,
    );
    expect(contractTestSource).not.toMatch(
      /\b(?:analyzeManualCurationDdl|tokenizeManualCurationSql|foreignKeyFingerprint|checkFingerprint|predicateFingerprint|REQUIRED_COLUMNS|REQUIRED_FOREIGN_KEYS|REQUIRED_UNIQUE_KEYS|MATERIAL_CHECKS)\b/u,
    );
    for (const source of allSources) {
      expect(source).not.toMatch(/\.agents[\\/]stage-0/iu);
    }
  });

  it('introduces no unadmitted package import or dependency/lockfile delta', () => {
    const packageBytes = readRepositoryBytes('package.json');
    const serverPackageBytes = readRepositoryBytes('apps/server/package.json');
    const lockfileBytes = readRepositoryBytes('pnpm-lock.yaml');

    expect(sha256(packageBytes)).toBe(CURATION_DEPENDENCY_ORACLE.packageSha256);
    expect(sha256(serverPackageBytes)).toBe(
      CURATION_DEPENDENCY_ORACLE.serverPackageSha256,
    );
    expect(sha256(lockfileBytes)).toBe(
      CURATION_DEPENDENCY_ORACLE.lockfileSha256,
    );
    expect(CURATION_DEPENDENCY_ORACLE.productionDependencyDelta).toBe(0);
    expect(CURATION_DEPENDENCY_ORACLE.developmentDependencyDelta).toBe(0);

    for (const path of CURATION_TEST_OWNED_PATHS) {
      for (const moduleSpecifier of extractModuleSpecifiers(
        readRepositoryText(path),
      )) {
        if (
          !moduleSpecifier.startsWith('.') &&
          !allowedExternalImports.has(moduleSpecifier)
        ) {
          throw new TypeError(
            `Unadmitted external import in ${path}: ${moduleSpecifier}`,
          );
        }
      }
    }
  });
});

describe('manual-curation candidate provenance and application boundary', () => {
  it('pins all ten reconciled Backend candidate files', () => {
    expect(CURATION_BACKEND_CANDIDATE_PATHS).toHaveLength(10);
    expect(Object.keys(CURATION_BACKEND_ENTRY_HASHES).sort()).toEqual(
      [...CURATION_BACKEND_CANDIDATE_PATHS].sort(),
    );
    const reconciledEntries = Object.entries(CURATION_BACKEND_ENTRY_HASHES);
    expect(reconciledEntries).toHaveLength(10);
    for (const [path, expectedHash] of reconciledEntries) {
      expect(sha256(readRepositoryBytes(path)), path).toBe(expectedHash);
    }
  });

  it('finds no credential, personal path, Stage-0, or real-source payload in bounded candidate files', () => {
    const candidateCorpus = CURATION_BACKEND_CANDIDATE_PATHS.map((path) =>
      readRepositoryText(path),
    ).join('\n');

    expect(candidateCorpus).not.toMatch(/\.agents[\\/]stage-0/iu);
    expect(candidateCorpus).not.toMatch(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----/u,
    );
    expect(candidateCorpus).not.toMatch(/\bAKIA[0-9A-Z]{16}\b/u);
    expect(candidateCorpus).not.toMatch(/\bgh[opusr]_[A-Za-z0-9]{20,}\b/u);
    expect(candidateCorpus).not.toMatch(/\b[A-Za-z]:\\Users\\[^\s'"`]+/u);
    expect(candidateCorpus).not.toMatch(/\/(?:home|Users)\/[^\s/'"`]+/u);
    expect(candidateCorpus).not.toMatch(/ruanyf|github\.com\/[^\s]*weekly/iu);
  });

  it('keeps package inputs closed against tests, fixtures, test support, and TypeScript sources', () => {
    const rootPackage = JSON.parse(
      readRepositoryText('package.json'),
    ) as unknown;
    if (!isRecord(rootPackage)) {
      throw new TypeError('Root package manifest must be an object.');
    }
    const files = stringArray(rootPackage.files, 'package.json files');

    expect(files).toEqual([
      'apps/server/dist',
      'apps/server/migrations',
      'apps/server/package.json',
      'apps/web/dist',
      'apps/web/package.json',
      'packages/contracts/json-schema',
      'packages/contracts/openapi',
      'packages/contracts/package.json',
      'THIRD_PARTY_NOTICES.md',
      'docs/dependencies/licenses/npm',
      'docs/dependencies/licenses/npm-source',
      'docs/dependencies/sbom/npm-closure.spdx.json',
    ]);
    for (const path of files) {
      expect(path).not.toMatch(
        /(?:^|\/)(?:tests?|test_support|tools)(?:\/|$)/u,
      );
      expect(path).not.toMatch(/\.(?:test|spec)\.[cm]?[jt]sx?$/u);
      expect(path).not.toMatch(/\.ts$/u);
    }
  });
});
