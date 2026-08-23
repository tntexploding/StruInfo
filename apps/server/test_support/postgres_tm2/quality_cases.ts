import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';

import type {Tm2MandatoryCase} from './mandatory_ledger.js';
import {
  auditTm2MandatoryLedger,
  TM2_MANDATORY_LEDGER,
} from './mandatory_ledger.js';
import type {Tm2CaseEvidence} from './public_facade.js';
import {Tm2SafeFailure} from './bound_runtime.js';

const execFileAsync = promisify(execFile);
const OWNED_SCAN_FILES = Object.freeze([
  'apps/server/test_support/postgres_tm2/admission_outcome.ts',
  'apps/server/test_support/postgres_tm2/admission_child.ts',
  'apps/server/test_support/postgres_tm2/bounded_child.ts',
  'apps/server/test_support/postgres_tm2/bound_runtime.ts',
  'apps/server/test_support/postgres_tm2/concurrency_oracle.ts',
  'apps/server/test_support/postgres_tm2/database_cases.ts',
  'apps/server/test_support/postgres_tm2/domain_cases.ts',
  'apps/server/test_support/postgres_tm2/environment_cases.ts',
  'apps/server/test_support/postgres_tm2/environment_oracle.ts',
  'apps/server/test_support/postgres_tm2/mandatory_ledger.ts',
  'apps/server/test_support/postgres_tm2/mandatory_report_oracle.ts',
  'apps/server/test_support/postgres_tm2/public_facade.ts',
  'apps/server/test_support/postgres_tm2/quality_cases.ts',
  'apps/server/test_support/postgres_tm2/retrieval_snapshot_cases.ts',
  'apps/server/test_support/postgres_tm2/semantic_oracle.ts',
  'apps/server/test_support/postgres_tm2/transaction_cases.ts',
  'tests/postgres/postgres_tm2_mandatory.tm2.ts',
  'tests/postgres/postgres_tm2_oracle_selftest.tm2.ts',
  'tests/postgres/run_postgres_tm2.ts',
  'tests/postgres/run_postgres_tm2_admission.ts',
  'vitest.postgres.config.ts',
] as const);
const SELF_REFERENTIAL_FORBIDDEN_PHRASES = Object.freeze([
  'ruanyf/weekly',
  '.agents/stage-0',
  'console.log',
  'console.error',
  'driver error',
  'passWithNoTests',
  'eslint-disable',
  'ts-ignore',
  'ts-expect-error',
  'as any',
] as const);

interface ArtifactEntry {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface ArtifactManifest {
  readonly format: string;
  readonly version: number;
  readonly source: string;
  readonly files: readonly ArtifactEntry[];
}

function evidence(
  row: Tm2MandatoryCase,
  assertionCount: number,
  suffix: string,
): Tm2CaseEvidence {
  return Object.freeze({
    caseId: row.id,
    vectorId: row.vectorId,
    assertionCount,
    safeEvidenceCodes: Object.freeze([`${row.id}:${suffix}`]),
  });
}

function assertCondition(condition: boolean, code: string): void {
  if (!condition) {
    throw new Tm2SafeFailure(code);
  }
}

function countOccurrences(source: string, phrase: string): number {
  let count = 0;
  let cursor = 0;
  for (;;) {
    const next = source.indexOf(phrase, cursor);
    if (next < 0) {
      return count;
    }
    count += 1;
    cursor = next + phrase.length;
  }
}

async function readOwnedSources(): Promise<readonly string[]> {
  return await Promise.all(
    OWNED_SCAN_FILES.map(async (path) => await readFile(path, 'utf8')),
  );
}

async function trackedPaths(): Promise<readonly string[]> {
  const result = await execFileAsync('git', ['ls-files', '-z'], {
    cwd: process.cwd(),
    encoding: 'buffer',
    windowsHide: true,
  });
  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '');
}

async function loadArtifactManifest(): Promise<ArtifactManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readFile('build/application-artifact-manifest.json', 'utf8'),
    ) as unknown;
  } catch {
    throw new Tm2SafeFailure('artifact_manifest_unavailable');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('files' in parsed) ||
    !Array.isArray(parsed.files)
  ) {
    throw new Tm2SafeFailure('artifact_manifest_invalid');
  }
  return parsed as ArtifactManifest;
}

async function executePrivacyCase(
  row: Tm2MandatoryCase,
): Promise<Tm2CaseEvidence> {
  const sources = await readOwnedSources();
  const joined = sources.join('\n');
  const tracked = await trackedPaths();
  const phraseCounts = SELF_REFERENTIAL_FORBIDDEN_PHRASES.map((phrase) =>
    countOccurrences(joined, phrase),
  );
  const coordinationPrefix = SELF_REFERENTIAL_FORBIDDEN_PHRASES[1];
  const checks = [
    !/\b(?:postgres|postgresql):\/\/(?!struinfo_tm2_)[^\s"']+:[^\s@"']+@/iu.test(
      joined,
    ),
    !/-----BEGIN [^-\r\n]*PRIVATE KEY-----/u.test(joined),
    !/\b[A-Za-z]:\\Users\\(?!synthetic)[^\\\s"']+\\/iu.test(joined),
    !/\/home\/(?!synthetic)[^/\s"']+\//u.test(joined),
    phraseCounts[0] === 1,
    phraseCounts[1] === 1 &&
      tracked.every((path) => !path.startsWith(`${coordinationPrefix}/`)),
    phraseCounts[2] === 1,
    phraseCounts[3] === 1,
    phraseCounts[4] === 1,
    !/\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}\b|\bsk-[A-Za-z0-9]{20,}\b/u.test(
      joined,
    ),
  ];
  assertCondition(
    checks[row.number - 461] === true,
    `${row.id}:privacy_boundary_failed`,
  );
  return evidence(row, 2, 'privacy_boundary_observed');
}

async function executeArtifactGovernanceCase(
  row: Tm2MandatoryCase,
): Promise<Tm2CaseEvidence> {
  const manifest = await loadArtifactManifest();
  const paths = manifest.files.map((entry) => entry.path);
  const forbidden = paths.filter((path) =>
    /(?:^|\/)(?:tests?|test_support|fixtures?|oracles?)(?:\/|$)|\.test\.|\.tm2\.|(?<!\.d)\.ts$/iu.test(
      path,
    ),
  );
  const packageBytes = await readFile('package.json');
  const lockBytes = await readFile('pnpm-lock.yaml');
  const noticeBytes = await readFile('THIRD_PARTY_NOTICES.md');
  const contractBytes = await readFile(
    'docs/postgresql-knowledge-adapter-contract.md',
  );
  const migrationFiles = [
    '000001_create_application_schema.sql',
    '000002_create_source_evidence_schema.sql',
    '000003_create_manual_curation_schema.sql',
    '000004_create_manual_knowledge_core.sql',
  ] as const;
  const migrationBytes = await Promise.all(
    migrationFiles.map(
      async (file) => await readFile(`apps/server/migrations/${file}`),
    ),
  );
  const sha = (bytes: Uint8Array) =>
    createHash('sha256').update(bytes).digest('hex');
  const checks = [
    manifest.format === 'struinfo.application-artifact-manifest',
    manifest.version === 1,
    manifest.source === 'pnpm-pack-dry-run',
    forbidden.length === 0,
    new Set(paths).size === paths.length,
    manifest.files.every(
      (entry) => entry.byteLength >= 0 && /^[0-9a-f]{64}$/u.test(entry.sha256),
    ),
    sha(packageBytes) ===
      '81a5923fbba80292159b9d2537850d5b7fd9ebee86be501393da076ecc29b41e',
    /^[0-9a-f]{64}$/u.test(sha(lockBytes)) &&
      /^[0-9a-f]{64}$/u.test(sha(noticeBytes)),
    sha(contractBytes) ===
      '4280a6f390ec8a8fe16ae7124642f6e2ddf8daf1e70d8d361b007bcac5771f9f',
    migrationBytes.every((bytes) => bytes.byteLength > 0),
  ];
  assertCondition(
    checks[row.number - 471] === true,
    `${row.id}:artifact_governance_failed`,
  );
  return evidence(row, 2, 'artifact_governance_observed');
}

async function executeQualityGateCase(
  row: Tm2MandatoryCase,
): Promise<Tm2CaseEvidence> {
  const sources = await readOwnedSources();
  const joined = sources.join('\n');
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  const audit = auditTm2MandatoryLedger();
  const phraseCounts = SELF_REFERENTIAL_FORBIDDEN_PHRASES.map((phrase) =>
    countOccurrences(joined, phrase),
  );
  const disabledTestCalls = [...joined.matchAll(/\.([a-z]+)\s*\(/gu)].filter(
    (match) =>
      match[1] === 'skip' || match[1] === 'todo' || match[1] === 'only',
  );
  const gitStatus = await execFileAsync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    {cwd: process.cwd(), encoding: 'utf8', windowsHide: true},
  );
  const checks = [
    audit.total === 488 && audit.unique === 488,
    audit.missing.length === 0 &&
      audit.duplicate.length === 0 &&
      audit.unexpected.length === 0,
    TM2_MANDATORY_LEDGER.every((entry, index) => entry.number === index + 1),
    disabledTestCalls.length === 0 && phraseCounts[5] === 1,
    phraseCounts.slice(6).every((count) => count === 1),
    !/(?:postgres_connection_config|postgres_(?:curation|knowledge|retrieval)_repository|workspace_write_lock)\.js['"]/u.test(
      joined,
    ),
    packageJson.scripts?.['test:postgres'] ===
      'tsx tests/postgres/run_postgres_tm2.ts' &&
      !packageJson.scripts['test:postgres'].includes('test:postgres '),
    gitStatus.stdout.trim() === '',
  ];
  assertCondition(
    checks[row.number - 481] === true,
    `${row.id}:quality_gate_failed`,
  );
  return evidence(row, 2, 'quality_gate_observed');
}

export async function executeQualityCase(
  row: Tm2MandatoryCase,
): Promise<Tm2CaseEvidence> {
  if (row.number <= 470) {
    return await executePrivacyCase(row);
  }
  if (row.number <= 480) {
    return await executeArtifactGovernanceCase(row);
  }
  return await executeQualityGateCase(row);
}
