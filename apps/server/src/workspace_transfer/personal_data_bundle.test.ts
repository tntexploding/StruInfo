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
    expect(decoded.reviewPreferences.entryAutomationPolicy).toMatchObject({
      revision: 0,
      enabled: false,
      paused: false,
      profileRevision: 0,
    });
    expect(decoded.reviewPreferences.entrySplitRuleProfile).toEqual({
      revision: 0,
      mode: 'one_section',
      minimumGroupCodePoints: 400,
      maximumGroupCodePoints: 4000,
      maximumFragmentsPerGroup: 8,
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
        {
          revision: 2,
          enabled: true,
          paused: false,
          profileRevision: 1,
          minimumMatchedRuleCount: 1,
          advanceThresholds: {
            usefulness: 4,
            interest: 3,
            requiredDimensions: 1,
          },
          deferThresholds: {
            usefulness: 5,
            interest: 4,
            requiredDimensions: 2,
          },
          budgets: {
            maximumEntriesPerRun: 20,
            maximumAdvanceCandidatesPerRun: 5,
            maximumDeferCandidatesPerRun: 4,
          },
          failureMode: 'pause',
        },
        {
          revision: 3,
          mode: 'merge_short_adjacent',
          minimumGroupCodePoints: 250,
          maximumGroupCodePoints: 2500,
          maximumFragmentsPerGroup: 6,
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
    expect(decoded.reviewPreferences.entryAutomationPolicy).toEqual(
      section.reviewPreferences.entryAutomationPolicy,
    );
    expect(decoded.reviewPreferences.entrySplitRuleProfile).toEqual(
      section.reviewPreferences.entrySplitRuleProfile,
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

  it('rejects malformed automation policy state instead of dropping it', () => {
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
          entryAutomationPolicy: {
            revision: 1,
            enabled: true,
            paused: false,
            profileRevision: 1,
            minimumMatchedRuleCount: 1,
            advanceThresholds: {
              usefulness: 3,
              interest: 3,
              requiredDimensions: 1,
            },
            deferThresholds: {
              usefulness: 3,
              interest: 3,
              requiredDimensions: 1,
            },
            budgets: {
              maximumEntriesPerRun: 10,
              maximumAdvanceCandidatesPerRun: 3,
              maximumDeferCandidatesPerRun: 3,
            },
            failureMode: 'continue',
          },
        },
      }),
    ).toThrow('The personal-data Bundle section is invalid.');
  });
});
