import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import {isAiDispatchWait} from '../modules/processing/ai_price_policy.js';
import {
  EMPTY_ANNOTATION_VOCABULARY,
  type AnnotationVocabulary,
} from '../modules/entries/structured_annotations.js';
import type {InformationEntryRepositoryPort} from '../modules/entries/information_entry_repository.js';
import type {InformationEntryAssociationRepositoryPort} from '../modules/entries/information_entry_association_repository.js';
import {
  topicScopeSchema,
  topicEvidenceSchema,
  topicRelationSchema,
  topicResponseSchema,
  checkTopicEvidence,
  topicFingerprint,
  topicPair,
  topicSummaryStale,
  TOPIC_RULE_VERSION,
  type TopicValue,
  type TopicRecord,
  type TopicJob,
  type TopicInput,
  type TopicRepository,
  type TopicProvider,
} from '../modules/entries/content_topics.js';
import {prepareTopicInput} from '../modules/entries/topic_candidates.js';
import type {ExecutionAuthority} from './execution_authority.js';
import type {DocumentPublicationRepository} from './document_publication_contract.js';
import {OperationError} from './operation_error.js';

const id = z.uuid(),
  version = z.number().int().nonnegative();
export const topicCommandSchemas = {
  topics_list: z.object({entryId: id.optional()}).strict(),
  topics_preview: topicScopeSchema,
  topic_save: z
    .object({
      topicId: id.optional(),
      expectedVersion: version,
      name: z.string().trim().min(1).max(160),
      scope: z.string().trim().min(1).max(800),
    })
    .strict(),
  topic_member_set: z
    .object({
      topicId: id,
      expectedVersion: version,
      member: topicEvidenceSchema.extend({
        reason: z.string().trim().min(1).max(500),
        decision: z.enum(['pinned', 'excluded']),
      }),
    })
    .strict(),
  topic_relation_set: z
    .object({
      topicId: id,
      expectedVersion: version,
      relation: topicRelationSchema.omit({origin: true}),
    })
    .strict(),
};
export const topicOwnerSchemas = {
  topic_job_start: z
    .object({
      scope: topicScopeSchema,
      budgetId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
    })
    .strict(),
  topic_job_control: z
    .object({
      jobId: id,
      expectedVersion: version,
      action: z.enum(['resume', 'cancel']),
    })
    .strict(),
};
interface Dependencies {
  budgetStatus?: () => Promise<{
    batchId: string;
    paused: boolean;
    limitCny: number;
    remainingCny: number;
  } | null>;
  workspaceId: string;
  repository: TopicRepository;
  entries: InformationEntryRepositoryPort;
  vocabulary?: () => Promise<AnnotationVocabulary>;
  associations?: InformationEntryAssociationRepositoryPort;
  publications?: DocumentPublicationRepository;
  provider?: TopicProvider;
  sourceGuidance?: (snapshotId: string) => Promise<string>;
  checkModelCall: () => Promise<void>;
  executionSettings: () => Promise<{automaticRetryLimit: number}>;
}
export class TopicService {
  private readonly running = new Map<string, Promise<void>>();
  private closing = false;
  constructor(private readonly deps: Dependencies) {}
  private current() {
    return this.deps.entries.loadCurrentEntries(this.deps.workspaceId, false);
  }
  private async protectedPairs(ids: readonly string[]) {
    const a = this.deps.associations;
    if (!a) return [];
    const snapshot = await (a.loadAssociationSnapshotForEntries?.(
      this.deps.workspaceId,
      false,
      ids,
    ) ?? a.loadAssociationSnapshot(this.deps.workspaceId, false));
    return snapshot.overrides
      .filter((o) => o.value.isBlocked || o.value.graph?.origin === 'user')
      .map((o) => topicPair(o.entryLowId, o.entryHighId));
  }
  private visible(row: TopicRecord, ids: ReadonlySet<string>) {
    const refs =
      row.value.kind === 'topic'
        ? [
            ...row.value.members.map((m) => m.entryId),
            ...row.value.relations.flatMap((r) => [
              r.from.entryId,
              r.to.entryId,
            ]),
          ]
        : [
            ...row.value.input.entries.map((e) => e.entryId),
            ...row.value.input.topics.flatMap((t) =>
              t.value.members.map((m) => m.entryId),
            ),
          ];
    return refs.every((id) => ids.has(id));
  }
  async execute(
    authority: ExecutionAuthority,
    name: string,
    input: unknown,
  ): Promise<unknown> {
    if (authority.workspaceId !== this.deps.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    const schemas = {...topicCommandSchemas, ...topicOwnerSchemas};
    if (!Object.hasOwn(schemas, name))
      throw new OperationError('not_found', 'unknown_operation');
    if (!schemas[name as keyof typeof schemas].safeParse(input).success)
      throw new OperationError('invalid_input', 'topic_invalid');
    authority.require('entries.search');
    authority.require('relations.read');
    if (name === 'topics_list') {
      const req = topicCommandSchemas.topics_list.parse(input);
      const entries = await this.current(),
        ids = new Set(entries.map((e) => e.entryId));
      const [topics, jobs] = await Promise.all([
        this.deps.repository.list('topic'),
        this.deps.repository.list('job'),
      ]);
      const protectedPairs = new Set(await this.protectedPairs([...ids]));
      return {
        budget:
          authority.identity.kind === 'owner'
            ? ((await this.deps.budgetStatus?.().catch(() => null)) ?? null)
            : null,
        topics: topics
          .filter(
            (t) =>
              this.visible(t, ids) &&
              (!req.entryId ||
                (t.value.kind === 'topic' &&
                  t.value.members.some((m) => m.entryId === req.entryId))),
          )
          .map((t) => ({
            ...t,
            value:
              t.value.kind === 'topic'
                ? {
                    ...t.value,
                    relations: t.value.relations.filter(
                      (r) =>
                        r.origin !== 'ai' ||
                        !protectedPairs.has(
                          topicPair(r.from.entryId, r.to.entryId),
                        ),
                    ),
                  }
                : t.value,
            stale:
              t.value.kind === 'topic' && topicSummaryStale(t.value, entries),
            entries:
              t.value.kind === 'topic'
                ? t.value.members.map((m) => ({
                    entryId: m.entryId,
                    title: entries.find((e) => e.entryId === m.entryId)?.value
                      .titlePath,
                    stale:
                      entries.find((e) => e.entryId === m.entryId)?.revision !==
                      m.revision,
                  }))
                : [],
          })),
        jobs: jobs
          .filter(
            (j) =>
              this.visible(j, ids) &&
              (!req.entryId ||
                (j.value.kind === 'job' &&
                  j.value.input.entries.some(
                    (e) => e.entryId === req.entryId,
                  ))),
          )
          .slice(0, 100)
          .flatMap((j) =>
            j.value.kind === 'job'
              ? [
                  {
                    id: j.id,
                    version: j.version,
                    updatedAt: j.updatedAt,
                    status: j.value.status,
                    errorCode: j.value.errorCode,
                    attempts: j.value.attempts,
                    maxAttempts: j.value.maxAttempts,
                    budgetId: j.value.budgetId,
                    entries: j.value.input.entries.map((e) => ({
                      entryId: e.entryId,
                      title: e.title,
                    })),
                    usage: j.value.usage,
                    note: j.value.result?.note,
                    chargedNanoCny: j.value.usage.reduce(
                      (n, u) => n + (u.chargedNanoCny ?? u.reservedNanoCny),
                      0,
                    ),
                    usageKnown: j.value.usage.every(
                      (u) => u.usageKnown === true,
                    ),
                    canResume: this.canResume(j),
                  },
                ]
              : [],
          ),
      };
    }
    if (name === 'topics_preview')
      return this.prepare(topicScopeSchema.parse(input));
    if (Object.hasOwn(topicOwnerSchemas, name)) {
      if (authority.identity.kind !== 'owner')
        throw new OperationError('forbidden', 'topic_owner_required');
      authority.require('tasks.control');
      if (name === 'topic_job_start') {
        authority.require('models.use');
        const r = topicOwnerSchemas.topic_job_start.parse(input);
        if (!this.deps.provider)
          throw new OperationError('rejected', 'model_unavailable');
        const prepared = await this.prepare(r.scope);
        const fingerprint = topicFingerprint(prepared.input);
        const jobId = deriveProcessingRunId(
          this.deps.workspaceId,
          'topics:' + fingerprint,
        );
        const existing = await this.deps.repository.read(jobId);
        if (existing) return {jobId, reused: true};
        const settings = await this.deps.executionSettings();
        const job: TopicJob = {
          kind: 'job',
          ...prepared,
          fingerprint,
          budgetId: r.budgetId,
          status: 'queued',
          attempts: 0,
          maxAttempts: 1 + Math.min(2, settings.automaticRetryLimit),
          usage: [],
          appliedTopicIds: [],
        };
        const saved = await this.deps.repository.save([
          {id: jobId, expectedVersion: 0, value: job},
        ]);
        this.schedule(jobId);
        return {jobId, reused: !saved};
      }
      const r = topicOwnerSchemas.topic_job_control.parse(input);
      await this.deps.repository.withLock(async () => {
        const row = await this.get(r.jobId);
        if (row.version !== r.expectedVersion || row.value.kind !== 'job')
          throw new OperationError('conflict', 'topic_version_changed');
        if (r.action === 'cancel') {
          if (row.value.status === 'succeeded')
            throw new OperationError('conflict', 'topic_job_finished');
          await this.save({...row, value: {...row.value, status: 'cancelled'}});
          return;
        }
        authority.require('models.use');
        const job = row.value;
        if (!this.canResume(row))
          throw new OperationError('conflict', 'topic_job_cannot_resume');
        this.validateInput(job.input, await this.current());
        await this.save({...row, value: {...job, status: 'queued'}});
      });
      if (r.action === 'resume') this.schedule(r.jobId);
      else {
        const stopped = await this.get(r.jobId);
        if (stopped.value.kind === 'job')
          await this.syncPublication(stopped.value, 'paused');
      }
      return {jobId: r.jobId};
    }
    authority.require(
      authority.identity.kind === 'owner'
        ? 'relations.revise'
        : 'agent.relations',
    );
    return this.deps.repository.withLock(async () => {
      const r = z
        .object({topicId: id.optional(), expectedVersion: version})
        .loose()
        .parse(input);
      const row = r.topicId ? await this.get(r.topicId) : undefined;
      const entries = await this.current();
      if (
        row &&
        (!this.visible(row, new Set(entries.map((e) => e.entryId))) ||
          row.value.kind !== 'topic')
      )
        throw new OperationError('not_found', 'topic_unavailable');
      if ((row?.version ?? 0) !== r.expectedVersion)
        throw new OperationError('conflict', 'topic_version_changed');
      const origin =
        authority.identity.kind === 'owner' ? 'manual' : 'external_agent';
      const value: TopicValue =
        row?.value.kind === 'topic'
          ? structuredClone(row.value)
          : {
              kind: 'topic',
              name: '',
              scope: '',
              origin,
              members: [],
              relations: [],
              summary: '',
              summaryVersions: [],
              ruleVersion: TOPIC_RULE_VERSION,
            };
      if (origin === 'external_agent' && value.origin === 'manual')
        throw new OperationError('conflict', 'topic_manual_decision');
      if (name === 'topic_save') {
        const request = topicCommandSchemas.topic_save.parse(input);
        value.name = request.name;
        value.scope = request.scope;
        value.origin = origin;
        value.summaryVersions = [];
      } else {
        if (!row) throw new OperationError('not_found', 'topic_unavailable');
        const evidence = entries.map((e) => ({
          entryId: e.entryId,
          revision: e.revision,
          body: e.value.body,
        }));
        if (name === 'topic_member_set') {
          const {member} = topicCommandSchemas.topic_member_set.parse(input);
          this.evidence(() => {
            checkTopicEvidence(member, evidence);
          });
          const old = value.members.find((m) => m.entryId === member.entryId);
          if (origin === 'external_agent' && old?.origin === 'manual')
            throw new OperationError('conflict', 'topic_manual_decision');
          value.members = [
            ...value.members.filter((m) => m.entryId !== member.entryId),
            {...member, origin},
          ];
          value.summaryVersions = [];
        } else {
          const {relation} =
            topicCommandSchemas.topic_relation_set.parse(input);
          this.evidence(() => {
            checkTopicEvidence(relation.from, evidence);
            checkTopicEvidence(relation.to, evidence);
          });
          if (relation.from.entryId === relation.to.entryId)
            throw new OperationError('invalid_input', 'topic_self_relation');
          const pair = topicPair(relation.from.entryId, relation.to.entryId);
          const old = value.relations.find(
            (x) => topicPair(x.from.entryId, x.to.entryId) === pair,
          );
          if (
            origin === 'external_agent' &&
            (old?.origin === 'manual' ||
              (
                await this.protectedPairs([
                  relation.from.entryId,
                  relation.to.entryId,
                ])
              ).includes(pair))
          )
            throw new OperationError('conflict', 'topic_manual_decision');
          if (
            ![relation.from.entryId, relation.to.entryId].every((id) =>
              value.members.some(
                (m) => m.entryId === id && m.decision !== 'excluded',
              ),
            )
          )
            throw new OperationError(
              'invalid_input',
              'topic_relation_outside_members',
            );
          value.relations = [
            ...value.relations.filter(
              (x) => topicPair(x.from.entryId, x.to.entryId) !== pair,
            ),
            {...relation, origin},
          ];
        }
      }
      const topicId = row?.id ?? randomUUID();
      if (
        !(await this.deps.repository.save([
          {id: topicId, expectedVersion: r.expectedVersion, value},
        ]))
      )
        throw new OperationError('conflict', 'topic_version_changed');
      return {topicId};
    });
  }
  private evidence(check: () => void) {
    try {
      check();
    } catch {
      throw new OperationError('conflict', 'topic_evidence_changed');
    }
  }
  private canResume(row: TopicRecord) {
    const job = row.value;
    return (
      job.kind === 'job' &&
      ['paused', 'failed', 'running'].includes(job.status) &&
      !this.running.has(row.id) &&
      !(
        job.status === 'running' &&
        Date.now() - Date.parse(row.updatedAt) < 20 * 60_000
      ) &&
      (Boolean(job.result) || job.attempts < job.maxAttempts) &&
      !(job.status === 'failed' && job.errorCode !== 'ai_provider_unavailable')
    );
  }
  private async prepare(scope: z.infer<typeof topicScopeSchema>) {
    try {
      const entries = await this.current(),
        ids = new Set(entries.map((e) => e.entryId));
      const topics = (await this.deps.repository.list('topic')).filter((t) =>
        this.visible(t, ids),
      );
      const vocabulary =
        (await this.deps.vocabulary?.()) ?? EMPTY_ANNOTATION_VOCABULARY;
      const prepared = prepareTopicInput(
        entries,
        vocabulary,
        scope,
        topics,
        [],
      );
      prepared.input.protectedPairs = await this.protectedPairs(
        prepared.input.entries.map((e) => e.entryId),
      );
      if (this.deps.sourceGuidance) {
        const guidance = new Map<string, string>();
        for (const entry of prepared.input.entries) {
          if (!guidance.has(entry.snapshotId))
            guidance.set(
              entry.snapshotId,
              await this.deps.sourceGuidance(entry.snapshotId),
            );
          const text = guidance.get(entry.snapshotId)?.trim();
          if (text) entry.ownerRelationGuidance = text;
        }
        if (Array.from(JSON.stringify(prepared.input)).length > 100000)
          throw new Error('topic_input_too_large');
      }
      return prepared;
    } catch (e) {
      if (e instanceof OperationError) throw e;
      throw new OperationError(
        'rejected',
        e instanceof Error ? e.message : 'topic_input_invalid',
      );
    }
  }
  private validateInput(
    input: TopicInput,
    entries: Awaited<ReturnType<TopicService['current']>>,
  ) {
    if (
      input.entries.some(
        (e) =>
          !entries.some(
            (n) =>
              n.entryId === e.entryId &&
              n.revision === e.revision &&
              n.snapshotId === e.snapshotId &&
              n.value.body === e.body,
          ),
      )
    )
      throw new OperationError('conflict', 'topic_input_changed');
  }
  private async get(id: string) {
    const r = await this.deps.repository.read(id);
    if (!r) throw new OperationError('not_found', 'topic_unavailable');
    return r;
  }
  private async save(row: TopicRecord) {
    if (
      !(await this.deps.repository.save([
        {id: row.id, expectedVersion: row.version, value: row.value},
      ]))
    )
      throw new OperationError('conflict', 'topic_version_changed');
  }
  private schedule(id: string) {
    if (this.closing || this.running.has(id)) return;
    const work = this.run(id)
      .catch(() => undefined)
      .finally(() => this.running.delete(id));
    this.running.set(id, work);
  }
  async poll() {
    if (this.closing) return;
    for (const row of (await this.deps.repository.list('job'))
      .filter((r) => r.value.kind === 'job' && r.value.status === 'queued')
      .slice(-4))
      this.schedule(row.id);
  }
  async drain() {
    this.closing = true;
    await Promise.all(this.running.values());
  }
  private async checkpoint(id: string, change: (j: TopicJob) => TopicJob) {
    return this.deps.repository.withLock(async () => {
      const row = await this.get(id);
      if (row.value.kind !== 'job') throw new Error('topic_job_invalid');
      row.value = change(row.value);
      await this.save(row);
      return row.value;
    });
  }
  private async run(id: string) {
    let claimed = false;
    try {
      const initial = await this.get(id);
      if (initial.value.kind !== 'job' || initial.value.status !== 'queued')
        return;
      await this.deps.checkModelCall();
      const job = await this.checkpoint(id, (j) => {
        if (j.status !== 'queued')
          throw new OperationError('conflict', 'topic_job_busy');
        if (!j.result && j.attempts >= j.maxAttempts)
          throw new OperationError('rejected', 'topic_attempts_exhausted');
        return {
          ...j,
          status: 'running',
          ...(j.result ? {} : {attempts: j.attempts + 1}),
          errorCode: undefined,
        };
      });
      claimed = true;
      this.validateInput(job.input, await this.current());
      await this.syncPublication(job, 'running');
      let result = job.result;
      if (!result) {
        if (!this.deps.provider)
          throw new OperationError('rejected', 'model_unavailable');
        result = topicResponseSchema.parse(
          await this.deps.provider.generate(
            job.input,
            job.budgetId,
            async (usage) => {
              const saved = await this.checkpoint(id, (j) => ({
                ...j,
                usage: [...j.usage.filter((u) => u.id !== usage.id), usage],
              }));
              if (
                usage.chargedNanoCny === undefined &&
                saved.status !== 'running'
              )
                throw new OperationError('conflict', 'topic_job_cancelled');
            },
          ),
        );
        // Save paid output before attempting application; a version conflict must not cause another call.
        await this.checkpoint(id, (j) => ({...j, result}));
      }
      await this.apply(id);
      const applied = await this.get(id);
      if (applied.value.kind === 'job' && applied.value.status === 'succeeded')
        await this.syncPublication(job, 'succeeded');
    } catch (e) {
      if (e instanceof OperationError && e.code === 'topic_job_busy') return;
      const wait = isAiDispatchWait(e);
      const code = wait
        ? e.code
        : e instanceof OperationError
          ? e.code
          : 'topic_output_invalid';
      await this.checkpoint(id, (j) =>
        j.status === 'cancelled' || j.status === 'succeeded'
          ? j
          : {
              ...j,
              attempts:
                wait && claimed && !j.result
                  ? Math.max(0, j.attempts - 1)
                  : j.attempts,
              status: wait
                ? 'queued'
                : code === 'ai_provider_unavailable' &&
                    j.attempts < j.maxAttempts
                  ? 'queued'
                  : 'failed',
              errorCode: code,
            },
      ).catch(() => undefined);
      const current = await this.deps.repository.read(id);
      if (current?.value.kind === 'job' && current.value.status === 'failed')
        await this.syncPublication(current.value, 'failed', code);
    }
  }
  private async apply(id: string) {
    await this.deps.repository.withLock(async () => {
      const row = await this.get(id);
      if (row.value.kind !== 'job' || row.value.status === 'cancelled') return;
      const job = row.value,
        result = job.result;
      if (!result) throw new Error('topic_result_missing');
      const entries = await this.current();
      this.validateInput(job.input, entries);
      if (!this.visible(row, new Set(entries.map((e) => e.entryId))))
        throw new OperationError('conflict', 'topic_input_changed');
      const vocabulary =
        (await this.deps.vocabulary?.()) ?? EMPTY_ANNOTATION_VOCABULARY;
      if (vocabulary.revision !== job.input.vocabularyRevision)
        throw new OperationError('conflict', 'topic_input_changed');
      const evidence = job.input.entries;
      const protectedPairs = new Set([
        ...job.input.protectedPairs,
        ...(await this.protectedPairs(evidence.map((e) => e.entryId))),
      ]);
      if (result.relations.length > job.input.scope.maxRelations)
        throw new OperationError('rejected', 'topic_relation_limit');
      const topicIds = result.topics.flatMap((t) =>
        t.topicId ? [t.topicId] : [],
      );
      if (new Set(topicIds).size !== topicIds.length)
        throw new OperationError('rejected', 'topic_output_invalid');
      const relationPairs = result.relations.map((r) =>
        topicPair(r.from.entryId, r.to.entryId),
      );
      if (new Set(relationPairs).size !== relationPairs.length)
        throw new OperationError('rejected', 'topic_output_invalid');
      for (const t of result.topics) {
        if (new Set(t.members.map((m) => m.entryId)).size !== t.members.length)
          throw new Error('topic_duplicate_member');
        t.members.forEach((m) => {
          this.evidence(() => {
            checkTopicEvidence(m, evidence);
          });
        });
      }
      for (const r of result.relations) {
        this.evidence(() => {
          checkTopicEvidence(r.from, evidence);
          checkTopicEvidence(r.to, evidence);
        });
        if (r.from.entryId === r.to.entryId)
          throw new Error('topic_self_relation');
      }
      const writes: Parameters<TopicRepository['save']>[0][number][] = [];
      for (const [i, t] of result.topics.entries()) {
        const prior = t.topicId
          ? job.input.topics.find((p) => p.id === t.topicId)
          : undefined;
        if (t.topicId && !prior) throw new Error('topic_unknown_id');
        const latest = prior ? await this.get(prior.id) : undefined;
        if (latest && latest.version !== prior?.version)
          throw new OperationError('conflict', 'topic_version_changed');
        const old = latest?.value.kind === 'topic' ? latest.value : undefined;
        if (
          t.members.some((m) =>
            old?.members.some(
              (previous) =>
                previous.entryId === m.entryId &&
                previous.decision === 'excluded' &&
                previous.origin !== 'ai',
            ),
          )
        )
          throw new OperationError('rejected', 'topic_manual_decision');
        if (
          !t.topicId &&
          job.input.topics.some(
            (previous) =>
              previous.value.name === t.name &&
              previous.value.scope === t.scope,
          )
        )
          throw new OperationError('rejected', 'topic_output_invalid');
        const members = old ? [...old.members] : [];
        for (const m of t.members) {
          const previous = members.find((v) => v.entryId === m.entryId);
          if (previous && previous.origin !== 'ai') continue;
          const n = members.findIndex((v) => v.entryId === m.entryId);
          if (n >= 0) members.splice(n, 1);
          members.push({...m, decision: 'included', origin: 'ai'});
        }
        // Replace only AI membership evaluated in this group. Other topics/members are untouched.
        const finalMembers = members.filter(
          (m) =>
            m.origin !== 'ai' ||
            !evidence.some((e) => e.entryId === m.entryId) ||
            t.members.some((n) => n.entryId === m.entryId),
        );
        const topicId =
          t.topicId ??
          deriveProcessingRunId(
            this.deps.workspaceId,
            'topic:' + id + ':' + String(i),
          );
        const relations = [...(old?.relations ?? [])];
        for (const r of result.relations) {
          const pair = topicPair(r.from.entryId, r.to.entryId);
          if (
            protectedPairs.has(pair) ||
            relations.some(
              (v) =>
                topicPair(v.from.entryId, v.to.entryId) === pair &&
                v.origin !== 'ai',
            )
          )
            continue;
          if (
            ![r.from.entryId, r.to.entryId].every((id) =>
              finalMembers.some(
                (m) => m.entryId === id && m.decision !== 'excluded',
              ),
            )
          )
            continue;
          const n = relations.findIndex(
            (v) => topicPair(v.from.entryId, v.to.entryId) === pair,
          );
          if (n >= 0) relations.splice(n, 1);
          relations.push({...r, origin: 'ai', blocked: false});
        }
        const value: TopicValue = {
          kind: 'topic',
          name: old && old.origin !== 'ai' ? old.name : t.name,
          scope: old && old.origin !== 'ai' ? old.scope : t.scope,
          origin: old?.origin ?? 'ai',
          members: finalMembers,
          relations,
          summary: t.summary,
          summaryVersions: t.members.map((m) => ({
            entryId: m.entryId,
            revision: m.revision,
          })),
          ruleVersion: TOPIC_RULE_VERSION,
        };
        writes.push({
          id: topicId,
          expectedVersion: latest?.version ?? 0,
          value,
        });
      }
      writes.push({
        id,
        expectedVersion: row.version,
        value: {
          ...job,
          status: 'succeeded',
          appliedTopicIds: writes.map((w) => w.id),
        },
      });
      if (!(await this.deps.repository.save(writes)))
        throw new OperationError('conflict', 'topic_version_changed');
    });
  }
  private async syncPublication(
    job: TopicJob,
    to: 'running' | 'succeeded' | 'failed' | 'paused',
    errorCode?: string,
  ) {
    const repo = this.deps.publications,
      seed = job.input.entries.find(
        (e) => e.entryId === job.input.scope.entryId,
      );
    if (!repo?.forSnapshot || !seed) return;
    let p = await repo.forSnapshot(seed.snapshotId);
    if (
      !p?.entries.some(
        (e) => e.entryId === seed.entryId && e.revision === seed.revision,
      )
    )
      return;
    if (to === 'succeeded') {
      const jobs = await this.deps.repository.list('job');
      if (
        !p.entries.every((e) =>
          jobs.some(
            (r) =>
              r.value.kind === 'job' &&
              r.value.status === 'succeeded' &&
              r.value.input.scope.entryId === e.entryId &&
              r.value.input.entries.some(
                (i) => i.entryId === e.entryId && i.revision === e.revision,
              ),
          ),
        )
      )
        return;
    }
    if (
      to === 'running' &&
      ['paused', 'failed'].includes(p.organization.status)
    ) {
      await repo.transitionOrganization({
        publicationId: p.publicationId,
        expectedVersion: p.organization.version,
        from: p.organization.status,
        to: 'pending',
      });
      p = await repo.forSnapshot(seed.snapshotId);
      if (!p) return;
    }
    await repo.transitionOrganization({
      publicationId: p.publicationId,
      expectedVersion: p.organization.version,
      from: p.organization.status,
      to,
      ...(errorCode ? {errorCode} : {}),
    });
  }
}
