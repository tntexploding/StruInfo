import type {InformationEntryServices} from './information_entry_components.js';
import type {InformationDocumentWorkingCopyProps} from './information_document_working_copy.js';

/** Shared by the document reader and its inline structure editor. */
export interface DocumentStructureServices extends Pick<
  InformationEntryServices,
  'onMaterializeManual' | 'onPreviewRestructure' | 'onApplyRestructure'
> {
  readonly onLoadDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onLoad'];
  readonly onSaveDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onSave'];
  readonly onRestoreDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onRestore'];
  readonly onCommitDocumentWorkingCopy: InformationDocumentWorkingCopyProps['onCommit'];
}
