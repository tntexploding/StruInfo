import {describe, expect, it} from 'vitest';

import {
  INFORMATION_DOCUMENT_WORKING_COPY_MAX_BYTES,
  deriveEditedInformationDocumentResourceId,
  deriveEditedInformationDocumentSnapshotId,
  validateInformationDocumentWorkingCopyText,
} from './information_document_working_copy.js';

const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';

describe('Information document working copy', () => {
  it('validates one current UTF-8 text value and returns its exact digest', () => {
    expect(validateInformationDocumentWorkingCopyText('标题\n\n正文')).toEqual({
      text: '标题\n\n正文',
      utf8Bytes: 14,
      sha256:
        '08cd81452303c97eb8901e095508a0cbbc3d2c01ef289944e93b445b94103eca',
    });
    expect(validateInformationDocumentWorkingCopyText('')).toBeUndefined();
    expect(
      validateInformationDocumentWorkingCopyText('\u0000'),
    ).toBeUndefined();
    expect(
      validateInformationDocumentWorkingCopyText('\ud800'),
    ).toBeUndefined();
    expect(
      validateInformationDocumentWorkingCopyText(
        'a'.repeat(INFORMATION_DOCUMENT_WORKING_COPY_MAX_BYTES + 1),
      ),
    ).toBeUndefined();
  });

  it('derives stable distinct identities from source and confirmed content', () => {
    const resource = deriveEditedInformationDocumentResourceId(SNAPSHOT_ID);
    const first = deriveEditedInformationDocumentSnapshotId(
      SNAPSHOT_ID,
      'a'.repeat(64),
    );
    const second = deriveEditedInformationDocumentSnapshotId(
      SNAPSHOT_ID,
      'b'.repeat(64),
    );

    expect(resource).toMatch(/^[0-9a-f-]{36}$/u);
    expect(first).toBe(
      deriveEditedInformationDocumentSnapshotId(SNAPSHOT_ID, 'a'.repeat(64)),
    );
    expect(first).not.toBe(second);
    expect(first).not.toBe(SNAPSHOT_ID);
  });
});
