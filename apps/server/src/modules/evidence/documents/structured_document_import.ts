import {
  importMarkdownEvidence,
  type ImportMarkdownEvidenceInput,
  type ImportMarkdownEvidenceResult,
  type MarkdownImportDependencies,
} from '../markdown/markdown_import.js';
import {
  projectStructuredDocument,
  type StructuredDocumentFormat,
} from './document_projection.js';

export type ImportStructuredDocumentEvidenceInput = Readonly<
  Omit<
    ImportMarkdownEvidenceInput,
    'profile' | 'sourceUtf8' | 'rawSourceBytes'
  > & {
    readonly documentFormat: StructuredDocumentFormat;
    readonly sourceBytes: Uint8Array;
    readonly sourcePreface?: string;
  }
>;

export async function importStructuredDocumentEvidence(
  dependencies: Readonly<MarkdownImportDependencies>,
  input: ImportStructuredDocumentEvidenceInput,
): Promise<ImportMarkdownEvidenceResult> {
  const projection = await projectStructuredDocument(
    input.documentFormat,
    input.sourceBytes,
    input.sourcePreface,
  );
  if (projection.status === 'rejected') {
    return Object.freeze({
      status: 'validation_failed' as const,
      code: projection.code,
      path: projection.path,
      ...(projection.budget === undefined ? {} : {budget: projection.budget}),
    });
  }
  return importMarkdownEvidence(dependencies, {
    workspaceId: input.workspaceId,
    commandIdempotencyKey: input.commandIdempotencyKey,
    resource: input.resource,
    ...(input.gitResource === undefined
      ? {}
      : {gitResource: input.gitResource}),
    snapshot: input.snapshot,
    gitObservations: input.gitObservations,
    profile: 'commonmark-v1',
    sourceUtf8: projection.value.sourceUtf8,
    rawSourceBytes: Uint8Array.from(input.sourceBytes),
    ...(input.documentBaseUri === undefined
      ? {}
      : {documentBaseUri: input.documentBaseUri}),
  });
}
