import {describe, expect, it} from 'vitest';

import {createReviewPreferences} from '../storage/review_preferences_store.js';
import type {JsonValue} from '../serialization/canonical_json.js';
import {
  PERSONAL_DATA_BUNDLE_CODEC,
  PERSONAL_DATA_BUNDLE_SCHEMA,
  type PersonalDataBundleSection,
} from './personal_data_bundle.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

describe('personal data Bundle preference compatibility', () => {
  it('upgrades an older v1 preference payload with an empty disabled profile', () => {
    const decoded = PERSONAL_DATA_BUNDLE_CODEC.decode({
      schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
      blobs: [],
      reviewPreferences: {
        format: 'struinfo.review-preferences',
        version: 1,
        workspaceId: WORKSPACE_ID,
        quickTags: [],
        automaticKeywords: {
          enabled: true,
          includeLinkDomains: false,
          excludedKeywords: [],
        },
        vocabulary: {aliases: []},
      },
    }) as Readonly<PersonalDataBundleSection>;

    expect(decoded.reviewPreferences.entryPreferenceProfile).toEqual({
      revision: 0,
      enabled: false,
      rules: [],
    });
  });

  it('round-trips a closed preference profile in the existing v1 section', () => {
    const section: Readonly<PersonalDataBundleSection> = Object.freeze({
      schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
      blobs: Object.freeze([]),
      reviewPreferences: createReviewPreferences(
        WORKSPACE_ID,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          revision: 1,
          enabled: true,
          rules: [
            {
              ruleId: '44444444-4444-4444-8444-444444444444',
              dimension: 'interest',
              featureKind: 'type',
              featureIdentity: 'investigation_analysis',
              displayValue: '调查分析',
              effect: 'prefer',
              weight: 4,
            },
          ],
        },
      ),
    });

    const payload = PERSONAL_DATA_BUNDLE_CODEC.encode(section);
    const decoded = PERSONAL_DATA_BUNDLE_CODEC.decode(
      payload as JsonValue,
    ) as Readonly<PersonalDataBundleSection>;

    expect(decoded.reviewPreferences.entryPreferenceProfile).toEqual(
      section.reviewPreferences.entryPreferenceProfile,
    );
  });

  it('rejects malformed profile state instead of silently dropping it', () => {
    expect(() =>
      PERSONAL_DATA_BUNDLE_CODEC.decode({
        schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
        blobs: [],
        reviewPreferences: {
          format: 'struinfo.review-preferences',
          version: 1,
          workspaceId: WORKSPACE_ID,
          quickTags: [],
          automaticKeywords: {
            enabled: true,
            includeLinkDomains: false,
            excludedKeywords: [],
          },
          vocabulary: {aliases: []},
          entryPreferenceProfile: {
            revision: 1,
            enabled: true,
            rules: [],
            unknown: true,
          },
        },
      }),
    ).toThrow('The personal-data Bundle section is invalid.');
  });
});
