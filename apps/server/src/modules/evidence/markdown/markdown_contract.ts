import type {
  CodePointRange,
  DocumentNodeKind,
  DocumentStructureInput,
  EvidenceBlobInput,
  ExactBlobIdentity,
  ExternalMediaAssetInput,
  LineRange,
  MediaPurpose,
  MediaPurposeOrigin,
  MediaUsageInput,
  SnapshotInput,
} from '../evidence_contract.js';

export const MARKDOWN_PROFILES = ['commonmark-v1', 'ruanyf-weekly-v1'] as const;
export type MarkdownProfile = (typeof MARKDOWN_PROFILES)[number];

export const MARKDOWN_PARSER_NAMES = [
  'struinfo-commonmark',
  'struinfo-commonmark/ruanyf-weekly',
] as const;
export type MarkdownParserName = (typeof MARKDOWN_PARSER_NAMES)[number];

export const MARKDOWN_PARSER_VERSION = '1' as const;
export const MARKDOWN_TEXT_NORMALIZATION_VERSION = 'utf8-lf-v1' as const;
export const MARKDOWN_STRUCTURE_PROJECTION_VERSION =
  'markdown-structure-v1' as const;

export const MARKDOWN_BUDGETS = Object.freeze({
  sourceBytes: 1_048_576,
  nodes: 2_500,
  fragments: 2_000,
  depth: 64,
  links: 10_000,
  media: 1_000,
  diagnostics: 10_000,
  canonicalStructureBytes: 16_777_216,
  canonicalJsonValues: 100_000,
});

export interface ParseMarkdownInput {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly rawBlob: Readonly<ExactBlobIdentity>;
  readonly profile: MarkdownProfile;
  readonly sourceUtf8: Uint8Array;
  readonly documentBaseUri?: string;
}

export interface ParsedSourceRange {
  readonly codePointRange: Readonly<CodePointRange>;
  readonly lineRange: Readonly<LineRange>;
}

export interface ParsedMarkdownNode extends ParsedSourceRange {
  readonly localKey: string;
  readonly parentLocalKey?: string;
  readonly kind: DocumentNodeKind;
  readonly siblingOrdinal: number;
}

export const PARSED_FRAGMENT_ROLES = [
  'document',
  'leaf',
  'intake_target',
] as const;
export type ParsedFragmentRole = (typeof PARSED_FRAGMENT_ROLES)[number];

export interface ParsedMarkdownFragment extends ParsedSourceRange {
  readonly localKey: string;
  readonly nodeLocalKey: string;
  readonly role: ParsedFragmentRole;
  readonly selectedTextSha256: string;
}

export type ParsedLinkResolution =
  | Readonly<{status: 'resolved'; uri: string}>
  | Readonly<{
      status: 'not_resolved';
      reason:
        | 'document_fragment'
        | 'relative_without_base'
        | 'unsupported_scheme'
        | 'credentials_not_allowed'
        | 'invalid_uri';
    }>;

export interface ParsedLinkReference extends ParsedSourceRange {
  readonly localKey: string;
  readonly nodeLocalKey: string;
  readonly ordinal: number;
  readonly rawDestination: string;
  readonly resolution: ParsedLinkResolution;
  readonly captureState: 'not_captured';
}

export interface ParsedMediaReference extends ParsedSourceRange {
  readonly localKey: string;
  readonly imageNodeLocalKey: string;
  readonly ordinal: number;
  readonly rawDestination: string;
  readonly resolvedUri: string;
  readonly purpose: MediaPurpose;
  readonly purposeOrigin: MediaPurposeOrigin;
}

export const MARKDOWN_DIAGNOSTIC_CODES = [
  'opaque_html_block',
  'inline_html',
  'link_definition_block',
] as const;
export type MarkdownDiagnosticCode = (typeof MARKDOWN_DIAGNOSTIC_CODES)[number];

export interface MarkdownDiagnostic extends ParsedSourceRange {
  readonly code: MarkdownDiagnosticCode;
}

export interface ParsedMarkdownDocument {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly rawBlob: Readonly<ExactBlobIdentity>;
  readonly profile: MarkdownProfile;
  readonly parserName: MarkdownParserName;
  readonly parserVersion: typeof MARKDOWN_PARSER_VERSION;
  readonly textNormalizationVersion: typeof MARKDOWN_TEXT_NORMALIZATION_VERSION;
  readonly structureProjectionVersion: typeof MARKDOWN_STRUCTURE_PROJECTION_VERSION;
  readonly documentBaseUri?: string;
  readonly normalizedTextUtf8: Uint8Array;
  readonly normalizedTextSha256: string;
  readonly normalizedTextByteLength: number;
  readonly structureSha256: string;
  readonly nodes: readonly Readonly<ParsedMarkdownNode>[];
  readonly fragments: readonly Readonly<ParsedMarkdownFragment>[];
  readonly intakeTargetNodeKeys: readonly string[];
  readonly links: readonly Readonly<ParsedLinkReference>[];
  readonly media: readonly Readonly<ParsedMediaReference>[];
  readonly diagnostics: readonly Readonly<MarkdownDiagnostic>[];
}

export interface MaterializeMarkdownEvidenceInput {
  readonly parsed: Readonly<ParsedMarkdownDocument>;
  readonly snapshot: Readonly<SnapshotInput>;
  readonly mediaPolicy: 'external_reference_only';
  readonly sourceUtf8: Uint8Array;
}

export interface MaterializedMarkdownEvidence {
  readonly textBlob: Readonly<EvidenceBlobInput>;
  readonly structure: Readonly<DocumentStructureInput>;
  readonly mediaAssets: readonly Readonly<ExternalMediaAssetInput>[];
  readonly mediaUsages: readonly Readonly<MediaUsageInput>[];
}

export type MarkdownBudgetName =
  | 'source_bytes'
  | 'nodes'
  | 'fragments'
  | 'depth'
  | 'links'
  | 'media'
  | 'diagnostics'
  | 'canonical_structure_bytes'
  | 'canonical_json_values';

export type MarkdownIssueCode =
  | 'invalid_shape'
  | 'invalid_source_identity'
  | 'invalid_utf8'
  | 'invalid_text'
  | 'empty_document'
  | 'limit_exceeded'
  | 'invalid_source_position'
  | 'invalid_tree'
  | 'invalid_fragment'
  | 'invalid_base_uri'
  | 'invalid_media_reference'
  | 'unsafe_media_scheme'
  | 'parsed_result_mismatch'
  | 'structure_hash_mismatch'
  | 'internal_parser_failure';

export interface MarkdownIssue {
  readonly code: MarkdownIssueCode;
  readonly path: string;
  readonly range?: Readonly<ParsedSourceRange>;
  readonly budget?: MarkdownBudgetName;
}

export type ParseMarkdownResult =
  | Readonly<{
      status: 'parsed';
      value: Readonly<ParsedMarkdownDocument>;
    }>
  | Readonly<{status: 'rejected'; issue: Readonly<MarkdownIssue>}>;

export type MaterializeMarkdownEvidenceResult =
  | Readonly<{
      status: 'materialized';
      value: Readonly<MaterializedMarkdownEvidence>;
    }>
  | Readonly<{status: 'rejected'; issue: Readonly<MarkdownIssue>}>;

export function parserNameForProfile(
  profile: MarkdownProfile,
): MarkdownParserName {
  return profile === 'commonmark-v1'
    ? 'struinfo-commonmark'
    : 'struinfo-commonmark/ruanyf-weekly';
}
