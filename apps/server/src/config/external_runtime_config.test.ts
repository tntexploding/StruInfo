import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, parse} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it} from 'vitest';

import {
  loadRuntimeConfig,
  RUNTIME_CONFIG_PATH_VARIABLE,
} from './external_runtime_config.js';
import {ConfigurationError} from './runtime_config.js';

const DATABASE_URL =
  'postgresql://struinfo_tm2_runtime:synthetic@127.0.0.1/struinfo';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const temporaryRoots: string[] = [];

interface RuntimeFixture {
  readonly root: string;
  readonly configDirectory: string;
  readonly configPath: string;
  readonly dataRoot: string;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0).reverse()) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('loadRuntimeConfig', () => {
  it('loads a closed external file, applies environment overrides, and canonicalizes the data root', () => {
    const fixture = createRuntimeFixture();
    writeRuntimeConfig(fixture.configPath, fixture.dataRoot, [
      'STRUIINFO_PORT=3100',
      'STRUIINFO_LOG_LEVEL=warn',
    ]);

    const config = loadRuntimeConfig('api', {
      DATABASE_URL,
      STRUIINFO_CONFIG_PATH: fixture.configPath,
      STRUIINFO_PORT: '3200',
    });

    expect(config).toMatchObject({
      role: 'api',
      database: {
        host: '127.0.0.1',
        database: 'struinfo',
        user: 'struinfo_tm2_runtime',
      },
      workspaceId: WORKSPACE_ID,
      dataRoot: realpathSync(fixture.dataRoot),
      port: 3200,
      logLevel: 'warn',
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('reopens two external workspaces without changing application code or mixing data roots', () => {
    const first = createRuntimeFixture();
    const second = createRuntimeFixture();
    writeRuntimeConfig(first.configPath, first.dataRoot, [], WORKSPACE_ID);
    writeRuntimeConfig(
      second.configPath,
      second.dataRoot,
      [],
      SECOND_WORKSPACE_ID,
    );

    const firstConfig = loadRuntimeConfig('api', runtimeEnvironment(first));
    const secondConfig = loadRuntimeConfig('api', runtimeEnvironment(second));
    const reopenedFirst = loadRuntimeConfig('api', runtimeEnvironment(first));

    expect(firstConfig).toMatchObject({
      workspaceId: WORKSPACE_ID,
      dataRoot: realpathSync(first.dataRoot),
    });
    expect(secondConfig).toMatchObject({
      workspaceId: SECOND_WORKSPACE_ID,
      dataRoot: realpathSync(second.dataRoot),
    });
    expect(reopenedFirst).toMatchObject({
      workspaceId: WORKSPACE_ID,
      dataRoot: realpathSync(first.dataRoot),
    });
    expect(firstConfig.dataRoot).not.toBe(secondConfig.dataRoot);
    expect(firstConfig.workspaceId).not.toBe(secondConfig.workspaceId);
  });

  it('loads the model from the external file and the OpenAI secret only from environment', () => {
    const fixture = createRuntimeFixture();
    writeRuntimeConfig(fixture.configPath, fixture.dataRoot, [
      'STRUIINFO_OPENAI_MODEL=gpt-5-mini',
    ]);

    const config = loadRuntimeConfig('api', {
      ...runtimeEnvironment(fixture),
      OPENAI_API_KEY: 'synthetic-openai-key',
    });

    expect(config.aiProposalProvider).toMatchObject({
      providerKey: 'openai-responses-v1',
      model: 'gpt-5-mini',
      apiKey: 'synthetic-openai-key',
    });
  });

  it('requires an absolute external configuration file path', () => {
    expect(() => loadRuntimeConfig('api', {DATABASE_URL})).toThrow(
      `${RUNTIME_CONFIG_PATH_VARIABLE} is required.`,
    );
    expect(() =>
      loadRuntimeConfig('api', {
        DATABASE_URL,
        STRUIINFO_CONFIG_PATH: 'runtime.env',
      }),
    ).toThrow(
      `${RUNTIME_CONFIG_PATH_VARIABLE} must be an absolute filesystem path.`,
    );
  });

  it.each([
    ['DATABASE_URL', 'database-secret-in-file'],
    ['STRUIINFO_MIGRATION_DATABASE_URL', 'migration-secret-in-file'],
    ['OPENAI_API_KEY', 'openai-secret-in-file'],
    ['STRUIINFO_CONFIG_PATH', 'recursive-path-in-file'],
  ])(
    'rejects environment-only key %s without echoing its value',
    (key, value) => {
      const fixture = createRuntimeFixture();
      writeRuntimeConfig(fixture.configPath, fixture.dataRoot, [
        `${key}=${value}`,
      ]);

      const error = captureConfigurationError(() =>
        loadRuntimeConfig('api', runtimeEnvironment(fixture)),
      );

      expect(error.message).toContain(key);
      expect(error.message).not.toContain(value);
    },
  );

  it('rejects unknown file keys without revealing their names or values', () => {
    const fixture = createRuntimeFixture();
    const unknownKey = 'PRIVATE_TOPIC_NAME';
    const privateValue = 'synthetic-private-value';
    writeRuntimeConfig(fixture.configPath, fixture.dataRoot, [
      `${unknownKey}=${privateValue}`,
    ]);

    const error = captureConfigurationError(() =>
      loadRuntimeConfig('api', runtimeEnvironment(fixture)),
    );

    expect(error.message).toBe(
      'External runtime configuration contains an unsupported key.',
    );
    expect(error.message).not.toContain(unknownKey);
    expect(error.message).not.toContain(privateValue);
  });

  it('rejects a configuration file inside a protected application tree', () => {
    const fixture = createRuntimeFixture();
    writeRuntimeConfig(fixture.configPath, fixture.dataRoot);

    expect(() =>
      loadRuntimeConfig('api', runtimeEnvironment(fixture), {
        additionalProtectedRoots: [fixture.configDirectory],
      }),
    ).toThrow(
      'External runtime configuration must be outside the source, Git, and installed application directories.',
    );
  });

  it('discovers and protects the repository without injected test roots', () => {
    const repositoryPackage = fileURLToPath(
      new URL('../../../../package.json', import.meta.url),
    );

    expect(() =>
      loadRuntimeConfig('api', {
        DATABASE_URL,
        STRUIINFO_CONFIG_PATH: repositoryPackage,
      }),
    ).toThrow(
      'External runtime configuration must be outside the source, Git, and installed application directories.',
    );
  });

  it('rejects a data root inside a protected application tree', () => {
    const fixture = createRuntimeFixture();
    writeRuntimeConfig(fixture.configPath, fixture.dataRoot);

    expect(() =>
      loadRuntimeConfig('api', runtimeEnvironment(fixture), {
        additionalProtectedRoots: [fixture.dataRoot],
      }),
    ).toThrow(
      'STRUIINFO_DATA_ROOT must be outside the source, Git, and installed application directories.',
    );
  });

  it('rejects a link whose canonical data root escapes into a protected tree', () => {
    const fixture = createRuntimeFixture();
    const protectedRoot = join(fixture.root, 'protected-application');
    const protectedData = join(protectedRoot, 'private-data');
    const linkedData = join(fixture.root, 'linked-data');
    mkdirSync(protectedData, {recursive: true});
    symlinkSync(
      protectedData,
      linkedData,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    writeRuntimeConfig(fixture.configPath, linkedData);

    expect(() =>
      loadRuntimeConfig('api', runtimeEnvironment(fixture), {
        additionalProtectedRoots: [protectedRoot],
      }),
    ).toThrow(
      'STRUIINFO_DATA_ROOT must be outside the source, Git, and installed application directories.',
    );
  });

  it('keeps a data root out of the configuration directory tree', () => {
    const fixture = createRuntimeFixture();
    const nestedDataRoot = join(fixture.configDirectory, 'data');
    mkdirSync(nestedDataRoot);
    writeRuntimeConfig(fixture.configPath, nestedDataRoot);

    expect(() => loadRuntimeConfig('api', runtimeEnvironment(fixture))).toThrow(
      'External runtime configuration and STRUIINFO_DATA_ROOT must use separate directory trees.',
    );
  });

  it('keeps the configuration file out of the data-root tree', () => {
    const fixture = createRuntimeFixture();
    const nestedConfigDirectory = join(fixture.dataRoot, 'config');
    const nestedConfigPath = join(nestedConfigDirectory, 'runtime.env');
    mkdirSync(nestedConfigDirectory);
    writeRuntimeConfig(nestedConfigPath, fixture.dataRoot);

    expect(() =>
      loadRuntimeConfig('api', {
        DATABASE_URL,
        STRUIINFO_CONFIG_PATH: nestedConfigPath,
      }),
    ).toThrow(
      'External runtime configuration and STRUIINFO_DATA_ROOT must use separate directory trees.',
    );
  });

  it('rejects a filesystem root as the data root', () => {
    const fixture = createRuntimeFixture();
    writeRuntimeConfig(fixture.configPath, parse(fixture.root).root);

    expect(() => loadRuntimeConfig('api', runtimeEnvironment(fixture))).toThrow(
      'STRUIINFO_DATA_ROOT cannot be a filesystem root.',
    );
  });

  it('rejects invalid UTF-8 and oversized configuration without echoing content', () => {
    const invalidFixture = createRuntimeFixture();
    writeFileSync(invalidFixture.configPath, Buffer.from([0xc3, 0x28]));

    expect(() =>
      loadRuntimeConfig('api', runtimeEnvironment(invalidFixture)),
    ).toThrow('External runtime configuration must be valid UTF-8.');

    const oversizedFixture = createRuntimeFixture();
    writeFileSync(
      oversizedFixture.configPath,
      Buffer.alloc(64 * 1024 + 1, 0x61),
    );

    expect(() =>
      loadRuntimeConfig('api', runtimeEnvironment(oversizedFixture)),
    ).toThrow('External runtime configuration exceeds the 64 KiB size limit.');
  });
});

function createRuntimeFixture(): RuntimeFixture {
  const root = mkdtempSync(join(tmpdir(), 'struinfo-runtime-config-'));
  temporaryRoots.push(root);
  const configDirectory = join(root, 'config');
  const dataRoot = join(root, 'data');
  mkdirSync(configDirectory);
  mkdirSync(dataRoot);
  return {
    root,
    configDirectory,
    configPath: join(configDirectory, 'runtime.env'),
    dataRoot,
  };
}

function writeRuntimeConfig(
  configPath: string,
  dataRoot: string,
  additionalLines: readonly string[] = [],
  workspaceId: string = WORKSPACE_ID,
): void {
  const portableDataRoot = dataRoot.replaceAll('\\', '/');
  writeFileSync(
    configPath,
    [
      `STRUIINFO_DATA_ROOT=${JSON.stringify(portableDataRoot)}`,
      `STRUIINFO_WORKSPACE_ID=${workspaceId}`,
      ...additionalLines,
      '',
    ].join('\n'),
    {encoding: 'utf8'},
  );
}

function runtimeEnvironment(
  fixture: RuntimeFixture,
): Readonly<Record<string, string>> {
  return {
    DATABASE_URL,
    STRUIINFO_CONFIG_PATH: fixture.configPath,
  };
}

function captureConfigurationError(
  operation: () => unknown,
): ConfigurationError {
  try {
    operation();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected external configuration loading to fail.');
}
