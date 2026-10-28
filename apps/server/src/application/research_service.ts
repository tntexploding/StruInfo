import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {InformationEntryQuerySynthesisService} from '../modules/entries/information_entry_query_synthesis.js';
import {acceptProviderResult} from '../modules/entries/information_entry_query_synthesis.js';
import type {
  InformationEntryQuerySynthesisProviderPort,
  InformationEntryQuerySynthesisProviderEvidence,
} from '../modules/entries/information_entry_query_synthesis_contract.js';
import {decodeEntrySearchBody} from '../modules/entries/information_entry_search_request.js';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import {
  researchCommandSchemas,
  researchSettingsSchema,
  type ResearchRecord,
  type ResearchRepository,
  type WebSearchProvider,
  type WebEvidence,
} from './research_contract.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import type {AiWorkQueue} from './ai_work_queue.js';

export class ResearchService {
  private readonly sessions = new Map<
    string,
    {
      actor: string;
      query: string;
      expires: number;
      promise: Promise<{
        sessionId: string;
        results: WebEvidence[];
        warnings: string[];
      }>;
    }
  >();
  private readonly answers = new Map<
    string,
    {input: string; expires: number; promise: Promise<unknown>}
  >();
  constructor(
    private readonly deps: {
      workspaceId: string;
      repository: ResearchRepository;
      web?: WebSearchProvider;
      local?: Pick<InformationEntryQuerySynthesisService, 'retrieve'>;
      answer?: InformationEntryQuerySynthesisProviderPort;
      queue: AiWorkQueue;
      checkAllowed: () => Promise<void>;
      visibleEntryIds: () => Promise<ReadonlySet<string>>;
      capture: (
        authority: ExecutionAuthority,
        key: string,
        evidence: WebEvidence,
      ) => Promise<unknown>;
      clock?: () => Date;
    },
  ) {}
  private now() {
    return this.deps.clock?.() ?? new Date();
  }
  public async settings() {
    const row = await this.deps.repository.read(
      deriveProcessingRunId(this.deps.workspaceId, 'research-settings'),
    );
    return {
      version: row?.version ?? 0,
      settings:
        row?.value.kind === 'settings'
          ? row.value.settings
          : researchSettingsSchema.parse({}),
    };
  }
  private authorize(a: ExecutionAuthority, paid = false) {
    if (a.workspaceId !== this.deps.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    a.require('entries.search');
    if (paid) a.require('models.use');
  }
  async status(a: ExecutionAuthority) {
    this.authorize(a);
    const {settings, version} = await this.settings();
    const rows = (await this.deps.repository.list('charge')).filter(
      (r) =>
        r.value.kind === 'charge' &&
        r.value.at.slice(0, 10) === this.now().toISOString().slice(0, 10),
    );
    return {
      settings,
      version,
      configured: !!this.deps.web,
      dayBasis: 'UTC',
      requests: rows.length,
      estimatedCny: rows.reduce(
        (n, r) => n + (r.value.kind === 'charge' ? r.value.estimatedCny : 0),
        0,
      ),
    };
  }
  private async call<T extends WebEvidence | WebEvidence[]>(
    kind: 'search' | 'fetch',
    action: () => Promise<T>,
  ): Promise<T> {
    return this.deps.queue.run(async () => {
      await this.deps.checkAllowed();
      const charge = await this.deps.repository.withLock(async () => {
        const {settings} = await this.settings();
        if (!settings.enabled)
          throw new OperationError('forbidden', 'web_search_disabled');
        const at = this.now().toISOString();
        const used = (await this.deps.repository.list('charge')).filter(
          (r) =>
            r.value.kind === 'charge' &&
            r.value.at.slice(0, 10) === at.slice(0, 10),
        ).length;
        if (used >= settings.dailyRequests)
          throw new OperationError('rejected', 'web_daily_limit');
        const id = randomUUID();
        const value = {
          kind: 'charge' as const,
          operation: kind,
          at,
          status: 'reserved' as const,
          estimatedCny: 0.005,
        };
        if (
          !(await this.deps.repository.save([{id, expectedVersion: 0, value}]))
        )
          throw new OperationError('conflict', 'web_charge_conflict');
        return {id, value};
      });
      try {
        const output = await action();
        const free = Array.isArray(output) && output.length === 0;
        await this.deps.repository.save([
          {
            id: charge.id,
            expectedVersion: 1,
            value: {
              ...charge.value,
              status: free ? 'free' : 'charged',
              estimatedCny: free ? 0 : 0.005,
            },
          },
        ]);
        return output;
      } catch (error) {
        await this.deps.repository
          .save([
            {
              id: charge.id,
              expectedVersion: 1,
              value: {...charge.value, status: 'unknown'},
            },
          ])
          .catch(() => undefined);
        throw error;
      }
    });
  }
  private prune() {
    const now = this.now().getTime();
    for (const [k, v] of this.sessions)
      if (v.expires < now) this.sessions.delete(k);
    for (const [k, v] of this.answers)
      if (v.expires < now) this.answers.delete(k);
    if (this.sessions.size >= 100 || this.answers.size >= 100)
      throw new OperationError('rejected', 'research_session_limit');
  }
  private actor(a: ExecutionAuthority) {
    return a.identity.kind + ':' + a.identity.id;
  }
  async search(a: ExecutionAuthority, input: unknown) {
    this.authorize(a, true);
    const q = researchCommandSchemas.web_search.parse(input);
    const key = this.actor(a) + ':' + q.requestKey;
    this.prune();
    const prior = this.sessions.get(key);
    if (prior) {
      if (prior.query !== q.query)
        throw new OperationError('conflict', 'idempotency_conflict');
      return prior.promise;
    }
    const promise = this.performSearch(q.query);
    this.sessions.set(key, {
      actor: this.actor(a),
      query: q.query,
      expires: this.now().getTime() + 1800000,
      promise,
    });
    return promise;
  }
  private async performSearch(query: string) {
    if (!this.deps.web)
      throw new OperationError('rejected', 'deepseek_search_unconfigured');
    const web = this.deps.web;
    const {settings} = await this.settings();
    const results = await this.call('search', () =>
      web.search(query, settings.resultLimit),
    );
    const warnings: string[] = [];
    let fetched = 0;
    if (settings.fetchMissing) {
      for (const [i, row] of results.entries()) {
        if (row.contentKind === 'body') continue;
        if (fetched >= 2) break;
        fetched++;
        try {
          results[i] = {
            ...row,
            ...(await this.call('fetch', () => web.fetch(row.url))),
          };
        } catch {
          warnings.push('部分网页正文未能获取，保留摘要。');
        }
      }
    }
    return {sessionId: randomUUID(), results, warnings};
  }
  async capture(a: ExecutionAuthority, input: unknown) {
    this.authorize(a);
    a.require('sources.capture');
    const q = researchCommandSchemas.web_capture.parse(input);
    this.prune();
    for (const session of this.sessions.values()) {
      if (session.actor !== this.actor(a)) continue;
      const result = await session.promise.catch(() => undefined);
      if (result?.sessionId !== q.sessionId) continue;
      const row = result.results[q.index];
      if (row?.contentKind !== 'body')
        throw new OperationError('rejected', 'web_body_required');
      return this.deps.capture(
        a,
        'web-' + q.sessionId + '-' + String(q.index),
        row,
      );
    }
    throw new OperationError('rejected', 'web_session_expired');
  }
  async answer(a: ExecutionAuthority, input: unknown): Promise<unknown> {
    this.authorize(a, true);
    const q = researchCommandSchemas.research_answer.parse(input);
    const query = decodeEntrySearchBody(q.query);
    if (!query) throw new OperationError('invalid_input', 'invalid_query');
    if (query.includePrivate || query.onlyPrivate)
      throw new OperationError('forbidden', 'ai_query_private_scope_forbidden');
    const key = this.actor(a) + ':' + q.requestKey,
      encoded = JSON.stringify(q);
    this.prune();
    const previous = this.answers.get(key);
    if (previous) {
      if (previous.input !== encoded)
        throw new OperationError('conflict', 'idempotency_conflict');
      return this.visibleAnswer(await previous.promise);
    }
    const promise = this.performAnswer(a, q, query);
    this.answers.set(key, {
      input: encoded,
      expires: this.now().getTime() + 1800000,
      promise,
    });
    return this.visibleAnswer(await promise);
  }
  private async visibleAnswer<T>(result: T): Promise<T> {
    const refs = z
      .object({evidence: z.array(z.object({entryId: z.string().optional()}))})
      .parse(result);
    if (refs.evidence.some((e) => e.entryId)) {
      const visible = await this.deps.visibleEntryIds();
      if (refs.evidence.some((e) => e.entryId && !visible.has(e.entryId)))
        throw new OperationError('forbidden', 'research_evidence_unavailable');
    }
    return result;
  }
  private async performAnswer(
    a: ExecutionAuthority,
    q: ReturnType<typeof researchCommandSchemas.research_answer.parse>,
    query: NonNullable<ReturnType<typeof decodeEntrySearchBody>>,
  ) {
    if (!this.deps.answer)
      throw new OperationError('rejected', 'ai_provider_unavailable');
    const evidence: (InformationEntryQuerySynthesisProviderEvidence & {
      origin: 'local' | 'web';
      url?: string;
      retrievedAt?: string;
      entryId?: string;
      entryRevision?: number;
      sessionId?: string;
      index?: number;
      contentKind?: 'body' | 'summary';
    })[] = [];
    const warnings: string[] = [];
    if (q.mode !== 'web') {
      if (!this.deps.local)
        throw new OperationError('rejected', 'local_retrieval_unavailable');
      const local = await this.deps.local.retrieve({
        requestId: randomUUID(),
        question: q.question,
        retrieveForQuestion: true,
        query,
      });
      evidence.push(
        ...local.evidence
          .slice(0, q.mode === 'mixed' ? 4 : 8)
          .map((e) => ({...e, origin: 'local' as const})),
      );
    }
    if (q.mode !== 'local') {
      if (!q.webQuery)
        throw new OperationError('invalid_input', 'web_query_required');
      try {
        const web = await this.search(a, {
          requestKey: q.requestKey,
          query: q.webQuery,
        });
        warnings.push(...web.warnings);
        for (const [index, row] of web.results
          .slice(0, 8 - evidence.length)
          .entries()) {
          const text = row.contentKind === 'body' ? row.content : row.summary;
          const excerpt = Array.from(text).slice(0, 2800).join('');
          evidence.push({
            handle: 'W' + String(index + 1).padStart(2, '0'),
            titlePath: row.title,
            excerpt,
            truncated: excerpt.length < text.length,
            contentKeywords: [],
            domains: [],
            origin: 'web',
            url: row.url,
            retrievedAt: row.retrievedAt,
            contentKind: row.contentKind,
            sessionId: web.sessionId,
            index,
          });
        }
      } catch (error) {
        if (q.mode === 'web') throw error;
        warnings.push('联网搜索未完成，本次回答仅使用库内材料。');
      }
    }
    if (!evidence.length)
      return {
        answer: '当前范围内没有足够的材料。',
        evidenceStatus: 'insufficient',
        claims: [],
        limitations: warnings,
        evidence,
      };
    await this.visibleAnswer({evidence});
    await this.deps.checkAllowed();
    const result = acceptProviderResult(
      await this.deps.answer.synthesize(q.question, evidence),
      new Set(evidence.map((e) => e.handle)),
    );
    return {
      ...result,
      limitations: [
        ...result.limitations,
        ...warnings,
        ...(evidence.some((e) => e.contentKind === 'summary')
          ? ['部分网页只提供摘要，未读取正文。']
          : []),
      ],
      evidence,
    };
  }
  async execute(a: ExecutionAuthority, name: string, input: unknown) {
    switch (name) {
      case 'research_status':
        return this.status(a);
      case 'web_search':
        return this.search(a, input);
      case 'web_capture':
        return this.capture(a, input);
      case 'research_answer':
        return this.answer(a, input);
      default:
        throw new OperationError('invalid_input', 'unknown_operation');
    }
  }
}

export function researchSettingsId(workspaceId: string) {
  return deriveProcessingRunId(workspaceId, 'research-settings');
}
export function settingsFromRecord(r: ResearchRecord | undefined) {
  return r?.value.kind === 'settings'
    ? r.value.settings
    : researchSettingsSchema.parse({});
}
