import {describe, expect, it} from 'vitest';

import {
  encodeCanonicalJson,
  type JsonObject,
  type JsonValue,
} from '../serialization/canonical_json.js';
import {
  BLOB_DIGEST_ALGORITHM,
  type BlobIdentity,
} from '../storage/blob_store.js';
import {
  readWorkspaceBundle,
  type WorkspaceBundleSectionCodec,
  WORKSPACE_BUNDLE_FORMAT,
  WORKSPACE_BUNDLE_VERSION,
  writeWorkspaceBundle,
} from './workspace_bundle.js';

const EXPORTED_AT = '2040-01-02T03:04:05.000Z';
const WORKSPACE_ID = 'workspace_synthetic';
const BLOB_REFERENCE: BlobIdentity = {
  algorithm: BLOB_DIGEST_ALGORITHM,
  byteLength: 3,
  digest: 'a'.repeat(64),
};
const SYNTHETIC_SECTION_TYPE = 'synthetic.preferences';

interface SyntheticInternalState {
  readonly portable: Readonly<{
    categories: readonly Readonly<{key: string; label: string}>[];
    credentialReference: string;
    savedQuery: string;
    sourceUrl: string;
  }>;
  readonly runtimeSecrets: Readonly<{
    databasePassword: string;
    providerApiKey: string;
  }>;
}

const SYNTHETIC_CODEC: WorkspaceBundleSectionCodec = {
  type: SYNTHETIC_SECTION_TYPE,
  version: 1,
  encode(value: unknown): unknown {
    return (value as SyntheticInternalState).portable;
  },
  decode(payload: JsonValue): unknown {
    return payload;
  },
};

describe('workspace bundle contract', () => {
  it('admits a domain-scale section above the generic 100,000-value default', () => {
    const largeCodec: WorkspaceBundleSectionCodec = {
      type: 'synthetic.large-domain',
      version: 1,
      encode: (value) => value,
      decode: (value) => value,
    };
    const values = Array.from({length: 120_000}, () => 0);

    const bytes = writeWorkspaceBundle(
      {
        workspaceId: WORKSPACE_ID,
        exportedAt: EXPORTED_AT,
        sections: [
          {type: largeCodec.type, version: largeCodec.version, value: values},
        ],
        blobReferences: [],
      },
      [largeCodec],
    );

    expect(readWorkspaceBundle(bytes, [largeCodec]).sections[0]?.value).toEqual(
      values,
    );
  });

  it('round-trips synthetic personal settings while excluding runtime secrets', () => {
    const state: SyntheticInternalState = {
      portable: {
        categories: [{key: 'synthetic-topic', label: '合成主题'}],
        credentialReference: 'secret-ref-synthetic-provider',
        savedQuery: 'category:synthetic-topic',
        sourceUrl: 'https://example.invalid/synthetic-feed',
      },
      runtimeSecrets: {
        databasePassword: 'never-export-database-password',
        providerApiKey: 'never-export-provider-key',
      },
    };

    const bytes = writeWorkspaceBundle(
      {
        workspaceId: WORKSPACE_ID,
        exportedAt: EXPORTED_AT,
        sections: [{type: SYNTHETIC_SECTION_TYPE, version: 1, value: state}],
        blobReferences: [BLOB_REFERENCE],
      },
      [SYNTHETIC_CODEC],
    );
    const encodedText = new TextDecoder().decode(bytes);
    const imported = readWorkspaceBundle(bytes, [SYNTHETIC_CODEC]);

    expect(encodedText).not.toContain(state.runtimeSecrets.databasePassword);
    expect(encodedText).not.toContain(state.runtimeSecrets.providerApiKey);
    expect(encodedText).not.toContain('runtimeSecrets');
    expect(imported).toEqual({
      workspaceId: WORKSPACE_ID,
      exportedAt: EXPORTED_AT,
      secretHandling: 'excluded',
      sections: [
        {
          type: SYNTHETIC_SECTION_TYPE,
          version: 1,
          value: state.portable,
        },
      ],
      blobReferences: [BLOB_REFERENCE],
    });
  });

  it('rejects secret-bearing section payloads even from a registered codec', () => {
    const unsafeCodec: WorkspaceBundleSectionCodec = {
      type: 'synthetic.unsafe',
      version: 1,
      encode: () => ({providerApiKey: 'synthetic-secret-value'}),
      decode: (payload) => payload,
    };

    expect(() =>
      writeWorkspaceBundle(
        {
          workspaceId: WORKSPACE_ID,
          exportedAt: EXPORTED_AT,
          sections: [
            {type: unsafeCodec.type, version: unsafeCodec.version, value: {}},
          ],
          blobReferences: [],
        },
        [unsafeCodec],
      ),
    ).toThrow(expect.objectContaining({code: 'secret_material_forbidden'}));
  });

  it('rejects credential-bearing URLs during export and import', () => {
    const unsafeCodec: WorkspaceBundleSectionCodec = {
      type: 'synthetic.unsafe-url',
      version: 1,
      encode: () => ({sourceUrl: 'https://user:password@example.invalid'}),
      decode: (payload) => payload,
    };

    expect(() =>
      writeWorkspaceBundle(
        {
          workspaceId: WORKSPACE_ID,
          exportedAt: EXPORTED_AT,
          sections: [
            {type: unsafeCodec.type, version: unsafeCodec.version, value: {}},
          ],
          blobReferences: [],
        },
        [unsafeCodec],
      ),
    ).toThrow(expect.objectContaining({code: 'secret_material_forbidden'}));
  });

  it('requires every section type and version to have a registered codec', () => {
    const bytes = createSyntheticBundle();

    expect(() => readWorkspaceBundle(bytes, [])).toThrow(
      expect.objectContaining({code: 'section_unsupported'}),
    );
  });

  it('rejects proxied writer containers before iterating them', () => {
    const request = syntheticRequest();
    const sections = new Proxy([...request.sections], {});

    expect(() =>
      writeWorkspaceBundle({...request, sections}, [SYNTHETIC_CODEC]),
    ).toThrow(expect.objectContaining({code: 'schema_invalid'}));
  });

  it('rejects unknown envelope fields and duplicate JSON members', () => {
    const bytes = createSyntheticBundle();
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    const withUnknownField = encodeCanonicalJson(
      {...parsed, unexpected: true},
      4096,
    );
    const withDuplicateVersion = new TextEncoder().encode(
      new TextDecoder()
        .decode(bytes)
        .replace('"version":1', '"version":1,"version":1'),
    );

    expect(() =>
      readWorkspaceBundle(withUnknownField, [SYNTHETIC_CODEC]),
    ).toThrow(expect.objectContaining({code: 'schema_invalid'}));
    expect(() =>
      readWorkspaceBundle(withDuplicateVersion, [SYNTHETIC_CODEC]),
    ).toThrow(expect.objectContaining({code: 'schema_invalid'}));
  });

  it('rejects a canonical imported payload containing a secret field', () => {
    const unsafeEnvelope = createEnvelope({apiKey: 'synthetic-secret-value'});
    const bytes = encodeCanonicalJson(unsafeEnvelope, 4096);

    expect(() => readWorkspaceBundle(bytes, [SYNTHETIC_CODEC])).toThrow(
      expect.objectContaining({code: 'secret_material_forbidden'}),
    );
  });

  it('measures the entire canonical envelope at the inclusive boundary', () => {
    const bytes = createSyntheticBundle();

    expect(() =>
      writeWorkspaceBundle(syntheticRequest(), [SYNTHETIC_CODEC], {
        maximumBytes: bytes.byteLength,
      }),
    ).not.toThrow();
    expect(() =>
      writeWorkspaceBundle(syntheticRequest(), [SYNTHETIC_CODEC], {
        maximumBytes: bytes.byteLength - 1,
      }),
    ).toThrow(expect.objectContaining({code: 'bundle_too_large'}));
    expect(() =>
      readWorkspaceBundle(bytes, [SYNTHETIC_CODEC], {
        maximumBytes: bytes.byteLength - 1,
      }),
    ).toThrow(expect.objectContaining({code: 'bundle_too_large'}));
  });

  it('rejects invalid UTF-8 and unsupported format versions safely', () => {
    const unsupported = encodeCanonicalJson(
      {...createEnvelope({}), version: WORKSPACE_BUNDLE_VERSION + 1},
      4096,
    );

    expect(() =>
      readWorkspaceBundle(Uint8Array.from([0xff]), [SYNTHETIC_CODEC]),
    ).toThrow(expect.objectContaining({code: 'encoding_invalid'}));
    expect(() => readWorkspaceBundle(unsupported, [SYNTHETIC_CODEC])).toThrow(
      expect.objectContaining({code: 'format_unsupported'}),
    );
  });
});

function createSyntheticBundle(): Uint8Array {
  return writeWorkspaceBundle(syntheticRequest(), [SYNTHETIC_CODEC]);
}

function syntheticRequest() {
  return {
    workspaceId: WORKSPACE_ID,
    exportedAt: EXPORTED_AT,
    sections: [
      {
        type: SYNTHETIC_SECTION_TYPE,
        version: 1,
        value: {
          portable: {
            categories: [{key: 'synthetic-topic', label: '合成主题'}],
            credentialReference: 'secret-ref-synthetic-provider',
            savedQuery: 'category:synthetic-topic',
            sourceUrl: 'https://example.invalid/synthetic-feed',
          },
          runtimeSecrets: {
            databasePassword: 'never-export-database-password',
            providerApiKey: 'never-export-provider-key',
          },
        } satisfies SyntheticInternalState,
      },
    ],
    blobReferences: [BLOB_REFERENCE],
  } as const;
}

function createEnvelope(payload: JsonValue): JsonObject {
  return {
    blobReferences: [
      {
        algorithm: BLOB_REFERENCE.algorithm,
        byteLength: BLOB_REFERENCE.byteLength,
        digest: BLOB_REFERENCE.digest,
      },
    ],
    exportedAt: EXPORTED_AT,
    format: WORKSPACE_BUNDLE_FORMAT,
    secretHandling: 'excluded',
    sections: [{payload, type: SYNTHETIC_SECTION_TYPE, version: 1}],
    version: WORKSPACE_BUNDLE_VERSION,
    workspaceId: WORKSPACE_ID,
  };
}
