import {createHash} from 'node:crypto';

import type {BlobStore} from '../../storage/blob_store.js';
import type {EvidenceSnapshotReadState} from './evidence_read_repository.js';

export interface MaterializedEvidenceFragmentReadState {
  readonly fragmentId: string;
  readonly structureId: string;
  readonly nodeKind: string;
  readonly codePointRange: Readonly<{start: number; end: number}>;
  readonly selectedText: string;
  readonly [key: string]: unknown;
}

export interface MaterializedEvidenceStructureReadState {
  readonly structureId: string;
  readonly normalizedText: string;
  readonly fragments: readonly Readonly<MaterializedEvidenceFragmentReadState>[];
  readonly [key: string]: unknown;
}

export interface MaterializedEvidenceSnapshotReadState extends Omit<
  EvidenceSnapshotReadState,
  'structures'
> {
  readonly structures: readonly Readonly<MaterializedEvidenceStructureReadState>[];
}

/** Rehydrates immutable text bytes and verifies every Fragment locator. */
export async function materializeEvidenceSnapshot(
  snapshot: Readonly<EvidenceSnapshotReadState>,
  blobStore: BlobStore,
): Promise<Readonly<MaterializedEvidenceSnapshotReadState>> {
  const structures: Readonly<MaterializedEvidenceStructureReadState>[] = [];
  for (const structure of snapshot.structures) {
    const bytes = await blobStore.read(structure.textBlob);
    const normalizedText = new TextDecoder('utf-8', {fatal: true}).decode(
      bytes,
    );
    const codePoints = Array.from(normalizedText);
    const fragments = structure.fragments.map((fragment) => {
      const selectedText = codePoints
        .slice(fragment.codePointRange.start, fragment.codePointRange.end)
        .join('');
      if (digestText(selectedText) !== fragment.selectedTextSha256) {
        throw new Error('Evidence fragment integrity failed.');
      }
      return Object.freeze({...fragment, selectedText});
    });
    structures.push(
      Object.freeze({
        ...structure,
        normalizedText,
        fragments: Object.freeze(fragments),
      }),
    );
  }
  return Object.freeze({...snapshot, structures: Object.freeze(structures)});
}

function digestText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
