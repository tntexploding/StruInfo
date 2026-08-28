import {createHash} from 'node:crypto';
import {isDeepStrictEqual, TextDecoder} from 'node:util';

import type {
  DocumentNodeInput,
  EvidenceBlobInput,
  ExactBlobIdentity,
  ExternalMediaAssetInput,
  FragmentInput,
  MediaUsageInput,
} from '../evidence_contract.js';
import {
  copyCheckedByteView,
  decodeMaterializeMarkdownEvidenceInput,
  type DecodedParsedMarkdownDocument,
} from './closed_markdown_input.js';
import {
  MARKDOWN_BUDGETS,
  MARKDOWN_PARSER_VERSION,
  MARKDOWN_PROFILES,
  MARKDOWN_STRUCTURE_PROJECTION_VERSION,
  MARKDOWN_TEXT_NORMALIZATION_VERSION,
  parserNameForProfile,
  type MaterializeMarkdownEvidenceResult,
  type MaterializedMarkdownEvidence,
  type ParsedMarkdownDocument,
} from './markdown_contract.js';
import {
  MarkdownFault,
  freezeMarkdownMetadata,
  markdownFail,
} from './markdown_failure.js';
import {
  SHA256_PATTERN,
  UUID_PATTERN,
  deriveDocumentNodeId,
  deriveDocumentStructureId,
  deriveEvidenceBlobId,
  deriveFragmentId,
  deriveMediaAssetId,
  deriveMediaUsageId,
} from './markdown_identity.js';
import {parseMarkdownStructure} from './markdown_parser.js';
import {indexMarkdownText} from './markdown_line_index.js';
import {computeMarkdownStructureSha256WithTextIndex} from './markdown_projection.js';

const fatalDecoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});

export function materializeMarkdownEvidence(
  input: unknown,
): MaterializeMarkdownEvidenceResult {
  try {
    const decoded = decodeMaterializeMarkdownEvidenceInput(input);
    if (decoded.sourceUtf8.byteLength > MARKDOWN_BUDGETS.sourceBytes) {
      markdownFail('limit_exceeded', '$.sourceUtf8', {
        budget: 'source_bytes',
      });
    }
    const sourceBytes = copyCheckedByteView(decoded.sourceUtf8);
    validateRawSourceBinding(decoded.parsed, sourceBytes);
    validateSnapshotBinding(decoded.parsed, decoded.snapshot);
    validateParsedIdentity(decoded.parsed);
    const normalizedBytes = copyCheckedByteView(
      decoded.parsed.normalizedTextUtf8,
    );
    if (
      normalizedBytes.byteLength !== decoded.parsed.normalizedTextByteLength ||
      normalizedBytes.byteLength > MARKDOWN_BUDGETS.sourceBytes ||
      sha256Bytes(normalizedBytes) !== decoded.parsed.normalizedTextSha256
    ) {
      markdownFail('parsed_result_mismatch', '$');
    }
    let normalizedText: string;
    try {
      normalizedText = fatalDecoder.decode(normalizedBytes);
    } catch {
      markdownFail('parsed_result_mismatch', '$');
    }
    const calculatedStructureHash = computeMarkdownStructureSha256WithTextIndex(
      projectionSource(decoded.parsed),
      indexMarkdownText(normalizedText),
    );
    if (calculatedStructureHash !== decoded.parsed.structureSha256) {
      markdownFail('structure_hash_mismatch', '$.structureSha256');
    }
    const replay = parseMarkdownStructure({
      workspaceId: decoded.parsed.workspaceId,
      resourceId: decoded.parsed.resourceId,
      snapshotId: decoded.parsed.snapshotId,
      rawBlob: decoded.parsed.rawBlob,
      profile: decoded.parsed.profile,
      sourceUtf8: Uint8Array.from(sourceBytes),
      ...(decoded.parsed.documentBaseUri === undefined
        ? {}
        : {documentBaseUri: decoded.parsed.documentBaseUri}),
    });
    if (replay.status === 'rejected') {
      throw new MarkdownFault(
        replay.issue.code,
        replay.issue.path,
        replay.issue.range === undefined && replay.issue.budget === undefined
          ? undefined
          : {
              ...(replay.issue.range === undefined
                ? {}
                : {range: replay.issue.range}),
              ...(replay.issue.budget === undefined
                ? {}
                : {budget: replay.issue.budget}),
            },
      );
    }
    const suppliedParsed = decodedParsedValue(decoded.parsed, normalizedBytes);
    if (!isDeepStrictEqual(suppliedParsed, replay.value)) {
      markdownFail('parsed_result_mismatch', '$');
    }
    const value = createMaterializedValue(replay.value);
    return Object.freeze({
      status: 'materialized' as const,
      value: freezeMarkdownMetadata(value),
    });
  } catch (error) {
    const issue =
      error instanceof MarkdownFault
        ? error.issue
        : Object.freeze({
            code: 'internal_parser_failure' as const,
            path: '$.sourceUtf8',
          });
    return Object.freeze({status: 'rejected' as const, issue});
  }
}

function validateRawSourceBinding(
  parsed: Readonly<DecodedParsedMarkdownDocument>,
  sourceBytes: Uint8Array,
): void {
  const rawBlob = parsed.rawBlob;
  if (
    !UUID_PATTERN.test(parsed.workspaceId) ||
    !UUID_PATTERN.test(parsed.resourceId) ||
    !UUID_PATTERN.test(parsed.snapshotId) ||
    rawBlob.workspaceId !== parsed.workspaceId ||
    !UUID_PATTERN.test(rawBlob.blobId) ||
    runtimeDigestAlgorithm(rawBlob) !== 'sha256' ||
    !SHA256_PATTERN.test(rawBlob.digest) ||
    !Number.isSafeInteger(rawBlob.byteLength) ||
    rawBlob.byteLength < 0 ||
    rawBlob.byteLength !== sourceBytes.byteLength ||
    rawBlob.digest !== sha256Bytes(sourceBytes) ||
    rawBlob.blobId !== deriveEvidenceBlobId(parsed.workspaceId, rawBlob.digest)
  ) {
    markdownFail('invalid_source_identity', '$');
  }
}

function validateSnapshotBinding(
  parsed: Readonly<DecodedParsedMarkdownDocument>,
  snapshot: ReturnType<
    typeof decodeMaterializeMarkdownEvidenceInput
  >['snapshot'],
): void {
  if (
    snapshot.workspaceId !== parsed.workspaceId ||
    snapshot.resourceId !== parsed.resourceId ||
    snapshot.snapshotId !== parsed.snapshotId ||
    snapshot.rawBlob === undefined ||
    !exactBlobEqual(snapshot.rawBlob, parsed.rawBlob) ||
    snapshot.rawSha256 !== parsed.rawBlob.digest ||
    snapshot.canonicalContentSha256 !== parsed.normalizedTextSha256 ||
    snapshot.canonicalizationVersion !== MARKDOWN_TEXT_NORMALIZATION_VERSION
  ) {
    markdownFail('invalid_source_identity', '$');
  }
}

function validateParsedIdentity(
  parsed: Readonly<DecodedParsedMarkdownDocument>,
): void {
  if (parsed.documentBaseUri !== undefined) {
    try {
      const uri = new URL(parsed.documentBaseUri);
      if (
        (uri.protocol !== 'http:' && uri.protocol !== 'https:') ||
        uri.hostname === '' ||
        uri.username !== '' ||
        uri.password !== '' ||
        uri.hash !== '' ||
        uri.href !== parsed.documentBaseUri
      ) {
        markdownFail('invalid_base_uri', '$.documentBaseUri');
      }
    } catch (error) {
      if (error instanceof MarkdownFault) {
        throw error;
      }
      markdownFail('invalid_base_uri', '$.documentBaseUri');
    }
  }
  if (
    !MARKDOWN_PROFILES.some((profile) => profile === parsed.profile) ||
    parsed.parserName !== parserNameForProfile(parsed.profile) ||
    runtimeParsedField(parsed, 'parserVersion') !== MARKDOWN_PARSER_VERSION ||
    runtimeParsedField(parsed, 'textNormalizationVersion') !==
      MARKDOWN_TEXT_NORMALIZATION_VERSION ||
    runtimeParsedField(parsed, 'structureProjectionVersion') !==
      MARKDOWN_STRUCTURE_PROJECTION_VERSION ||
    !SHA256_PATTERN.test(parsed.normalizedTextSha256) ||
    !SHA256_PATTERN.test(parsed.structureSha256) ||
    !Number.isSafeInteger(parsed.normalizedTextByteLength) ||
    parsed.normalizedTextByteLength < 0
  ) {
    markdownFail('parsed_result_mismatch', '$');
  }
}

function projectionSource(
  parsed: Readonly<DecodedParsedMarkdownDocument>,
): Parameters<typeof computeMarkdownStructureSha256WithTextIndex>[0] {
  return {
    parserName: parsed.parserName,
    parserVersion: parsed.parserVersion,
    textNormalizationVersion: parsed.textNormalizationVersion,
    normalizedTextSha256: parsed.normalizedTextSha256,
    normalizedTextByteLength: parsed.normalizedTextByteLength,
    nodes: parsed.nodes,
    fragments: parsed.fragments,
    intakeTargetNodeKeys: parsed.intakeTargetNodeKeys,
  };
}

function decodedParsedValue(
  parsed: Readonly<DecodedParsedMarkdownDocument>,
  normalizedBytes: Uint8Array,
): ParsedMarkdownDocument {
  return {
    workspaceId: parsed.workspaceId,
    resourceId: parsed.resourceId,
    snapshotId: parsed.snapshotId,
    rawBlob: parsed.rawBlob,
    profile: parsed.profile,
    parserName: parsed.parserName,
    parserVersion: parsed.parserVersion,
    textNormalizationVersion: parsed.textNormalizationVersion,
    structureProjectionVersion: parsed.structureProjectionVersion,
    ...(parsed.documentBaseUri === undefined
      ? {}
      : {documentBaseUri: parsed.documentBaseUri}),
    normalizedTextUtf8: normalizedBytes,
    normalizedTextSha256: parsed.normalizedTextSha256,
    normalizedTextByteLength: parsed.normalizedTextByteLength,
    structureSha256: parsed.structureSha256,
    nodes: parsed.nodes,
    fragments: parsed.fragments,
    intakeTargetNodeKeys: parsed.intakeTargetNodeKeys,
    links: parsed.links,
    media: parsed.media,
    diagnostics: parsed.diagnostics,
  };
}

function createMaterializedValue(
  parsed: Readonly<ParsedMarkdownDocument>,
): MaterializedMarkdownEvidence {
  const textBlob: EvidenceBlobInput = {
    workspaceId: parsed.workspaceId,
    blobId: deriveEvidenceBlobId(
      parsed.workspaceId,
      parsed.normalizedTextSha256,
    ),
    digestAlgorithm: 'sha256',
    digest: parsed.normalizedTextSha256,
    byteLength: parsed.normalizedTextByteLength,
  };
  const structureId = deriveDocumentStructureId(
    parsed.snapshotId,
    parsed.parserName,
    parsed.parserVersion,
    parsed.textNormalizationVersion,
    parsed.structureSha256,
  );
  const nodeIdByLocalKey = new Map(
    parsed.nodes.map((node) => [
      node.localKey,
      deriveDocumentNodeId(structureId, node.localKey),
    ]),
  );
  const nodes: readonly Readonly<DocumentNodeInput>[] = parsed.nodes.map(
    (node) => ({
      workspaceId: parsed.workspaceId,
      resourceId: parsed.resourceId,
      snapshotId: parsed.snapshotId,
      structureId,
      nodeId: requiredMappedId(nodeIdByLocalKey, node.localKey),
      ...(node.parentLocalKey === undefined
        ? {}
        : {
            parentNodeId: requiredMappedId(
              nodeIdByLocalKey,
              node.parentLocalKey,
            ),
          }),
      kind: node.kind,
      siblingOrdinal: node.siblingOrdinal,
      codePointRange: node.codePointRange,
      lineRange: node.lineRange,
    }),
  );
  const fragments: readonly Readonly<FragmentInput>[] = parsed.fragments.map(
    (fragment) => ({
      workspaceId: parsed.workspaceId,
      fragmentId: deriveFragmentId(structureId, fragment.localKey),
      resourceId: parsed.resourceId,
      snapshotId: parsed.snapshotId,
      structureId,
      nodeId: requiredMappedId(nodeIdByLocalKey, fragment.nodeLocalKey),
      textBlob,
      locatorKind: 'unicode_code_point_range',
      locatorVersion: 1,
      codePointRange: fragment.codePointRange,
      lineRange: fragment.lineRange,
      selectedTextSha256: fragment.selectedTextSha256,
    }),
  );
  const assetByUri = new Map<
    string,
    Readonly<{localKey: string; mediaAssetId: string}>
  >();
  const mediaAssets: ExternalMediaAssetInput[] = [];
  for (const media of parsed.media) {
    if (assetByUri.has(media.resolvedUri)) {
      continue;
    }
    const localKey = `a/${String(assetByUri.size)}`;
    const mediaAssetId = deriveMediaAssetId(structureId, localKey);
    assetByUri.set(media.resolvedUri, {localKey, mediaAssetId});
    mediaAssets.push({
      workspaceId: parsed.workspaceId,
      mediaAssetId,
      storageMode: 'external_reference',
      originalUri: media.resolvedUri,
    });
  }
  const mediaUsages: MediaUsageInput[] = parsed.media.map((media) => {
    const asset = assetByUri.get(media.resolvedUri);
    if (asset === undefined) {
      markdownFail('parsed_result_mismatch', '$');
    }
    const usageLocalKey = `u/${media.imageNodeLocalKey}/0`;
    return {
      workspaceId: parsed.workspaceId,
      mediaUsageId: deriveMediaUsageId(structureId, usageLocalKey),
      mediaAssetId: asset.mediaAssetId,
      resourceId: parsed.resourceId,
      snapshotId: parsed.snapshotId,
      structureId,
      nodeId: requiredMappedId(nodeIdByLocalKey, media.imageNodeLocalKey),
      ordinal: 0,
      purpose: media.purpose,
      purposeOrigin: media.purposeOrigin,
    };
  });
  return {
    textBlob,
    structure: {
      workspaceId: parsed.workspaceId,
      structureId,
      resourceId: parsed.resourceId,
      snapshotId: parsed.snapshotId,
      parserName: parsed.parserName,
      parserVersion: parsed.parserVersion,
      textNormalizationVersion: parsed.textNormalizationVersion,
      textBlob,
      structureSha256: parsed.structureSha256,
      normalizedTextUtf8: Uint8Array.from(parsed.normalizedTextUtf8),
      nodes,
      fragments,
    },
    mediaAssets,
    mediaUsages,
  };
}

function exactBlobEqual(
  left: Readonly<ExactBlobIdentity>,
  right: Readonly<ExactBlobIdentity>,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.blobId === right.blobId &&
    runtimeDigestAlgorithm(left) === runtimeDigestAlgorithm(right) &&
    left.digest === right.digest &&
    left.byteLength === right.byteLength
  );
}

function requiredMappedId(
  mapping: ReadonlyMap<string, string>,
  key: string,
): string {
  const value = mapping.get(key);
  if (value === undefined) {
    markdownFail('parsed_result_mismatch', '$');
  }
  return value;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function runtimeDigestAlgorithm(
  value: Readonly<{digestAlgorithm: string}>,
): unknown {
  return (value as unknown as Readonly<{digestAlgorithm?: unknown}>)
    .digestAlgorithm;
}

function runtimeParsedField(
  parsed: Readonly<DecodedParsedMarkdownDocument>,
  field:
    'parserVersion' | 'textNormalizationVersion' | 'structureProjectionVersion',
): unknown {
  return (parsed as unknown as Readonly<Record<string, unknown>>)[field];
}
