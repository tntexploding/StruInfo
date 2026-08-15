import {isIP} from 'node:net';

import {describe, expect, it, vi} from 'vitest';

import {
  classifyTm2HarnessOutcome,
  decodeTm2AdmissionChannel,
  runTm2AdmissionPreflight,
  Tm2AdmissionProbeError,
  type Tm2AdmissionDependencies,
  type Tm2AdmissionEnvironmentObservation,
} from '../../apps/server/test_support/postgres_tm2/admission_outcome.js';
import {
  admitTm2Environment,
  auditClosedPgConfig,
  createPoisonPgPassLine,
  decodeTm2Url,
  deriveWorkspaceLockKnownAnswer,
  sanitizePgEnvironment,
  TM2_PASSWORD_KNOWN_ANSWERS,
  type AcceptedTm2Url,
  type Tm2AdmissionCode,
  type Tm2Role,
} from '../../apps/server/test_support/postgres_tm2/environment_oracle.js';
import {
  auditTm2MandatoryLedger,
  TM2_FAMILIES,
  TM2_MANDATORY_LEDGER,
} from '../../apps/server/test_support/postgres_tm2/mandatory_ledger.js';
import {
  auditCatalogSummary,
  TM2_BUSINESS_TABLES,
  TM2_CATALOG_CARDINALITIES,
  TM2_MIGRATION_IDENTITIES,
  TM2_RUNTIME_GRANT_CARDINALITIES,
  TM2_RUNTIME_POINTER_UPDATES,
} from '../../apps/server/test_support/postgres_tm2/semantic_oracle.js';
import {
  isLockBlockedObservation,
  Tm2Barrier,
  withTm2Deadline,
} from '../../apps/server/test_support/postgres_tm2/concurrency_oracle.js';
import {
  executeTm2MandatoryCase,
  getPostgresTm2PublicFacade,
} from '../../apps/server/test_support/postgres_tm2/public_facade.js';

function accepted(
  role: Tm2Role,
  password = 'synthetic%40secret',
): AcceptedTm2Url {
  const result = decodeTm2Url(
    role,
    `postgres://${
      role === 'migration' ? 'struinfo_tm2_migrator' : `struinfo_tm2_${role}`
    }:${password}@127.0.0.1:5432/struinfo_tm2`,
  );
  if (result.status !== 'accepted') {
    throw new Error(`SYNTHETIC_URL_REJECTED:${result.code}`);
  }
  return result;
}

function expectRejected(
  role: Tm2Role,
  url: unknown,
  code: Tm2AdmissionCode,
): void {
  expect(decodeTm2Url(role, url)).toEqual({status: 'not_ready', role, code});
}

function parsePgPassLine(line: string): readonly string[] {
  const fields: string[] = [];
  let field = '';
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      field += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === ':') {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }
  if (escaped) {
    throw new Error('SYNTHETIC_PGPASS_ESCAPE_INCOMPLETE');
  }
  fields.push(field);
  return Object.freeze(fields);
}

function acceptedFromInput(role: Exclude<Tm2Role, 'admin'>, input: unknown) {
  const result = decodeTm2Url(role, input);
  if (result.status !== 'accepted') {
    throw new Error(`SYNTHETIC_PRODUCT_INPUT_REJECTED:${result.code}`);
  }
  return result.config;
}

function admittedObservation(): Tm2AdmissionEnvironmentObservation {
  const sessions = Object.fromEntries(
    (['admin', 'migration', 'runtime'] as const).map((role) => [
      role,
      Object.freeze({
        role,
        sessionUser:
          role === 'migration'
            ? 'struinfo_tm2_migrator'
            : `struinfo_tm2_${role}`,
        currentUser:
          role === 'migration'
            ? 'struinfo_tm2_migrator'
            : `struinfo_tm2_${role}`,
        roleSetting: 'none',
        databaseName: 'struinfo_tm2',
        serverAddress: '127.0.0.1',
        serverPort: 5432,
        serverVersionNumber: 180_000,
        serverEncoding: 'UTF8',
        clientEncoding: 'UTF8',
        timeZone: 'UTC',
        standardConformingStrings: 'on',
      }),
    ]),
  ) as Tm2AdmissionEnvironmentObservation['sessions'];
  return Object.freeze({
    sessions,
    roles: Object.freeze([
      Object.freeze({
        role: 'admin' as const,
        name: 'struinfo_tm2_admin',
        canLogin: true,
        superuser: true,
        createRole: false,
        createDatabase: false,
        replication: false,
        bypassRowLevelSecurity: false,
      }),
      Object.freeze({
        role: 'migration' as const,
        name: 'struinfo_tm2_migrator',
        canLogin: true,
        superuser: false,
        createRole: false,
        createDatabase: false,
        replication: false,
        bypassRowLevelSecurity: false,
      }),
      Object.freeze({
        role: 'runtime' as const,
        name: 'struinfo_tm2_runtime',
        canLogin: true,
        superuser: false,
        createRole: false,
        createDatabase: false,
        replication: false,
        bypassRowLevelSecurity: false,
      }),
    ]),
    directMembershipCount: 0,
    databaseOwner: 'struinfo_tm2_admin',
    runtimeOwnedNonTemporarySchemaCount: 0,
    runtimeOwnedProjectObjectCount: 0,
    runtimeSetRoleCount: 0,
    projectSchemaCount: 0,
  });
}

function admissionDependencies(
  inspectEnvironment: Tm2AdmissionDependencies['inspectEnvironment'],
): Tm2AdmissionDependencies {
  return {
    decodeProductConfig: acceptedFromInput,
    inspectEnvironment,
  };
}

function formalSyntheticEnvironment() {
  return {
    STRUIINFO_TM2_ADMIN_DATABASE_URL:
      'postgres://struinfo_tm2_admin:a@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_MIGRATION_DATABASE_URL:
      'postgres://struinfo_tm2_migrator:b@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_RUNTIME_DATABASE_URL:
      'postgres://struinfo_tm2_runtime:c@127.0.0.1/struinfo_tm2',
  };
}

describe('Test-owned PostgreSQL TM2 environment oracle', () => {
  it('decodes each frozen password exactly once', () => {
    for (const vector of TM2_PASSWORD_KNOWN_ANSWERS) {
      expect(accepted('admin', vector.serialized).config.password).toBe(
        vector.decoded,
      );
    }
  });

  it('preserves literal plus and does not normalize or decode twice', () => {
    expect(accepted('admin', 'J%CC%8C').config.password).toBe('J\u030c');
    expect(accepted('admin', '%2525').config.password).toBe('%25');
    expect(accepted('admin', 'synthetic+secret').config.password).toBe(
      'synthetic+secret',
    );
  });

  it('rejects missing and explicit-empty passwords before connection', () => {
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin@127.0.0.1/struinfo_tm2',
      'tm2_url_password_missing',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:@127.0.0.1/struinfo_tm2',
      'tm2_url_password_empty',
    );
  });

  it('rejects malformed percent and invalid UTF-8 password vectors', () => {
    for (const password of [
      '%',
      '%0',
      '%GG',
      '%C0%AF',
      '%E2%82',
      '%ED%A0%80',
      '%F4%90%80%80',
    ]) {
      expectRejected(
        'admin',
        `postgres://struinfo_tm2_admin:${password}@127.0.0.1/struinfo_tm2`,
        'tm2_url_percent_encoding',
      );
    }
  });

  it('rejects raw and decoded NUL, control, DEL, and lone surrogate vectors', () => {
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:synthetic%00secret@127.0.0.1/struinfo_tm2',
      'tm2_url_unicode',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:synthetic secret@127.0.0.1/struinfo_tm2',
      'tm2_url_raw_character',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:synthetic\u007fsecret@127.0.0.1/struinfo_tm2',
      'tm2_url_raw_character',
    );
    expectRejected(
      'admin',
      `postgres://struinfo_tm2_admin:synthetic${String.fromCharCode(0xd800)}secret@127.0.0.1/struinfo_tm2`,
      'tm2_url_unicode',
    );
  });

  it('rejects non-local authorities, invalid ports, and endpoint overrides', () => {
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@example.invalid/struinfo_tm2',
      'tm2_url_host',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@127.0.0.1:0/struinfo_tm2',
      'tm2_url_port',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/struinfo_tm2?sslmode=disable',
      'tm2_url_override',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/struinfo_tm2#fragment',
      'tm2_url_override',
    );
  });

  it('rejects empty, multiple, slash, backslash, and NUL database paths', () => {
    const vectors = [
      'postgres://struinfo_tm2_admin:x@127.0.0.1/',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a/b',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a%2Fb',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a%5Cb',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a%00b',
    ];
    for (const vector of vectors) {
      const result = decodeTm2Url('admin', vector);
      expect(result.status).toBe('not_ready');
      if (result.status === 'not_ready') {
        expect(['tm2_url_database', 'tm2_url_unicode']).toContain(result.code);
      }
    }
  });

  it('materializes an exact owned null-prototype eight-field config', () => {
    const config = accepted('runtime').config;
    expect(auditClosedPgConfig(config)).toEqual([]);
    expect(Object.getPrototypeOf(config)).toBeNull();
    expect(Reflect.ownKeys(config).sort()).toEqual([
      'application_name',
      'database',
      'host',
      'options',
      'password',
      'port',
      'ssl',
      'user',
    ]);
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      database: 'struinfo_tm2',
      user: 'struinfo_tm2_runtime',
      password: 'synthetic@secret',
      ssl: false,
      application_name: 'struinfo-tm2-runtime',
      options: '-c role=none -c search_path=pg_catalog',
    });
    const password = Object.getOwnPropertyDescriptor(config, 'password');
    expect(password).toMatchObject({
      value: 'synthetic@secret',
      enumerable: true,
      writable: false,
    });
  });

  it('admits only a common endpoint with three exact distinct roles', () => {
    const environment = {
      STRUIINFO_TM2_ADMIN_DATABASE_URL:
        'postgres://struinfo_tm2_admin:a@localhost/struinfo_tm2',
      STRUIINFO_TM2_MIGRATION_DATABASE_URL:
        'postgres://struinfo_tm2_migrator:b@localhost/struinfo_tm2',
      STRUIINFO_TM2_RUNTIME_DATABASE_URL:
        'postgres://struinfo_tm2_runtime:c@localhost/struinfo_tm2',
    };
    expect(admitTm2Environment(environment).status).toBe('accepted');
    expect(
      admitTm2Environment({
        ...environment,
        STRUIINFO_TM2_RUNTIME_DATABASE_URL:
          'postgres://struinfo_tm2_runtime:c@localhost/other',
      }),
    ).toMatchObject({status: 'not_ready', code: 'tm2_endpoint_mismatch'});
  });

  it('reports each absent formal URL as NOT_READY without substituting another variable', () => {
    const environment: Record<string, string | undefined> = {
      STRUIINFO_TM2_ADMIN_DATABASE_URL:
        'postgres://struinfo_tm2_admin:a@localhost/struinfo_tm2',
      STRUIINFO_TM2_MIGRATION_DATABASE_URL:
        'postgres://struinfo_tm2_migrator:b@localhost/struinfo_tm2',
      STRUIINFO_TM2_RUNTIME_DATABASE_URL:
        'postgres://struinfo_tm2_runtime:c@localhost/struinfo_tm2',
    };
    for (const variable of Object.keys(environment)) {
      const candidate = {...environment, [variable]: undefined};
      expect(admitTm2Environment(candidate)).toEqual({
        status: 'not_ready',
        code: 'tm2_url_missing',
        variable,
      });
    }
  });

  it('accepts both schemes, all local host forms, and the inclusive port bounds', () => {
    const vectors = [
      {
        url: 'postgres://struinfo_tm2_admin:x@127.0.0.1:1/struinfo_tm2',
        authorityHost: '127.0.0.1',
        pgHost: '127.0.0.1',
      },
      {
        url: 'postgresql://struinfo_tm2_admin:x@localhost:65535/struinfo_tm2',
        authorityHost: 'localhost',
        pgHost: 'localhost',
      },
      {
        url: 'postgres://struinfo_tm2_admin:x@[::1]/struinfo_tm2',
        authorityHost: '[::1]',
        pgHost: '::1',
      },
    ];
    for (const vector of vectors) {
      const result = decodeTm2Url('admin', vector.url);
      expect(result.status).toBe('accepted');
      if (result.status === 'accepted') {
        expect(result.authorityHost).toBe(vector.authorityHost);
        expect(result.config.host).toBe(vector.pgHost);
      }
    }
    expect(isIP(vectors[2]?.pgHost ?? '')).toBe(6);
  });

  it('removes every case form of PG variables while preserving a sentinel', () => {
    const sanitized = sanitizePgEnvironment(
      {
        PATH: 'synthetic-path',
        PGPASSWORD: 'forbidden',
        pgservice: 'forbidden',
        PgOptions: 'forbidden',
        SYNTHETIC_SENTINEL: 'preserved',
      },
      {
        home: 'synthetic-home',
        userProfile: 'synthetic-profile',
        appData: 'synthetic-appdata',
      },
    );
    expect(Object.keys(sanitized).filter((key) => /^pg/i.test(key))).toEqual(
      [],
    );
    expect(sanitized.SYNTHETIC_SENTINEL).toBe('preserved');
    expect(sanitized).toMatchObject({
      HOME: 'synthetic-home',
      USERPROFILE: 'synthetic-profile',
      APPDATA: 'synthetic-appdata',
    });
  });

  it('creates a matching poison record without copying the explicit password', () => {
    const config = accepted('migration').config;
    const line = createPoisonPgPassLine(config);
    expect(line).toBe(
      '127.0.0.1:5432:struinfo_tm2:struinfo_tm2_migrator:synthetic-poison-password',
    );
    expect(line).not.toContain(config.password);
  });

  it('serializes the IPv6 pgpass endpoint from the unbracketed driver host', () => {
    const result = decodeTm2Url(
      'runtime',
      'postgres://struinfo_tm2_runtime:synthetic%40secret@[::1]/struinfo_tm2',
    );
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.authorityHost).toBe('[::1]');
      expect(result.config.host).toBe('::1');
      expect(isIP(result.config.host)).toBe(6);
      const fields = parsePgPassLine(createPoisonPgPassLine(result.config));
      expect(fields).toEqual([
        '::1',
        '5432',
        'struinfo_tm2',
        'struinfo_tm2_runtime',
        'synthetic-poison-password',
      ]);
      expect(fields[0]).toBe(result.config.host);
    }
  });
});

describe('Test-owned PostgreSQL TM2 admission outcome channel', () => {
  it('classifies a syntax-valid unreachable endpoint as NOT_READY with exit 2', async () => {
    const outcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.reject(
          new Tm2AdmissionProbeError(
            'tm2_connection_unavailable',
            'STRUIINFO_TM2_ADMIN_DATABASE_URL',
          ),
        ),
      ),
    );
    expect(outcome).toEqual({
      status: 'not_ready',
      code: 'tm2_connection_unavailable',
      variable: 'STRUIINFO_TM2_ADMIN_DATABASE_URL',
    });
    expect(classifyTm2HarnessOutcome(outcome)).toMatchObject({
      exitCode: 2,
      outcome: 'not_ready',
    });
  });

  it('classifies PostgreSQL version and session/role admission drift as NOT_READY', async () => {
    const oldVersion = admittedObservation();
    const versionOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.resolve({
          ...oldVersion,
          sessions: {
            ...oldVersion.sessions,
            runtime: {
              ...oldVersion.sessions.runtime,
              serverVersionNumber: 170_000,
            },
          },
        }),
      ),
    );
    expect(versionOutcome).toMatchObject({
      status: 'not_ready',
      code: 'tm2_server_version',
      variable: 'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
    });

    const wrongSession = admittedObservation();
    const sessionOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.resolve({
          ...wrongSession,
          sessions: {
            ...wrongSession.sessions,
            migration: {
              ...wrongSession.sessions.migration,
              currentUser: 'synthetic_wrong_role',
            },
          },
        }),
      ),
    );
    expect(sessionOutcome).toMatchObject({
      status: 'not_ready',
      code: 'tm2_session_identity',
      variable: 'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
    });

    const wrongOwnership = admittedObservation();
    const ownershipOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.resolve({
          ...wrongOwnership,
          runtimeOwnedProjectObjectCount: 1,
        }),
      ),
    );
    expect(ownershipOutcome).toMatchObject({
      status: 'not_ready',
      code: 'tm2_runtime_ownership',
    });
  });

  it('keeps admitted mandatory failure as FAIL and success as PASS', async () => {
    const admission = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() => Promise.resolve(admittedObservation())),
    );
    expect(admission).toEqual({
      status: 'admitted',
      code: 'tm2_environment_admitted',
    });
    expect(
      classifyTm2HarnessOutcome(admission, {exitCode: 1, signal: null}),
    ).toEqual({
      exitCode: 1,
      event: 'postgres_tm2_failed',
      outcome: 'failed',
      code: 'tm2_mandatory_failure',
    });
    expect(
      classifyTm2HarnessOutcome(admission, {exitCode: 0, signal: null}),
    ).toEqual({
      exitCode: 0,
      event: 'postgres_tm2_complete',
      outcome: 'pass',
    });
  });

  it('classifies product decoder disagreement as candidate FAIL', async () => {
    const environment = formalSyntheticEnvironment();
    environment.STRUIINFO_TM2_RUNTIME_DATABASE_URL += '?sslmode=disable';
    const outcome = await runTm2AdmissionPreflight(environment, {
      decodeProductConfig(role, input) {
        if (role === 'runtime') {
          return accepted('runtime').config;
        }
        return acceptedFromInput(role, input);
      },
      inspectEnvironment() {
        return Promise.resolve(admittedObservation());
      },
    });
    expect(outcome).toEqual({
      status: 'failed',
      code: 'tm2_product_accepted_prohibited_url',
    });
    expect(classifyTm2HarnessOutcome(outcome).exitCode).toBe(1);
  });

  it('emits only closed safe admission records when probes throw sensitive text', async () => {
    const sensitiveCanary = 'synthetic-sensitive-probe-text';
    const outcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() => Promise.reject(new Error(sensitiveCanary))),
    );
    const encoded = JSON.stringify(outcome);
    expect(outcome).toEqual({
      status: 'not_ready',
      code: 'tm2_environment_probe_unavailable',
    });
    expect(encoded).not.toContain(sensitiveCanary);
    expect(encoded).not.toContain('sensitive-probe');
    expect(decodeTm2AdmissionChannel(encoded)).toEqual(outcome);
    expect(
      decodeTm2AdmissionChannel(
        `${encoded.slice(0, -1)},"unexpected":"sensitive-probe"}`,
      ),
    ).toBeUndefined();
  });
});

describe('Test-owned PostgreSQL TM2 frozen ledger and semantic maps', () => {
  it('registers 488 continuous unique mandatory IDs in 24 families', () => {
    expect(auditTm2MandatoryLedger()).toEqual({
      total: 488,
      unique: 488,
      missing: [],
      duplicate: [],
      unexpected: [],
      familyCount: 24,
    });
    expect(TM2_MANDATORY_LEDGER[0]?.id).toBe('PG-TM2-001');
    expect(TM2_MANDATORY_LEDGER.at(-1)?.id).toBe('PG-TM2-488');
    expect(TM2_FAMILIES[0]?.start).toBe(1);
    expect(TM2_FAMILIES.at(-1)?.end).toBe(488);
  });

  it('freezes all four migration identities without using a schema dump hash', () => {
    expect(TM2_MIGRATION_IDENTITIES).toHaveLength(4);
    expect(TM2_MIGRATION_IDENTITIES.map((row) => row.version)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      TM2_MIGRATION_IDENTITIES.every((row) =>
        /^[0-9a-f]{64}$/.test(row.sha256),
      ),
    ).toBe(true);
  });

  it('freezes the closed 35-table catalog and material cardinalities', () => {
    expect(TM2_BUSINESS_TABLES).toHaveLength(35);
    expect(new Set(TM2_BUSINESS_TABLES).size).toBe(35);
    expect(
      auditCatalogSummary({
        tableNames: TM2_BUSINESS_TABLES,
        primaryKeys: 35,
        uniqueConstraints: 49,
        foreignKeys: 77,
        checks: 128,
        explicitIndexes: 8,
      }),
    ).toEqual([]);
    expect(TM2_CATALOG_CARDINALITIES.deferredCurrentPointerForeignKeys).toBe(
      10,
    );
  });

  it('freezes the exact runtime pointer-update and grant cardinalities', () => {
    expect(TM2_RUNTIME_POINTER_UPDATES).toHaveLength(7);
    expect(
      TM2_RUNTIME_POINTER_UPDATES.flatMap((row) => row.columns),
    ).toHaveLength(13);
    expect(TM2_RUNTIME_GRANT_CARDINALITIES).toEqual({
      selectTables: 35,
      insertColumns: 181,
      updateColumns: 13,
      updateTables: 7,
    });
  });

  it('independently reproduces the workspace advisory-lock known answer', () => {
    expect(
      deriveWorkspaceLockKnownAnswer('11111111-1111-4111-8111-111111111111'),
    ).toEqual({
      digest:
        '5a8f5bbb1115b7a070f4dbacc772b36b22141bd0900a271b1b3de14c4aac54f2',
      firstEightBytes: '5a8f5bbb1115b7a0',
      signedKey: '6525535244086785952',
    });
  });
});

describe('Test-owned PostgreSQL TM2 concurrency and binding seams', () => {
  it('uses a participant barrier rather than a fixed sleep as the ordering oracle', async () => {
    const barrier = new Tm2Barrier(2);
    const reached: string[] = [];
    const first = barrier.arrive().then(() => {
      reached.push('first');
    });
    expect(barrier.arrivals).toBe(1);
    const second = barrier.arrive().then(() => {
      reached.push('second');
    });
    await withTm2Deadline(Promise.all([first, second]), 1_000);
    expect(reached.sort()).toEqual(['first', 'second']);
  });

  it('recognizes an observed PostgreSQL lock wait without wall-clock inference', () => {
    expect(
      isLockBlockedObservation({
        applicationName: 'struinfo-tm2-runtime',
        waitEventType: 'Lock',
        waitEvent: 'advisory',
        transactionId: 'synthetic-transaction',
      }),
    ).toBe(true);
    expect(
      isLockBlockedObservation({
        applicationName: 'unrelated',
        waitEventType: 'Client',
        waitEvent: 'ClientRead',
        transactionId: undefined,
      }),
    ).toBe(false);
  });

  it('binds public product exports and executes non-database quality rows', async () => {
    const facade = getPostgresTm2PublicFacade();
    expect(facade.bindingStatus).toBe('bound');
    const environment = admitSyntheticEnvironment();
    for (const row of TM2_MANDATORY_LEDGER.slice(0, 68)) {
      await expect(
        executeTm2MandatoryCase(facade, row, {
          admission: environment,
          poisonRoot: 'synthetic-poison-root',
        }),
        row.id,
      ).resolves.toMatchObject({
        caseId: row.id,
        vectorId: row.vectorId,
      });
    }
    vi.stubEnv(
      'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
      'postgres://struinfo_tm2_migrator:b@127.0.0.1/struinfo_tm2',
    );
    vi.stubEnv(
      'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
      'postgres://struinfo_tm2_runtime:c@127.0.0.1/struinfo_tm2',
    );
    for (const row of TM2_MANDATORY_LEDGER.slice(68, 98)) {
      await expect(
        executeTm2MandatoryCase(facade, row, {
          admission: environment,
          poisonRoot: 'synthetic-poison-root',
        }),
        row.id,
      ).resolves.toMatchObject({caseId: row.id, vectorId: row.vectorId});
    }
    for (const row of [
      ...TM2_MANDATORY_LEDGER.slice(460, 470),
      ...TM2_MANDATORY_LEDGER.slice(480, 487),
    ]) {
      await expect(
        executeTm2MandatoryCase(facade, row, {
          admission: environment,
          poisonRoot: 'synthetic-poison-root',
        }),
        row.id,
      ).resolves.toMatchObject({caseId: row.id, vectorId: row.vectorId});
    }
    vi.unstubAllEnvs();
    await facade.close();
  });
});

function admitSyntheticEnvironment() {
  const result = admitTm2Environment({
    STRUIINFO_TM2_ADMIN_DATABASE_URL:
      'postgres://struinfo_tm2_admin:a@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_MIGRATION_DATABASE_URL:
      'postgres://struinfo_tm2_migrator:b@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_RUNTIME_DATABASE_URL:
      'postgres://struinfo_tm2_runtime:c@127.0.0.1/struinfo_tm2',
  });
  if (result.status !== 'accepted') {
    throw new Error(`SYNTHETIC_ENVIRONMENT_REJECTED:${result.code}`);
  }
  return result;
}
