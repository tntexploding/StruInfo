import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {materializeExternalSecretEnvironment} from './external_secret_environment.js';
import {ConfigurationError} from './runtime_config.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, {force: true, recursive: true});
});

describe('materializeExternalSecretEnvironment', () => {
  it('projects mounted secrets without retaining their file variables', () => {
    const root = createRoot();
    const databaseFile = join(root, 'database-url');
    const openAiFile = join(root, 'openai-key');
    writeFileSync(
      databaseFile,
      'postgresql://struinfo_tm2_runtime:synthetic@localhost/struinfo\n',
      {mode: 0o600},
    );
    writeFileSync(openAiFile, 'synthetic-key\r\n', {mode: 0o600});

    const result = materializeExternalSecretEnvironment({
      DATABASE_URL_FILE: databaseFile,
      OPENAI_API_KEY_FILE: openAiFile,
      STRUIINFO_CONFIG_PATH: 'synthetic-config',
    });

    expect(result).toMatchObject({
      DATABASE_URL:
        'postgresql://struinfo_tm2_runtime:synthetic@localhost/struinfo',
      OPENAI_API_KEY: 'synthetic-key',
      STRUIINFO_CONFIG_PATH: 'synthetic-config',
    });
    expect(result).not.toHaveProperty('DATABASE_URL_FILE');
    expect(result).not.toHaveProperty('OPENAI_API_KEY_FILE');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('keeps direct secret values when no file form is supplied', () => {
    const result = materializeExternalSecretEnvironment({
      DATABASE_URL: 'synthetic-direct-value',
    });
    expect(result.DATABASE_URL).toBe('synthetic-direct-value');
  });

  it('rejects ambiguous, multiline, empty, invalid UTF-8 and oversized files', () => {
    const root = createRoot();
    const cases = [
      ['multiline', 'first\nsecond'],
      ['empty', ''],
      ['nul', 'first\u0000second'],
      ['oversized', 'x'.repeat(16 * 1024 + 1)],
    ] as const;
    for (const [name, value] of cases) {
      const path = join(root, name);
      writeFileSync(path, value);
      expect(() =>
        materializeExternalSecretEnvironment({DATABASE_URL_FILE: path}),
      ).toThrow(ConfigurationError);
    }
    const invalidUtf8 = join(root, 'invalid-utf8');
    writeFileSync(invalidUtf8, Uint8Array.of(0xc3, 0x28));
    expect(() =>
      materializeExternalSecretEnvironment({
        STRUIINFO_MIGRATION_DATABASE_URL_FILE: invalidUtf8,
      }),
    ).toThrow(ConfigurationError);

    const valid = join(root, 'valid');
    writeFileSync(valid, 'synthetic');
    expect(() =>
      materializeExternalSecretEnvironment({
        DATABASE_URL: 'direct',
        DATABASE_URL_FILE: valid,
      }),
    ).toThrow(/cannot both be supplied/u);
  });

  it('does not expose a secret value through validation failures', () => {
    const root = createRoot();
    const path = join(root, 'secret');
    const secret = 'synthetic-private-value';
    writeFileSync(path, `${secret}\nsecond`);
    let error: unknown;
    try {
      materializeExternalSecretEnvironment({DATABASE_URL_FILE: path});
    } catch (candidate) {
      error = candidate;
    }
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain(path);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'struinfo-m1m-secrets-'));
  roots.push(root);
  return root;
}
