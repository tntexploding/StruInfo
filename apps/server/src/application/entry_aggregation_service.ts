import {z} from 'zod';
import type {InformationEntryRepositoryPort} from '../modules/entries/information_entry_repository.js';
import type {InformationEntryAssociationRepositoryPort} from '../modules/entries/information_entry_association_repository.js';
import type {TopicRepository} from '../modules/entries/content_topics.js';
import {searchCurrentInformationEntries} from '../modules/entries/information_entry_search.js';
import {
  DEFAULT_ENTRY_SAVED_QUERIES,
  decodeEntrySavedQueryWrite,
  reviseEntrySavedQueries,
} from '../modules/entries/information_entry_saved_queries.js';
import {
  loadCachedEntrySearchTranslations,
  type EntryTranslationSearchRepositoryPort,
} from '../modules/entries/information_entry_translation.js';
import {
  patchReviewPreferences,
  updateReviewPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

const captureSchema = z
  .object({
    operation: z.literal('aggregate'),
    expectedRevision: z.number().int().nonnegative(),
    viewId: z.uuid(),
    name: z.string(),
    query: z.unknown(),
    topicIds: z.array(z.uuid()).max(32).default([]),
  })
  .strict();
const readSchema = z
  .object({
    viewId: z.uuid(),
    includePrivate: z.boolean().default(false),
    onlyPrivate: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(20),
    after: z
      .object({
        offset: z.number().int().nonnegative(),
        updatedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => !v.onlyPrivate || v.includePrivate);

interface Dependencies {
  preferences: ReviewPreferencesStore;
  entries: Pick<
    InformationEntryRepositoryPort,
    'loadCurrentEntries' | 'loadCurrentEntriesByIds'
  >;
  associations: Pick<
    InformationEntryAssociationRepositoryPort,
    'loadAssociationSnapshot'
  >;
  topics?: Pick<TopicRepository, 'list'>;
  translations?: EntryTranslationSearchRepositoryPort;
}

/** Aggregations share saved-query preferences; only entry identities are captured. */
export class EntryAggregationService {
  constructor(
    private readonly authority: ExecutionAuthority,
    private readonly deps: Dependencies,
  ) {}

  async capture(input: unknown) {
    if (this.authority.identity.kind !== 'owner')
      throw new OperationError('forbidden', 'aggregation_owner_required');
    const parsed = captureSchema.safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'invalid_request');
    const {topicIds, ...body} = parsed.data;
    const write = decodeEntrySavedQueryWrite({...body, operation: 'save'});
    if (write?.operation !== 'save')
      throw new OperationError('invalid_input', 'invalid_request');
    const query = {...write.view.query, limit: 100};
    this.authority.require('entries.search', query.includePrivate);
    if (query.retrievalMode !== 'lexical')
      throw new OperationError(
        'invalid_input',
        'aggregation_requires_text_search',
      );
    const preferences = await this.deps.preferences.load(
      this.authority.workspaceId,
    );
    if (
      (preferences.entrySavedQueries?.revision ?? 0) !== write.expectedRevision
    )
      throw new OperationError('conflict', 'saved_queries_revision_conflict');
    let entries = await this.deps.entries.loadCurrentEntries(
      this.authority.workspaceId,
      query.includePrivate,
    );
    if (topicIds.length) {
      if (!this.deps.topics)
        throw new OperationError('rejected', 'aggregation_topics_unavailable');
      const topics = await this.deps.topics.list('topic');
      if (topicIds.some((id) => !topics.some((t) => t.id === id)))
        throw new OperationError('not_found', 'aggregation_topic_not_found');
      entries = entries.filter((entry) =>
        topics.some(
          (topic) =>
            topicIds.includes(topic.id) &&
            topic.value.kind === 'topic' &&
            topic.value.members.some(
              (member) =>
                member.entryId === entry.entryId &&
                member.decision !== 'excluded' &&
                member.revision === entry.revision,
            ),
        ),
      );
    }
    const [associations, translations] = await Promise.all([
      query.association
        ? this.deps.associations.loadAssociationSnapshot(
            this.authority.workspaceId,
            query.includePrivate,
          )
        : Promise.resolve({projections: [], overrides: []}),
      loadCachedEntrySearchTranslations(
        this.authority.workspaceId,
        query,
        this.deps.translations,
      ),
    ]);
    const matches = searchCurrentInformationEntries(
      entries,
      {...query, limit: Math.max(entries.length, 1)},
      associations,
      undefined,
      translations,
      preferences.vocabulary?.aliases ?? [],
      preferences.annotationVocabulary,
    );
    const view = {
      ...write.view,
      aggregation: {
        topicIds: [...new Set(topicIds)],
        entryIds: matches.items.map((item) => item.entry.entryId),
        updatedAt: new Date().toISOString(),
      },
    };
    const updated = await updateReviewPreferences(
      this.deps.preferences,
      this.authority.workspaceId,
      (current) => {
        const result = reviseEntrySavedQueries(
          current.entrySavedQueries ?? DEFAULT_ENTRY_SAVED_QUERIES,
          {...write, view},
        );
        if (result.status === 'rejected')
          throw new OperationError('conflict', result.code);
        return {
          next: patchReviewPreferences(current, {
            entrySavedQueries: result.state,
          }),
          result: result.state,
        };
      },
    );
    return {status: 'applied', savedQueries: updated.result};
  }

  async read(input: unknown) {
    const parsed = readSchema.safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'invalid_request');
    const request = parsed.data;
    this.authority.require('entries.search', request.includePrivate);
    const preferences = await this.deps.preferences.load(
      this.authority.workspaceId,
    );
    const view = preferences.entrySavedQueries?.views.find(
      (v) => v.viewId === request.viewId,
    );
    if (!view) throw new OperationError('not_found', 'saved_query_not_found');
    const aggregation = view.aggregation;
    if (!aggregation)
      throw new OperationError('rejected', 'aggregation_not_collected');
    if (request.after && request.after.updatedAt !== aggregation.updatedAt)
      throw new OperationError('conflict', 'aggregation_changed');
    const entries = !aggregation.entryIds.length
      ? []
      : this.deps.entries.loadCurrentEntriesByIds
        ? await this.deps.entries.loadCurrentEntriesByIds(
            this.authority.workspaceId,
            request.includePrivate,
            aggregation.entryIds,
          )
        : await this.deps.entries.loadCurrentEntries(
            this.authority.workspaceId,
            request.includePrivate,
          );
    const byId = new Map(
      entries
        .filter((e) =>
          request.onlyPrivate
            ? e.value.isPrivate
            : request.includePrivate || !e.value.isPrivate,
        )
        .map((e) => [e.entryId, e]),
    );
    const visible = aggregation.entryIds.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
    const offset = request.after?.offset ?? 0;
    const items = visible
      .slice(offset, offset + request.limit)
      .map((entry) => ({entry, matchReasons: [], filterReasons: []}));
    return {
      status: 'ok',
      name: view.name,
      totalCount: visible.length,
      items,
      referenceCount: aggregation.entryIds.length,
      unavailableCount: aggregation.entryIds.length - visible.length,
      updatedAt: aggregation.updatedAt,
      ...(offset + items.length < visible.length
        ? {
            nextCursor: {
              offset: offset + items.length,
              updatedAt: aggregation.updatedAt,
            },
          }
        : {}),
    };
  }
}
