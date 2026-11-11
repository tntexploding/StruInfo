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

    expect(decoded.reviewPreferences.entrySavedQueries).toEqual({
      version: 1,
      revision: 0,
      views: [],
    });

    expect(decoded.reviewPreferences.entrySplitRuleProfile).toEqual({
      revision: 0,
      mode: 'one_section',
      minimumGroupCodePoints: 400,
      maximumGroupCodePoints: 4000,
      maximumFragmentsPerGroup: 8,
    });
  });

  it('round-trips saved query conditions and rejects persisted result/cursor payloads', () => {
    const preferences = {
      ...createReviewPreferences(WORKSPACE_ID, []),
      entrySavedQueries: {
        version: 1 as const,
        revision: 2,
        views: [
          {
            viewId: WORKSPACE_ID,
            name: 'Synthetic saved query',
            query: {
              includePrivate: true,
              onlyPrivate: true,
              text: 'Synthetic',
              time: {field: 'captured' as const, from: '2026-01-01'},
            },
            selectedEntryId: '22222222-2222-4222-8222-222222222222',
          },
        ],
      },
    };
    const section = {
      schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
      blobs: [],
      reviewPreferences: preferences,
    };
    const decoded = PERSONAL_DATA_BUNDLE_CODEC.decode(
      PERSONAL_DATA_BUNDLE_CODEC.encode(section) as JsonValue,
    ) as Readonly<PersonalDataBundleSection>;
    expect(decoded.reviewPreferences.entrySavedQueries).toMatchObject(
      preferences.entrySavedQueries,
    );
    const bad = {
      ...section,
      reviewPreferences: {
        ...preferences,
        entrySavedQueries: {
          ...preferences.entrySavedQueries,
          views: [
            {
              ...preferences.entrySavedQueries.views[0],
              query: {includePrivate: false, after: {}},
            },
          ],
        },
      },
    };
    expect(() => PERSONAL_DATA_BUNDLE_CODEC.decode(bad as JsonValue)).toThrow();
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

    expect(decoded.reviewPreferences.entrySplitRuleProfile).toEqual(
      section.reviewPreferences.entrySplitRuleProfile,
    );
  });
});

it('round-trips page layout separately from privacy and defaults older packages', () => {
  const ui = {
    revision: 3,
    theme: 'light' as const,
    sidebars: {
      inbox: ['subscriptions'],
      documents: ['source', 'tags'],
      topics: [],
      query: ['export'],
      settings: ['ai'],
    },
  };
  const reviewPreferences = {
    ...createReviewPreferences(WORKSPACE_ID, []),
    aiPricePolicy: {revision: 4, enabled: true},
    uiPreferences: ui,
  };
  const section = {
    schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
    blobs: [],
    reviewPreferences,
  };
  const roundTrip = PERSONAL_DATA_BUNDLE_CODEC.decode(
    PERSONAL_DATA_BUNDLE_CODEC.encode(section) as JsonValue,
  ) as Readonly<PersonalDataBundleSection>;
  expect(roundTrip.reviewPreferences.uiPreferences).toEqual(ui);
  expect(roundTrip.reviewPreferences.aiPricePolicy).toEqual({
    revision: 4,
    enabled: true,
  });
  const {uiPreferences: _removed, ...older} = reviewPreferences;
  void _removed;
  const legacy = PERSONAL_DATA_BUNDLE_CODEC.decode({
    ...section,
    reviewPreferences: older,
  } as unknown as JsonValue) as Readonly<PersonalDataBundleSection>;
  expect(legacy.reviewPreferences.uiPreferences?.revision).toBe(0);
  expect(() =>
    PERSONAL_DATA_BUNDLE_CODEC.decode({
      ...section,
      reviewPreferences: {
        ...reviewPreferences,
        uiPreferences: {...ui, includePrivate: true},
      },
    } as unknown as JsonValue),
  ).toThrow();
});
