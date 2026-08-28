import type {
  CurrentInformationDocumentTags,
  InformationDocumentTagWrite,
} from './information_document_tag_contract.js';

export type InformationDocumentTagWriteOutcome =
  'applied' | 'unchanged' | 'stale';

export interface InformationDocumentTagRepositoryPort {
  writeDocumentTags(
    write: Readonly<InformationDocumentTagWrite>,
  ): Promise<InformationDocumentTagWriteOutcome>;

  loadCurrentDocumentTags(
    workspaceId: string,
    includePrivate: boolean,
  ): Promise<readonly Readonly<CurrentInformationDocumentTags>[]>;
}
