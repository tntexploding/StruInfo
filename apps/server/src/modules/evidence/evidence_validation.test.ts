import {createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';

import {describe, expect, it} from 'vitest';

import {
  MEDIA_PURPOSE_ORIGINS,
  MEDIA_PURPOSES,
  type CaptureEvidenceInput,
  type EvidenceBlobInput,
  type ExactBlobIdentity,
  type ImmutableEvidenceRecord,
  type LineRange,
  type MediaUsageInput,
} from './evidence_contract.js';
import {
  resolveEvidenceCaptureReplay,
  resolveImmutableEvidenceRecord,
  validateEvidenceCapture,
  type EvidenceValidationCode,
} from './evidence_validation.js';

type Mutable<Value> = Value extends Uint8Array
  ? Uint8Array
  : Value extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : Value extends object
      ? {-readonly [Key in keyof Value]: Mutable<Value[Key]>}
      : Value;

const encoder = new TextEncoder();
const WORKSPACE_ID = uuid(1);
const OTHER_WORKSPACE_ID = uuid(2);
const RESOURCE_ID = uuid(10);
const SNAPSHOT_ID = uuid(11);
const STRUCTURE_ID = uuid(12);
const ROOT_NODE_ID = uuid(20);
const TEXT_NODE_ID = uuid(21);
const SECOND_NODE_ID = uuid(22);
const FRAGMENT_ID = uuid(30);
const RAW_BLOB_ID = uuid(40);
const TEXT_BLOB_ID = uuid(41);
const MEDIA_BLOB_ID = uuid(42);
const STORED_ASSET_ID = uuid(50);
const EXTERNAL_ASSET_ID = uuid(51);
const MEDIA_USAGE_ID = uuid(60);
const NORMALIZED_TEXT = '甲😀e\u0301乙\n次';
const RAW_BYTES = encoder.encode('synthetic source bytes');
const TEXT_BYTES = encoder.encode(NORMALIZED_TEXT);
const MEDIA_BYTES = encoder.encode('synthetic media bytes');

describe('source-evidence domain validation', () => {
  it('accepts a closed synthetic capture graph', () => {
    expectValidated(validCapture());
  });

  it('returns a defensive deeply frozen relational snapshot without validation bytes', () => {
    const input = structuredClone(
      validCapture(),
    ) as Mutable<CaptureEvidenceInput>;
    const result = validateEvidenceCapture(input);
    if (result.status !== 'validated') {
      throw new Error('Synthetic valid input was rejected.');
    }

    const beforeMutation = structuredClone(result.value);
    input.workspaceId = OTHER_WORKSPACE_ID;
    input.resource.workspaceId = OTHER_WORKSPACE_ID;
    at(input.structure.nodes, 0).workspaceId = OTHER_WORKSPACE_ID;
    input.structure.normalizedTextUtf8.fill(0);

    expect(result.value).toEqual(beforeMutation);
    expect(result.value.structure).not.toHaveProperty('normalizedTextUtf8');
    expect(Object.keys(result.value)).toEqual([
      'workspaceId',
      'commandIdempotencyKey',
      'blobs',
      'resource',
      'gitResource',
      'snapshot',
      'gitObservations',
      'structure',
      'mediaAssets',
      'mediaUsages',
    ]);
    expectDeeplyFrozen(result.value);
  });

  it('turns malformed nested runtime shapes into stable validation failures', () => {
    const base = validCapture();
    const observation = at(base.gitObservations, 0);
    const malformed = [
      {input: {...base, resource: null}, path: 'resource'},
      {
        input: {...base, snapshot: {...base.snapshot, rawBlob: null}},
        path: 'snapshot.rawBlob',
      },
      {
        input: {
          ...base,
          gitObservations: [{...observation, commit: null}],
        },
        path: 'gitObservations[0].commit',
      },
    ] as const;

    for (const {input, path} of malformed) {
      expect(() => validateEvidenceCapture(input)).not.toThrow();
      expect(validateEvidenceCapture(input)).toEqual({
        status: 'validation_failed',
        issue: {code: 'invalid_shape', path},
      });
    }
  });

  it('rejects unknown fields at the root and every major nested record', () => {
    const cases: readonly {
      name: string;
      path: string;
      select: (draft: Mutable<CaptureEvidenceInput>) => object;
    }[] = [
      {name: 'capture', path: 'unexpected', select: (draft) => draft},
      {
        name: 'blob',
        path: 'blobs[0].unexpected',
        select: (draft) => at(draft.blobs, 0),
      },
      {
        name: 'resource',
        path: 'resource.unexpected',
        select: (draft) => draft.resource,
      },
      {
        name: 'git resource',
        path: 'gitResource.unexpected',
        select: (draft) => required(draft.gitResource),
      },
      {
        name: 'snapshot',
        path: 'snapshot.unexpected',
        select: (draft) => draft.snapshot,
      },
      {
        name: 'raw Blob identity',
        path: 'snapshot.rawBlob.unexpected',
        select: (draft) => required(draft.snapshot.rawBlob),
      },
      {
        name: 'publication',
        path: 'snapshot.publication.unexpected',
        select: (draft) => required(draft.snapshot.publication),
      },
      {
        name: 'Git observation',
        path: 'gitObservations[0].unexpected',
        select: (draft) => at(draft.gitObservations, 0),
      },
      {
        name: 'Git object',
        path: 'gitObservations[0].commit.unexpected',
        select: (draft) => at(draft.gitObservations, 0).commit,
      },
      {
        name: 'structure',
        path: 'structure.unexpected',
        select: (draft) => draft.structure,
      },
      {
        name: 'structure text Blob',
        path: 'structure.textBlob.unexpected',
        select: (draft) => draft.structure.textBlob,
      },
      {
        name: 'node',
        path: 'structure.nodes[0].unexpected',
        select: (draft) => at(draft.structure.nodes, 0),
      },
      {
        name: 'code-point range',
        path: 'structure.nodes[0].codePointRange.unexpected',
        select: (draft) => at(draft.structure.nodes, 0).codePointRange,
      },
      {
        name: 'line range',
        path: 'structure.nodes[0].lineRange.unexpected',
        select: (draft) => required(at(draft.structure.nodes, 0).lineRange),
      },
      {
        name: 'fragment',
        path: 'structure.fragments[0].unexpected',
        select: (draft) => at(draft.structure.fragments, 0),
      },
      {
        name: 'media asset',
        path: 'mediaAssets[0].unexpected',
        select: (draft) => at(draft.mediaAssets, 0),
      },
      {
        name: 'media dimensions',
        path: 'mediaAssets[0].dimensions.unexpected',
        select: (draft) => required(at(draft.mediaAssets, 0).dimensions),
      },
      {
        name: 'media usage',
        path: 'mediaUsages[0].unexpected',
        select: (draft) => at(draft.mediaUsages, 0),
      },
    ];

    for (const testCase of cases) {
      const capture = changed((draft) => {
        defineDataProperty(testCase.select(draft), 'unexpected', testCase.name);
      });
      expect(validateEvidenceCapture(capture)).toEqual({
        status: 'validation_failed',
        issue: {code: 'invalid_shape', path: testCase.path},
      });
    }
  });

  it('never invokes root, declared-field, or unknown-field getters', () => {
    let getterCalls = 0;
    const rootGetter = validCapture() as unknown as Record<string, unknown>;
    Object.defineProperty(rootGetter, 'unexpected', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'synthetic-secret-body';
      },
    });
    const declaredGetter = changed((draft) => {
      Object.defineProperty(draft.resource, 'sourceKey', {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return 'synthetic-secret-body';
        },
      });
    });

    expect(validateEvidenceCapture(rootGetter)).toMatchObject({
      status: 'validation_failed',
      issue: {code: 'invalid_shape', path: 'unexpected'},
    });
    expect(validateEvidenceCapture(declaredGetter)).toMatchObject({
      status: 'validation_failed',
      issue: {code: 'invalid_shape', path: 'resource.sourceKey'},
    });
    expect(getterCalls).toBe(0);
  });

  it('projects declared fields without invoking an inherited setter', () => {
    const inheritedDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'workspaceId',
    );
    let setterCalls = 0;
    let result: ReturnType<typeof validateEvidenceCapture> | undefined;

    try {
      Object.defineProperty(Object.prototype, 'workspaceId', {
        configurable: true,
        set: () => {
          setterCalls += 1;
        },
      });
      result = validateEvidenceCapture(validCapture());
    } finally {
      if (inheritedDescriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, 'workspaceId');
      } else {
        Object.defineProperty(
          Object.prototype,
          'workspaceId',
          inheritedDescriptor,
        );
      }
    }

    expect(result).toMatchObject({status: 'validated'});
    expect(setterCalls).toBe(0);
  });

  it('rejects symbols and dangerous own prototype keys as data', () => {
    const cases = [
      {
        path: 'capture',
        add: (draft: object) =>
          Object.defineProperty(draft, Symbol('synthetic'), {
            value: 'synthetic',
            enumerable: true,
          }),
      },
      {
        path: '__proto__',
        add: (draft: object) => {
          defineDataProperty(draft, '__proto__', 'synthetic');
        },
      },
      {
        path: 'constructor',
        add: (draft: object) => {
          defineDataProperty(draft, 'constructor', 'synthetic');
        },
      },
    ] as const;

    for (const testCase of cases) {
      const capture = validCapture() as unknown as object;
      testCase.add(capture);
      expect(validateEvidenceCapture(capture)).toEqual({
        status: 'validation_failed',
        issue: {code: 'invalid_shape', path: testCase.path},
      });
    }
  });

  it('rejects class instances, custom prototypes, and Map values', () => {
    class SyntheticCapture {
      public readonly marker = 'synthetic';
    }
    const classRoot = Object.assign(new SyntheticCapture(), validCapture());
    const customPrototype = changed((draft) => {
      Object.setPrototypeOf(draft.resource, {synthetic: true});
    });
    const knownMap = changed((draft) => {
      draft.resource = new Map() as unknown as Mutable<
        CaptureEvidenceInput['resource']
      >;
    });
    const unknownMap = validCapture() as unknown as Record<string, unknown>;
    unknownMap.unexpected = new Map([['synthetic', 'value']]);

    for (const input of [classRoot, customPrototype, knownMap, unknownMap]) {
      expect(validateEvidenceCapture(input)).toMatchObject({
        status: 'validation_failed',
        issue: {code: 'invalid_shape'},
      });
    }
  });

  it('rejects root, nested, revoked, and array Proxies without invoking traps', () => {
    let trapCalls = 0;
    const traps: ProxyHandler<object> = {
      getPrototypeOf: () => {
        trapCalls += 1;
        throw new Error('Proxy trap must not run.');
      },
      ownKeys: () => {
        trapCalls += 1;
        throw new Error('Proxy trap must not run.');
      },
    };
    const rootProxy = new Proxy(validCapture(), traps);
    const nestedProxy = changed((draft) => {
      draft.resource = new Proxy(
        draft.resource,
        traps,
      ) as typeof draft.resource;
    });
    const arrayProxy = changed((draft) => {
      draft.blobs = new Proxy(draft.blobs, traps) as typeof draft.blobs;
    });
    const revoked = Proxy.revocable(validCapture(), traps);
    revoked.revoke();

    for (const input of [rootProxy, nestedProxy, arrayProxy, revoked.proxy]) {
      expect(() => validateEvidenceCapture(input)).not.toThrow();
      expect(validateEvidenceCapture(input)).toMatchObject({
        status: 'validation_failed',
        issue: {code: 'invalid_shape'},
      });
    }
    expect(trapCalls).toBe(0);
  });

  it('rejects sparse arrays, array accessors, and extra array properties', () => {
    let getterCalls = 0;
    const sparse = changed((draft) => {
      Reflect.deleteProperty(draft.blobs, '1');
    });
    const accessor = changed((draft) => {
      Object.defineProperty(draft.blobs, '1', {
        enumerable: true,
        configurable: true,
        get: () => {
          getterCalls += 1;
          return undefined;
        },
      });
    });
    const extra = changed((draft) => {
      defineDataProperty(draft.blobs, 'extra', 'synthetic');
    });

    for (const [input, path] of [
      [sparse, 'blobs'],
      [accessor, 'blobs.1'],
      [extra, 'blobs.extra'],
    ] as const) {
      expect(validateEvidenceCapture(input)).toEqual({
        status: 'validation_failed',
        issue: {code: 'invalid_shape', path},
      });
    }
    expect(getterCalls).toBe(0);
  });

  it('validates lowercase SHA-256 identities and exact byte length', () => {
    const uppercase = changed((draft) => {
      at(draft.blobs, 0).digest = 'A'.repeat(64);
    });
    const negativeLength = changed((draft) => {
      at(draft.blobs, 0).byteLength = -1;
    });

    expectFailure(uppercase, 'invalid_digest');
    expectFailure(negativeLength, 'invalid_structure');
  });

  it('accepts Git SHA-1 and SHA-256 commit and Blob object identities', () => {
    expectValidated(validCapture());
    const reversedAlgorithms = changed((draft) => {
      const observation = at(draft.gitObservations, 0);
      observation.commit = {algorithm: 'sha256', digest: 'a'.repeat(64)};
      observation.blobObject = {algorithm: 'sha1', digest: 'b'.repeat(40)};
    });

    expectValidated(reversedAlgorithms);
  });

  it('rejects Git algorithm and digest length mismatches', () => {
    const mismatch = changed((draft) => {
      at(draft.gitObservations, 0).commit.digest = 'a'.repeat(64);
    });
    const uppercase = changed((draft) => {
      at(draft.gitObservations, 0).blobObject = {
        algorithm: 'sha256',
        digest: 'B'.repeat(64),
      };
    });

    expectFailure(mismatch, 'invalid_git_identity');
    expectFailure(uppercase, 'invalid_git_identity');
  });

  it('requires a git_file capture to carry at least one exact Git observation', () => {
    const capture = changed((draft) => {
      draft.gitObservations = [];
    });

    expectFailure(capture, 'invalid_git_identity');
  });

  it('slices Chinese and Emoji by Unicode code point rather than UTF-16 unit', () => {
    const emojiOnly = changed((draft) => {
      const fragment = at(draft.structure.fragments, 0);
      fragment.codePointRange = {start: 1, end: 2};
      fragment.selectedTextSha256 = sha256Text('😀');
    });

    expect(Array.from(NORMALIZED_TEXT)).toHaveLength(7);
    expect('😀').toHaveLength(2);
    expectValidated(emojiOnly);
  });

  it('hashes the exact combining sequence without Unicode normalization', () => {
    const decomposed = 'e\u0301';
    const composed = 'é';
    const capture = changed((draft) => {
      const fragment = at(draft.structure.fragments, 0);
      fragment.codePointRange = {start: 2, end: 4};
      fragment.selectedTextSha256 = sha256Text(decomposed);
    });

    expect(sha256Text(decomposed)).not.toBe(sha256Text(composed));
    expectValidated(capture);
  });

  it('rejects empty, fractional, and out-of-bounds code-point ranges', () => {
    const captures = [
      changed((draft) => {
        at(draft.structure.fragments, 0).codePointRange = {start: 2, end: 2};
      }),
      changed((draft) => {
        at(draft.structure.nodes, 0).codePointRange = {start: 0.5, end: 7};
      }),
      changed((draft) => {
        at(draft.structure.fragments, 0).codePointRange = {start: 1, end: 8};
      }),
    ];

    for (const capture of captures) {
      expectFailure(capture, 'invalid_range');
    }
  });

  it('rejects a Fragment whose range escapes its bound node', () => {
    const capture = changed((draft) => {
      at(draft.structure.fragments, 0).codePointRange = {start: 0, end: 4};
      at(draft.structure.fragments, 0).selectedTextSha256 = sha256Text('甲😀é');
    });

    expectFailure(capture, 'invalid_range');
  });

  it('accepts one-based inclusive single-line and multi-line ranges', () => {
    const capture = changed((draft) => {
      at(draft.structure.nodes, 0).lineRange = {start: 1, end: 2};
      at(draft.structure.nodes, 1).lineRange = {start: 1, end: 1};
      at(draft.structure.fragments, 0).lineRange = {start: 1, end: 1};
    });

    expectValidated(capture);
  });

  it('rejects zero, reversed, and half-present line ranges', () => {
    const captures = [
      {
        input: changed((draft) => {
          at(draft.structure.nodes, 0).lineRange = {start: 0, end: 1};
        }),
        code: 'invalid_line_range' as const,
      },
      {
        input: changed((draft) => {
          at(draft.structure.nodes, 0).lineRange = {start: 3, end: 2};
        }),
        code: 'invalid_line_range' as const,
      },
      {
        input: changed((draft) => {
          at(draft.structure.nodes, 0).lineRange = {
            start: 1,
          } as Mutable<LineRange>;
        }),
        code: 'invalid_shape' as const,
      },
    ];

    for (const capture of captures) {
      expectFailure(capture.input, capture.code);
    }
  });

  it.each([
    [
      {start: 0, end: 1},
      {start: 1, end: 1},
    ],
    [
      {start: 0, end: 2},
      {start: 1, end: 1},
    ],
    [
      {start: 0, end: 3},
      {start: 1, end: 2},
    ],
    [
      {start: 2, end: 3},
      {start: 2, end: 2},
    ],
  ] as const)(
    'derives A\\nB code-point range %o as inclusive line range %o',
    (codePointRange, lineRange) => {
      expectValidated(
        captureForRange('A\nB', codePointRange, lineRange, lineRange),
      );
    },
  );

  it('counts only LF for line derivation in CRLF text', () => {
    expectValidated(
      captureForRange(
        'A\r\nB',
        {start: 0, end: 3},
        {start: 1, end: 1},
        {start: 1, end: 1},
      ),
    );
    expectValidated(
      captureForRange(
        'A\r\nB',
        {start: 3, end: 4},
        {start: 2, end: 2},
        {start: 2, end: 2},
      ),
    );
  });

  it('rejects out-of-document and selection-inconsistent line declarations', () => {
    const lineNinetyNine = captureForRange(
      'A\nB',
      {start: 0, end: 3},
      {start: 99, end: 99},
      {start: 1, end: 2},
    );
    const wrongEndLine = captureForRange(
      'A\nB',
      {start: 0, end: 3},
      {start: 1, end: 1},
      {start: 1, end: 2},
    );
    const fragmentContradiction = captureForRange(
      'A\nB',
      {start: 0, end: 3},
      {start: 1, end: 2},
      {start: 2, end: 2},
    );

    for (const capture of [
      lineNinetyNine,
      wrongEndLine,
      fragmentContradiction,
    ]) {
      expectFailure(capture, 'invalid_line_range');
    }
  });

  it('allows both Node and Fragment line ranges to be absent', () => {
    expectValidated(
      captureForRange('single line', {start: 0, end: 6}, undefined, undefined),
    );
  });

  it('requires exactly one deterministic root position', () => {
    const capture = changed((draft) => {
      const second = at(draft.structure.nodes, 2);
      delete second.parentNodeId;
      second.siblingOrdinal = 0;
    });

    expectFailure(capture, 'duplicate_identity');
  });

  it('rejects missing and self parents', () => {
    const missing = changed((draft) => {
      at(draft.structure.nodes, 1).parentNodeId = uuid(999);
    });
    const self = changed((draft) => {
      at(draft.structure.nodes, 1).parentNodeId = TEXT_NODE_ID;
    });

    expectFailure(missing, 'invalid_tree');
    expectFailure(self, 'invalid_tree');
  });

  it('rejects duplicate sibling ordinals including null-parent identity', () => {
    const capture = changed((draft) => {
      at(draft.structure.nodes, 2).siblingOrdinal = 0;
    });

    expectFailure(capture, 'duplicate_identity');
  });

  it('rejects a cycle even when another valid root remains', () => {
    const capture = changed((draft) => {
      at(draft.structure.nodes, 1).parentNodeId = SECOND_NODE_ID;
      at(draft.structure.nodes, 2).parentNodeId = TEXT_NODE_ID;
    });

    expectFailure(capture, 'invalid_tree');
  });

  it('fails closed on workspace mixing at every evidence layer', () => {
    const captures = [
      changed((draft) => {
        at(draft.blobs, 0).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        draft.resource.workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        required(draft.gitResource).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        draft.snapshot.workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        required(draft.snapshot.rawBlob).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        at(draft.gitObservations, 0).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        draft.structure.workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        draft.structure.textBlob.workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        at(draft.structure.nodes, 0).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        at(draft.structure.fragments, 0).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        at(draft.structure.fragments, 0).textBlob.workspaceId =
          OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        at(draft.mediaAssets, 0).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        const asset = at(draft.mediaAssets, 0);
        if (asset.storageMode !== 'stored_blob') {
          throw new Error('Synthetic fixture invariant failed.');
        }
        asset.blob.workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        at(draft.mediaUsages, 0).workspaceId = OTHER_WORKSPACE_ID;
      }),
      changed((draft) => {
        const original = at(draft.mediaUsages, 0);
        draft.mediaUsages.push({
          ...original,
          mediaUsageId: uuid(61),
          supersededUsage: {
            ...usageReference(original),
            workspaceId: OTHER_WORKSPACE_ID,
          },
        });
      }),
    ];

    for (const capture of captures) {
      expect(validateEvidenceCapture(capture)).toMatchObject({
        status: 'validation_failed',
      });
    }
  });

  it('binds Snapshot raw bytes by Blob ID, digest, and byte length', () => {
    const captures = [
      changed((draft) => {
        required(draft.snapshot.rawBlob).blobId = uuid(404);
      }),
      changed((draft) => {
        required(draft.snapshot.rawBlob).digest = 'f'.repeat(64);
      }),
      changed((draft) => {
        required(draft.snapshot.rawBlob).byteLength += 1;
      }),
    ];

    for (const capture of captures) {
      expectFailure(capture, 'blob_identity_mismatch');
    }
  });

  it('binds the normalized text and Fragment to the exact same Blob', () => {
    const structureMismatch = changed((draft) => {
      draft.structure.textBlob.byteLength += 1;
    });
    const fragmentMismatch = changed((draft) => {
      at(draft.structure.fragments, 0).textBlob.blobId = RAW_BLOB_ID;
    });

    expectFailure(structureMismatch, 'blob_identity_mismatch');
    expectFailure(fragmentMismatch, 'blob_identity_mismatch');
  });

  it('hashes all normalized UTF-8 bytes, including text outside every Fragment', () => {
    const capture = changed((draft) => {
      draft.structure.normalizedTextUtf8 = encoder.encode('甲😀e\u0301乙\n另');
    });

    expect(capture.structure.normalizedTextUtf8.byteLength).toBe(
      TEXT_BYTES.byteLength,
    );
    expectFailure(capture, 'blob_identity_mismatch');
  });

  it('accepts an exact ordinary whole-view Uint8Array', () => {
    const capture = changed((draft) => {
      draft.structure.normalizedTextUtf8 = Uint8Array.from(TEXT_BYTES);
    });

    expect(capture.structure.normalizedTextUtf8.byteOffset).toBe(0);
    expect(capture.structure.normalizedTextUtf8.byteLength).toBe(
      capture.structure.normalizedTextUtf8.buffer.byteLength,
    );
    expectValidated(capture);
  });

  it('rejects nonzero-offset and larger-backing partial byte views', () => {
    const offsetBacking = new Uint8Array(TEXT_BYTES.byteLength + 2);
    offsetBacking.set(TEXT_BYTES, 1);
    const offsetView = offsetBacking.subarray(1, 1 + TEXT_BYTES.byteLength);
    const largerBacking = new Uint8Array(TEXT_BYTES.byteLength + 1);
    largerBacking.set(TEXT_BYTES);
    const prefixView = new Uint8Array(
      largerBacking.buffer,
      0,
      TEXT_BYTES.byteLength,
    );

    for (const view of [offsetView, prefixView]) {
      const capture = changed((draft) => {
        draft.structure.normalizedTextUtf8 = view;
      });
      expect(validateEvidenceCapture(capture)).toEqual({
        status: 'validation_failed',
        issue: {
          code: 'invalid_utf8',
          path: 'structure.normalizedTextUtf8',
        },
      });
    }
  });

  it('rejects SharedArrayBuffer-backed and Proxy byte views', () => {
    const shared = new SharedArrayBuffer(TEXT_BYTES.byteLength);
    const sharedView = new Uint8Array(shared);
    sharedView.set(TEXT_BYTES);
    const proxyView = new Proxy(Uint8Array.from(TEXT_BYTES), {});

    for (const view of [sharedView, proxyView]) {
      const capture = changed((draft) => {
        draft.structure.normalizedTextUtf8 = view;
      });
      const result = validateEvidenceCapture(capture);
      expect(result).toEqual({
        status: 'validation_failed',
        issue: {
          code: 'invalid_utf8',
          path: 'structure.normalizedTextUtf8',
        },
      });
      expect(JSON.stringify(result)).not.toContain(NORMALIZED_TEXT);
    }
  });

  it('rejects resizable and detached ArrayBuffer views', () => {
    const ResizableArrayBuffer = ArrayBuffer as unknown as new (
      byteLength: number,
      options: Readonly<{maxByteLength: number}>,
    ) => ArrayBuffer;
    const resizable = new ResizableArrayBuffer(TEXT_BYTES.byteLength, {
      maxByteLength: TEXT_BYTES.byteLength + 1,
    });
    const resizableView = new Uint8Array(resizable);
    resizableView.set(TEXT_BYTES);
    const detachedView = Uint8Array.from(TEXT_BYTES);
    structuredClone(detachedView.buffer, {transfer: [detachedView.buffer]});

    for (const view of [resizableView, detachedView]) {
      const capture = changed((draft) => {
        draft.structure.normalizedTextUtf8 = view;
      });
      expect(validateEvidenceCapture(capture)).toEqual({
        status: 'validation_failed',
        issue: {
          code: 'invalid_utf8',
          path: 'structure.normalizedTextUtf8',
        },
      });
    }
  });

  it('rejects invalid UTF-8 even when its exact Blob digest and length match', () => {
    const invalidBytes = Uint8Array.from([0xc3, 0x28]);
    const capture = changed((draft) => {
      replaceTextBlob(draft, invalidBytes);
    });

    expectFailure(capture, 'invalid_utf8');
  });

  it('rejects a selected-text digest drift', () => {
    const capture = changed((draft) => {
      at(draft.structure.fragments, 0).selectedTextSha256 = 'f'.repeat(64);
    });

    expectFailure(capture, 'fragment_hash_mismatch');
  });

  it('accepts stored and external media as visibly distinct modes', () => {
    expectValidated(validCapture());
  });

  it('rejects incomplete stored media and Blob-bearing external references', () => {
    const missingStoredBlob = changed((draft) => {
      const asset = at(draft.mediaAssets, 0);
      if (asset.storageMode !== 'stored_blob') {
        throw new Error('Synthetic fixture invariant failed.');
      }
      asset.blob = undefined as unknown as Mutable<ExactBlobIdentity>;
    });
    const externalWithBlob = changed((draft) => {
      const asset = at(draft.mediaAssets, 1) as Mutable<
        (typeof draft.mediaAssets)[number]
      > & {blob?: Mutable<ExactBlobIdentity>};
      asset.blob = exactBlob(at(draft.blobs, 2));
    });

    expectFailure(missingStoredBlob, 'invalid_media');
    expectFailure(externalWithBlob, 'invalid_media');
  });

  it('requires external URI and paired positive pixel dimensions', () => {
    const blankUri = changed((draft) => {
      const asset = at(draft.mediaAssets, 1);
      if (asset.storageMode !== 'external_reference') {
        throw new Error('Synthetic fixture invariant failed.');
      }
      asset.originalUri = ' ';
    });
    const partialDimensions = changed((draft) => {
      at(draft.mediaAssets, 0).dimensions = {
        width: 20,
        height: undefined as unknown as number,
      };
    });
    const nonPositiveDimensions = changed((draft) => {
      at(draft.mediaAssets, 0).dimensions = {width: 0, height: 10};
    });

    expectFailure(blankUri, 'invalid_structure');
    expectFailure(partialDimensions, 'invalid_shape');
    expectFailure(nonPositiveDimensions, 'invalid_media');
  });

  it('accepts every frozen media purpose and origin value', () => {
    for (const purpose of MEDIA_PURPOSES) {
      const capture = changed((draft) => {
        at(draft.mediaUsages, 0).purpose = purpose;
      });
      expectValidated(capture);
    }
    for (const purposeOrigin of MEDIA_PURPOSE_ORIGINS) {
      const capture = changed((draft) => {
        at(draft.mediaUsages, 0).purposeOrigin = purposeOrigin;
      });
      expectValidated(capture);
    }
  });

  it('allows optional AI confidence at both inclusive boundaries', () => {
    for (const confidence of [undefined, 0, 1]) {
      const capture = changed((draft) => {
        const usage = at(draft.mediaUsages, 0);
        usage.purposeOrigin = 'ai_inference';
        if (confidence === undefined) {
          delete usage.confidence;
        } else {
          usage.confidence = confidence;
        }
      });
      expectValidated(capture);
    }
  });

  it('rejects confidence for non-AI origins and values outside zero to one', () => {
    const captures = [
      changed((draft) => {
        at(draft.mediaUsages, 0).confidence = 0.5;
      }),
      ...[Number.NaN, -0.01, 1.01].map((confidence) =>
        changed((draft) => {
          const usage = at(draft.mediaUsages, 0);
          usage.purposeOrigin = 'ai_inference';
          usage.confidence = confidence;
        }),
      ),
    ];

    for (const capture of captures) {
      expectFailure(capture, 'invalid_confidence');
    }
  });

  it('accepts an append-only media correction at the same stable position', () => {
    const capture = changed((draft) => {
      const original = at(draft.mediaUsages, 0);
      draft.mediaUsages.push({
        ...original,
        mediaUsageId: uuid(61),
        mediaAssetId: EXTERNAL_ASSET_ID,
        purpose: 'example',
        purposeOrigin: 'user_confirmation',
        supersededUsage: usageReference(original),
      });
    });

    expectValidated(capture);
  });

  it('rejects media correction cycles and a changed superseded position', () => {
    const cycle = changed((draft) => {
      const first = at(draft.mediaUsages, 0);
      const second: Mutable<MediaUsageInput> = {
        ...first,
        mediaUsageId: uuid(61),
        supersededUsage: usageReference(first),
      };
      first.supersededUsage = usageReference(second);
      draft.mediaUsages.push(second);
    });
    const changedPosition = changed((draft) => {
      const first = at(draft.mediaUsages, 0);
      draft.mediaUsages.push({
        ...first,
        mediaUsageId: uuid(61),
        supersededUsage: {...usageReference(first), ordinal: 1},
      });
    });

    expectFailure(cycle, 'invalid_media');
    expectFailure(changedPosition, 'invalid_media');
  });

  it('rejects publication timezone or precision without an instant', () => {
    const timezoneOnly = changed((draft) => {
      draft.snapshot.publication = {
        sourceTimezone: 'UTC',
        inferred: false,
      };
    });
    const precisionOnly = changed((draft) => {
      draft.snapshot.publication = {precision: 'day', inferred: true};
    });

    expectFailure(timezoneOnly, 'invalid_publication');
    expectFailure(precisionOnly, 'invalid_publication');
  });

  it('rejects nonexistent calendar instants and invalid UTC offsets', () => {
    const captures = [
      changed((draft) => {
        draft.snapshot.capturedAt = '2040-02-30T00:00:00Z';
      }),
      changed((draft) => {
        at(draft.gitObservations, 0).observedAt = '2040-01-01T00:00:00+14:01';
      }),
      changed((draft) => {
        required(draft.snapshot.publication).instant = '2041-02-29T00:00:00Z';
      }),
    ];

    for (const capture of captures) {
      expectFailure(capture, 'invalid_timestamp');
    }
  });

  it.each([
    ['drive path with forward slashes', 'S:/synthetic/item'],
    ['drive path with backslashes', String.raw`S:\synthetic\item`],
    ['UNC path', String.raw`\\synthetic-host\share\item`],
    ['Windows rooted path', String.raw`\synthetic-root\item`],
    ['POSIX absolute path', '/synthetic/item'],
    ['leading traversal', '../synthetic/item'],
    ['embedded traversal', 'adapter:synthetic/../item'],
    ['backslash traversal', String.raw`adapter:synthetic\..\item`],
  ])('rejects a %s as resource.sourceKey', (_, sourceKey) => {
    const capture = changed((draft) => {
      draft.resource.sourceKey = sourceKey;
    });

    const result = validateEvidenceCapture(capture);
    expect(result).toEqual({
      status: 'validation_failed',
      issue: {code: 'invalid_resource', path: 'resource.sourceKey'},
    });
    expect(JSON.stringify(result)).not.toContain(sourceKey);
  });

  it.each([
    'synthetic-resource-key',
    'adapter:synthetic/item',
    'adapter.synthetic/item.v1',
  ])('accepts portable opaque resource.sourceKey %s', (sourceKey) => {
    const capture = changed((draft) => {
      draft.resource.sourceKey = sourceKey;
    });

    const result = validateEvidenceCapture(capture);
    expect(result).toMatchObject({
      status: 'validated',
      value: {resource: {sourceKey}},
    });
  });

  it('accepts path-shaped ordinary source text without changing its bytes', () => {
    const sourceText = String.raw`S:\synthetic\body\..\item and /synthetic/body`;
    const capture = captureForRange(
      sourceText,
      {start: 0, end: Array.from(sourceText).length},
      undefined,
      undefined,
    );
    const originalBytes = Array.from(capture.structure.normalizedTextUtf8);

    expectValidated(capture);
    expect(Array.from(capture.structure.normalizedTextUtf8)).toEqual(
      originalBytes,
    );
  });

  it('keeps canonical URI validation separate from source-key validation', () => {
    const validHttps = changed((draft) => {
      draft.resource.canonicalUri =
        'https://example.invalid/adapter/synthetic-item';
    });
    const fileUri = changed((draft) => {
      draft.resource.canonicalUri = 'file:///synthetic/item';
    });

    expectValidated(validHttps);
    expect(validateEvidenceCapture(fileUri)).toEqual({
      status: 'validation_failed',
      issue: {code: 'invalid_uri', path: 'resource.canonicalUri'},
    });
  });

  it('rejects local absolute and traversal Git paths without network access', () => {
    const validRelativePath = changed((draft) => {
      required(draft.gitResource).repositoryRelativePath =
        'docs/synthetic.folder/item.v1.md';
    });
    const paths = [
      'C:/synthetic/private.md',
      '/synthetic/file.md',
      '../file.md',
    ];

    expectValidated(validRelativePath);
    for (const path of paths) {
      const capture = changed((draft) => {
        required(draft.gitResource).repositoryRelativePath = path;
      });
      expectFailure(capture, 'invalid_resource');
    }
  });

  it('rejects duplicate stable and natural identities inside one payload', () => {
    const duplicateNodeId = changed((draft) => {
      at(draft.structure.nodes, 2).nodeId = TEXT_NODE_ID;
    });
    const duplicateObservation = changed((draft) => {
      const first = at(draft.gitObservations, 0);
      draft.gitObservations.push({...first, observationId: uuid(71)});
    });

    expectFailure(duplicateNodeId, 'duplicate_identity');
    expectFailure(duplicateObservation, 'duplicate_identity');
  });
});

describe('source-evidence replay resolution', () => {
  it('returns a new command when no prior command identity exists', () => {
    const result = resolveEvidenceCaptureReplay(undefined, validCapture());

    expect(result).toMatchObject({
      status: 'new_command',
      value: {commandIdempotencyKey: 'synthetic-command-0001'},
    });
  });

  it('replays equal immutable content only for the same workspace and key', () => {
    const existing = validCapture();
    const retry = changed((draft) => {
      draft.blobs.reverse();
      draft.structure.nodes.reverse();
      draft.mediaAssets.reverse();
    });

    expect(resolveEvidenceCaptureReplay(existing, retry)).toMatchObject({
      status: 'replayed',
      value: {commandIdempotencyKey: 'synthetic-command-0001'},
    });
  });

  it('preserves K2 as a new command even when all logical rows are reusable', () => {
    const existing = validCapture();
    const candidate = changed((draft) => {
      draft.commandIdempotencyKey = 'synthetic-command-0002';
    });

    expect(resolveEvidenceCaptureReplay(existing, candidate)).toMatchObject({
      status: 'new_command',
      value: {commandIdempotencyKey: 'synthetic-command-0002'},
    });
  });

  it('does not block a new key that reuses rows and appends an observation', () => {
    const existing = validCapture();
    const candidate = changed((draft) => {
      draft.commandIdempotencyKey = 'synthetic-command-0002';
      const previous = at(draft.gitObservations, 0);
      draft.gitObservations.push({
        ...previous,
        observationId: uuid(71),
        repositoryRef: 'refs/tags/synthetic-2',
        commit: {algorithm: 'sha1', digest: 'c'.repeat(40)},
      });
    });

    expect(resolveEvidenceCaptureReplay(existing, candidate)).toMatchObject({
      status: 'new_command',
      value: {
        commandIdempotencyKey: 'synthetic-command-0002',
        gitObservations: [{}, {}],
      },
    });
  });

  it('treats the same key in a different workspace as an independent command', () => {
    const existing = validCapture();
    const candidate = changed((draft) => {
      changeWorkspace(draft, OTHER_WORKSPACE_ID);
    });

    expect(resolveEvidenceCaptureReplay(existing, candidate)).toMatchObject({
      status: 'new_command',
      value: {
        workspaceId: OTHER_WORKSPACE_ID,
        commandIdempotencyKey: 'synthetic-command-0001',
      },
    });
  });

  it('returns a visible conflict instead of an update for changed immutable content', () => {
    const existing = validCapture();
    const conflict = changed((draft) => {
      draft.snapshot.canonicalContentSha256 = 'e'.repeat(64);
    });

    const result = resolveEvidenceCaptureReplay(existing, conflict);

    expect(result).toEqual({
      status: 'conflict',
      code: 'immutable_content_conflict',
      workspaceId: WORKSPACE_ID,
      commandIdempotencyKey: 'synthetic-command-0001',
    });
    expect(result).not.toHaveProperty('update');
  });

  it('does not compare whole graphs as commands after the command key changes', () => {
    const existing = validCapture();
    const candidate = changed((draft) => {
      draft.commandIdempotencyKey = 'synthetic-command-0002';
      draft.snapshot.canonicalContentSha256 = 'e'.repeat(64);
    });

    expect(resolveEvidenceCaptureReplay(existing, candidate)).toMatchObject({
      status: 'new_command',
      value: {commandIdempotencyKey: 'synthetic-command-0002'},
    });
  });
});

describe('immutable evidence record identity resolution', () => {
  it('resolves stable and natural lookups for the same immutable row as existing', () => {
    const existing = immutableRecord();

    const result = resolveImmutableEvidenceRecord(
      existing,
      structuredClone(existing),
      structuredClone(existing),
    );
    expect(result).toMatchObject({status: 'existing'});
    if (result.status !== 'existing') {
      throw new Error('Synthetic identity should resolve to the existing row.');
    }
    expect(result.value.stableId).toBe(existing.stableId);
  });

  it('returns the old stable ID for equal natural identity and content', () => {
    const existing = immutableRecord();
    const candidate = {
      ...existing,
      stableId: uuid(999),
    };

    const result = resolveImmutableEvidenceRecord(
      undefined,
      existing,
      candidate,
    );
    expect(result).toMatchObject({status: 'existing'});
    if (result.status !== 'existing') {
      throw new Error('Synthetic natural identity should reuse the old row.');
    }
    expect(result.value.stableId).toBe(existing.stableId);
  });

  it.each([
    {
      name: 'stable ID reused with a different natural identity',
      lookup: 'stable' as const,
      change: {
        naturalIdentity: ['different-natural-key'],
      },
    },
    {
      name: 'stable ID reused with different immutable content',
      lookup: 'stable' as const,
      change: {
        immutableContent: ['changed-content'],
      },
    },
    {
      name: 'natural identity reused with a new ID and changed content',
      lookup: 'natural' as const,
      change: {
        stableId: uuid(999),
        immutableContent: ['changed-content'],
      },
    },
    {
      name: 'both identities reused with changed immutable content',
      lookup: 'both' as const,
      change: {
        immutableContent: ['changed-content', 2],
      },
    },
  ] as const)('returns visible conflict when $name', ({change, lookup}) => {
    const existing = immutableRecord();
    const candidate = {...existing, ...change};
    const byStableId = lookup === 'natural' ? undefined : existing;
    const byNaturalIdentity = lookup === 'stable' ? undefined : existing;

    expect(
      resolveImmutableEvidenceRecord(byStableId, byNaturalIdentity, candidate),
    ).toMatchObject({
      status: 'conflict',
      code: 'immutable_content_conflict',
    });
  });

  it('treats out-of-scope lookup rows as no match', () => {
    const candidate = immutableRecord();
    const otherWorkspace = {
      ...candidate,
      workspaceId: OTHER_WORKSPACE_ID,
    };
    const otherKind = {...candidate, entityKind: 'fragment' as const};

    expect(
      resolveImmutableEvidenceRecord(otherWorkspace, otherKind, candidate),
    ).toMatchObject({status: 'insert'});
  });

  it.each([
    ['content matches the natural row', ['content-b']],
    ['content matches the stable row', ['content-a']],
  ] as const)(
    'rejects split stable/natural lookup identity when %s',
    (_name, candidateContent) => {
      const byStableId = {
        ...immutableRecord(),
        immutableContent: ['content-a'],
      };
      const byNaturalIdentity = {
        ...immutableRecord(),
        stableId: uuid(998),
        naturalIdentity: ['natural-b'],
        immutableContent: ['content-b'],
      };
      const candidate = {
        ...immutableRecord(),
        naturalIdentity: ['natural-b'],
        immutableContent: candidateContent,
      };

      expect(
        resolveImmutableEvidenceRecord(
          byStableId,
          byNaturalIdentity,
          candidate,
        ),
      ).toMatchObject({
        status: 'conflict',
        code: 'immutable_content_conflict',
      });
    },
  );

  it('inserts when stable and natural identities both have no lookup hit', () => {
    const candidate = {
      ...immutableRecord(),
      stableId: uuid(999),
      naturalIdentity: ['different-natural-key'],
    };
    expect(
      resolveImmutableEvidenceRecord(undefined, undefined, candidate),
    ).toMatchObject({status: 'insert'});
  });

  it('applies the closed decoder to identity helper inputs', () => {
    let getterCalls = 0;
    const candidate = immutableRecord() as unknown as Record<string, unknown>;
    Object.defineProperty(candidate, 'immutableContent', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return ['synthetic'];
      },
    });

    expect(
      resolveImmutableEvidenceRecord(undefined, undefined, candidate),
    ).toEqual({
      status: 'validation_failed',
      issue: {
        code: 'invalid_shape',
        path: 'immutableRecord.immutableContent',
      },
    });
    expect(getterCalls).toBe(0);
  });
});

function validCapture(): CaptureEvidenceInput {
  const rawBlob = blob(RAW_BLOB_ID, RAW_BYTES, 'text/plain');
  const textBlob = blob(TEXT_BLOB_ID, TEXT_BYTES, 'text/plain');
  const mediaBlob = blob(MEDIA_BLOB_ID, MEDIA_BYTES, 'image/png');
  return {
    workspaceId: WORKSPACE_ID,
    commandIdempotencyKey: 'synthetic-command-0001',
    blobs: [rawBlob, textBlob, mediaBlob],
    resource: {
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      resourceKind: 'git_file',
      sourceKey: 'synthetic-resource-key',
      canonicalUri: 'https://example.invalid/synthetic/resource',
    },
    gitResource: {
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      canonicalRepositoryUri: 'https://example.invalid/synthetic/repository',
      repositoryRelativePath: 'docs/synthetic.md',
    },
    snapshot: {
      workspaceId: WORKSPACE_ID,
      snapshotId: SNAPSHOT_ID,
      resourceId: RESOURCE_ID,
      rawSha256: rawBlob.digest,
      rawBlob: exactBlob(rawBlob),
      canonicalContentSha256: 'c'.repeat(64),
      canonicalizationVersion: 'synthetic-canonicalization-v1',
      mediaType: 'text/markdown',
      publication: {
        instant: '2040-01-02T00:00:00.000Z',
        sourceTimezone: 'UTC',
        precision: 'day',
        sourceText: 'synthetic-date-token',
        inferred: false,
      },
      capturedAt: '2040-01-03T04:05:06.000Z',
    },
    gitObservations: [
      {
        workspaceId: WORKSPACE_ID,
        observationId: uuid(70),
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        repositoryRef: 'refs/heads/synthetic',
        commit: {algorithm: 'sha1', digest: 'a'.repeat(40)},
        blobObject: {algorithm: 'sha256', digest: 'b'.repeat(64)},
        observedAt: '2040-01-03T04:05:06.000Z',
      },
    ],
    structure: {
      workspaceId: WORKSPACE_ID,
      structureId: STRUCTURE_ID,
      resourceId: RESOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      parserName: 'synthetic-markdown-parser',
      parserVersion: '1',
      textNormalizationVersion: 'synthetic-text-v1',
      textBlob: exactBlob(textBlob),
      structureSha256: 'd'.repeat(64),
      normalizedTextUtf8: Uint8Array.from(TEXT_BYTES),
      nodes: [
        {
          workspaceId: WORKSPACE_ID,
          resourceId: RESOURCE_ID,
          snapshotId: SNAPSHOT_ID,
          structureId: STRUCTURE_ID,
          nodeId: ROOT_NODE_ID,
          kind: 'document',
          siblingOrdinal: 0,
          codePointRange: {start: 0, end: 7},
          lineRange: {start: 1, end: 2},
        },
        {
          workspaceId: WORKSPACE_ID,
          resourceId: RESOURCE_ID,
          snapshotId: SNAPSHOT_ID,
          structureId: STRUCTURE_ID,
          nodeId: TEXT_NODE_ID,
          parentNodeId: ROOT_NODE_ID,
          kind: 'paragraph',
          siblingOrdinal: 0,
          codePointRange: {start: 1, end: 5},
          lineRange: {start: 1, end: 1},
        },
        {
          workspaceId: WORKSPACE_ID,
          resourceId: RESOURCE_ID,
          snapshotId: SNAPSHOT_ID,
          structureId: STRUCTURE_ID,
          nodeId: SECOND_NODE_ID,
          parentNodeId: ROOT_NODE_ID,
          kind: 'paragraph',
          siblingOrdinal: 1,
          codePointRange: {start: 5, end: 7},
          lineRange: {start: 1, end: 2},
        },
      ],
      fragments: [
        {
          workspaceId: WORKSPACE_ID,
          fragmentId: FRAGMENT_ID,
          resourceId: RESOURCE_ID,
          snapshotId: SNAPSHOT_ID,
          structureId: STRUCTURE_ID,
          nodeId: TEXT_NODE_ID,
          textBlob: exactBlob(textBlob),
          locatorKind: 'unicode_code_point_range',
          locatorVersion: 1,
          codePointRange: {start: 1, end: 4},
          lineRange: {start: 1, end: 1},
          selectedTextSha256: sha256Text('😀e\u0301'),
        },
      ],
    },
    mediaAssets: [
      {
        workspaceId: WORKSPACE_ID,
        mediaAssetId: STORED_ASSET_ID,
        storageMode: 'stored_blob',
        blob: exactBlob(mediaBlob),
        originalUri: 'https://example.invalid/synthetic/original.png',
        mediaType: 'image/png',
        dimensions: {width: 20, height: 10},
      },
      {
        workspaceId: WORKSPACE_ID,
        mediaAssetId: EXTERNAL_ASSET_ID,
        storageMode: 'external_reference',
        originalUri: 'https://example.invalid/synthetic/reference.png',
        mediaType: 'image/png',
      },
    ],
    mediaUsages: [
      {
        workspaceId: WORKSPACE_ID,
        mediaUsageId: MEDIA_USAGE_ID,
        mediaAssetId: STORED_ASSET_ID,
        resourceId: RESOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        structureId: STRUCTURE_ID,
        nodeId: TEXT_NODE_ID,
        ordinal: 0,
        purpose: 'screenshot',
        purposeOrigin: 'deterministic_parser',
      },
    ],
  };
}

function immutableRecord(): ImmutableEvidenceRecord {
  return {
    workspaceId: WORKSPACE_ID,
    entityKind: 'snapshot',
    stableId: SNAPSHOT_ID,
    naturalIdentity: [RESOURCE_ID, sha256(RAW_BYTES)],
    immutableContent: ['synthetic-canonicalization-v1', 'c'.repeat(64)],
  };
}

function captureForRange(
  text: string,
  codePointRange: Readonly<{start: number; end: number}>,
  nodeLineRange: Readonly<LineRange> | undefined,
  fragmentLineRange: Readonly<LineRange> | undefined,
): CaptureEvidenceInput {
  return changed((draft) => {
    replaceTextBlob(draft, encoder.encode(text));
    const root = at(draft.structure.nodes, 0);
    const fragment = at(draft.structure.fragments, 0);
    delete root.parentNodeId;
    root.siblingOrdinal = 0;
    root.codePointRange = {...codePointRange};
    if (nodeLineRange === undefined) {
      delete root.lineRange;
    } else {
      root.lineRange = {...nodeLineRange};
    }
    fragment.nodeId = root.nodeId;
    fragment.codePointRange = {...codePointRange};
    if (fragmentLineRange === undefined) {
      delete fragment.lineRange;
    } else {
      fragment.lineRange = {...fragmentLineRange};
    }
    fragment.selectedTextSha256 = sha256Text(
      Array.from(text).slice(codePointRange.start, codePointRange.end).join(''),
    );
    draft.structure.nodes = [root];
    draft.structure.fragments = [fragment];
    draft.mediaUsages = [];
  });
}

function changeWorkspace(
  draft: Mutable<CaptureEvidenceInput>,
  workspaceId: string,
): void {
  draft.workspaceId = workspaceId;
  for (const blobIdentity of draft.blobs) {
    blobIdentity.workspaceId = workspaceId;
  }
  draft.resource.workspaceId = workspaceId;
  required(draft.gitResource).workspaceId = workspaceId;
  draft.snapshot.workspaceId = workspaceId;
  required(draft.snapshot.rawBlob).workspaceId = workspaceId;
  for (const observation of draft.gitObservations) {
    observation.workspaceId = workspaceId;
  }
  draft.structure.workspaceId = workspaceId;
  draft.structure.textBlob.workspaceId = workspaceId;
  for (const node of draft.structure.nodes) {
    node.workspaceId = workspaceId;
  }
  for (const fragment of draft.structure.fragments) {
    fragment.workspaceId = workspaceId;
    fragment.textBlob.workspaceId = workspaceId;
  }
  for (const asset of draft.mediaAssets) {
    asset.workspaceId = workspaceId;
    if (asset.storageMode === 'stored_blob') {
      asset.blob.workspaceId = workspaceId;
    }
  }
  for (const usage of draft.mediaUsages) {
    usage.workspaceId = workspaceId;
    if (usage.supersededUsage !== undefined) {
      usage.supersededUsage.workspaceId = workspaceId;
    }
  }
}

function changed(
  mutate: (draft: Mutable<CaptureEvidenceInput>) => void,
): CaptureEvidenceInput {
  const draft = structuredClone(
    validCapture(),
  ) as Mutable<CaptureEvidenceInput>;
  mutate(draft);
  return draft;
}

function replaceTextBlob(
  draft: Mutable<CaptureEvidenceInput>,
  bytes: Uint8Array,
): void {
  const identity = blob(TEXT_BLOB_ID, bytes, 'text/plain');
  draft.blobs[1] = {...identity};
  draft.structure.textBlob = exactBlob(identity);
  draft.structure.normalizedTextUtf8 = Uint8Array.from(bytes);
  at(draft.structure.fragments, 0).textBlob = exactBlob(identity);
}

function usageReference(
  usage: Mutable<MediaUsageInput>,
): NonNullable<Mutable<MediaUsageInput>['supersededUsage']> {
  return {
    workspaceId: usage.workspaceId,
    mediaUsageId: usage.mediaUsageId,
    resourceId: usage.resourceId,
    snapshotId: usage.snapshotId,
    structureId: usage.structureId,
    nodeId: usage.nodeId,
    ordinal: usage.ordinal,
  };
}

function blob(
  blobId: string,
  bytes: Uint8Array,
  mediaType: string,
): EvidenceBlobInput {
  return {
    workspaceId: WORKSPACE_ID,
    blobId,
    digestAlgorithm: 'sha256',
    digest: sha256(bytes),
    byteLength: bytes.byteLength,
    mediaType,
  };
}

function exactBlob(blobIdentity: EvidenceBlobInput): ExactBlobIdentity {
  return {
    workspaceId: blobIdentity.workspaceId,
    blobId: blobIdentity.blobId,
    digestAlgorithm: blobIdentity.digestAlgorithm,
    digest: blobIdentity.digest,
    byteLength: blobIdentity.byteLength,
  };
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function expectDeeplyFrozen(
  value: unknown,
  seen = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }
  seen.add(value);
  expect(value).not.toBeInstanceOf(Map);
  expect(value).not.toBeInstanceOf(Set);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    expectDeeplyFrozen(child, seen);
  }
}

function sha256Text(value: string): string {
  return sha256(encoder.encode(value));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectValidated(input: CaptureEvidenceInput): void {
  expect(validateEvidenceCapture(input)).toMatchObject({status: 'validated'});
}

function expectFailure(
  input: CaptureEvidenceInput,
  code: EvidenceValidationCode,
): void {
  expect(validateEvidenceCapture(input)).toMatchObject({
    status: 'validation_failed',
    issue: {code},
  });
}

function at<Value>(values: readonly Value[], index: number): Value {
  const value = values[index];
  if (value === undefined) {
    throw new Error('Synthetic fixture index is missing.');
  }
  return value;
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) {
    throw new Error('Synthetic fixture value is missing.');
  }
  return value;
}

function uuid(sequence: number): string {
  return `00000000-0000-0000-0000-${sequence.toString(16).padStart(12, '0')}`;
}
