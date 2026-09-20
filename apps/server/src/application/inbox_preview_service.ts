import {
  EntryTranslationError,
  ENTRY_TRANSLATION_MAXIMUM_SOURCE_CHARACTERS,
  validateEntryTranslationText,
  type EntryTranslationProviderPort,
  type EntryTranslationText,
} from '../modules/entries/information_entry_translation.js';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {isAiDispatchWait} from '../modules/processing/ai_price_policy.js';
type RootContent = ReturnType<typeof fromMarkdown>['children'][number];
import {
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
} from '../modules/evidence/index.js';
import type {BlobStore} from '../storage/blob_store.js';
import type {
  DocumentIntakeRepository,
  InboxSummary,
  InboxSummaryProvider,
} from './document_intake_contract.js';
import {inboxSummarySchema} from './document_intake_contract.js';
import type {IngestionOrigin} from './ingestion_contract.js';
import type {EvidenceSnapshotSummary} from '../modules/evidence/index.js';
import type {IntakeRecord} from './document_intake_contract.js';
import {normalizeSourceConnectorAlias} from '../modules/subscriptions/source_connector.js';

interface InboxSubscriptionSource {
  subscriptionId: string;
  label: string;
  sourceAlias?: string;
  kind?: string;
  isPrivate?: boolean;
}
import {OperationError, assertOperationId} from './operation_error.js';

function plain(node: RootContent): string {
  if (
    node.type === 'html' ||
    node.type === 'image' ||
    node.type === 'definition'
  )
    return '';
  if ('children' in node)
    return node.children
      .map(plain)
      .join(['list', 'listItem', 'blockquote'].includes(node.type) ? ' ' : '');
  return 'value' in node ? node.value : '';
}
export function inboxTextPreview(text: string) {
  const nodes = fromMarkdown(text).children;
  const title = nodes.find((node) => node.type === 'heading');
  const paragraphs = nodes
    .filter((node) => node.type !== 'heading' && node.type !== 'code')
    .map(plain)
    .map((value) => value.replace(/\s+/gu, ' ').trim())
    .filter((value) => value && value !== '查看原始条目');
  return {
    title: Array.from(title ? plain(title) : '')
      .slice(0, 240)
      .join(''),
    excerpt: Array.from(paragraphs.join(' ')).slice(0, 220).join(''),
  };
}

/** Read previews and explicit one-call summaries; never an admission or processing step. */
export class InboxPreviewService {
  private readonly translations = new Map<
    string,
    Promise<Readonly<EntryTranslationText>>
  >();
  private readonly running = new Map<string, Promise<InboxSummary>>();
  public constructor(
    private readonly deps: {
      workspaceId: string;
      evidence: EvidenceReadRepositoryPort;
      blobStore: BlobStore;
      repository: DocumentIntakeRepository;
      origin: (snapshotId: string) => Promise<IngestionOrigin | undefined>;
      sources: () => Promise<readonly InboxSubscriptionSource[]>;
      checkModelCall: () => Promise<void>;
      provider?: InboxSummaryProvider;
      translationProvider?: EntryTranslationProviderPort;
      now?: () => string;
    },
  ) {}
  private async snapshot(id: string, includePrivate = false) {
    assertOperationId(id, 'snapshotId');
    const snapshot = await this.deps.evidence.loadSnapshot(
      this.deps.workspaceId,
      id,
    );
    if (!snapshot) throw new OperationError('not_found', 'snapshot_not_found');
    if (snapshot.isPrivate && !includePrivate)
      throw new OperationError('forbidden', 'private_model_transfer_forbidden');
    return snapshot;
  }
  private async text(id: string, includePrivate = false) {
    const snapshot = await this.snapshot(id, includePrivate);
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      this.deps.blobStore,
    );
    return {snapshot, text: materialized.structures[0]?.normalizedText ?? ''};
  }
  private async sourceOrigin(
    snapshot: EvidenceSnapshotSummary,
    record: IntakeRecord | undefined,
    sources: readonly InboxSubscriptionSource[],
  ): Promise<IngestionOrigin | undefined> {
    const recorded =
      record?.value.captureOrigin ??
      (await this.deps.origin(snapshot.snapshotId));
    if (recorded) return recorded;
    // Older receipts predate durable provenance. Resolve only a unique exact
    // capture alias; a matching website alone does not establish a subscription.
    const alias =
      snapshot.resourceKind === 'remote_document'
        ? /^(.*)#[a-f0-9]{24}$/u.exec(snapshot.sourceKey)?.[1]
        : snapshot.resourceKind === 'git_file'
          ? snapshot.sourceKey
          : undefined;
    if (!alias) return undefined;
    const matches = sources.filter(
      (source) =>
        source.sourceAlias &&
        (snapshot.resourceKind === 'remote_document'
          ? source.kind !== 'github_markdown' &&
            normalizeSourceConnectorAlias(source.sourceAlias) === alias
          : source.kind === 'github_markdown' && source.sourceAlias === alias),
    );
    return matches.length === 1 && matches[0]
      ? {kind: 'subscription', subscriptionId: matches[0].subscriptionId}
      : undefined;
  }
  public async origins(snapshotIds: readonly string[], includePrivate = false) {
    const sources = (await this.deps.sources()).filter(
      (source) => includePrivate || !source.isPrivate,
    );
    const origins: {
      snapshotId: string;
      subscriptionId?: string;
      kind: string;
    }[] = [];
    for (const snapshotId of snapshotIds) {
      const snapshot = await this.snapshot(snapshotId, includePrivate);
      const record = await this.deps.repository.read(snapshotId);
      const origin = await this.sourceOrigin(snapshot, record, sources);
      origins.push({
        snapshotId,
        kind: origin?.kind ?? snapshot.resourceKind,
        ...(origin?.kind === 'subscription'
          ? {subscriptionId: origin.subscriptionId}
          : {}),
      });
    }
    return {origins};
  }
  public async preview(snapshotIds: readonly string[], includePrivate = false) {
    const sources = (await this.deps.sources()).filter(
      (source) => includePrivate || !source.isPrivate,
    );
    const previews = [];
    const failed: {snapshotId: string; code: string}[] = [];
    for (const snapshotId of snapshotIds) {
      try {
        const {snapshot, text} = await this.text(snapshotId, includePrivate);
        const record = await this.deps.repository.read(snapshotId);
        const origin = await this.sourceOrigin(snapshot, record, sources);
        const source =
          origin?.kind === 'subscription'
            ? sources.find(
                (item) =>
                  item.subscriptionId === origin.subscriptionId &&
                  (!item.isPrivate || includePrivate),
              )
            : undefined;
        let host = '';
        try {
          host = new URL(snapshot.canonicalUri ?? '').hostname;
        } catch {
          /* Local document. */
        }
        const kind =
          source?.kind ??
          (origin?.kind === 'subscription'
            ? 'subscription'
            : snapshot.resourceKind);
        const fallback =
          snapshot.resourceKind === 'uploaded_file'
            ? '手动上传'
            : snapshot.resourceKind === 'manual_text'
              ? '手动导入'
              : host || snapshot.sourceKey.replace(/#[a-f0-9]{24}$/u, '');
        const content = inboxTextPreview(text);
        previews.push({
          snapshotId,
          ...(content.title ? {title: content.title} : {}),
          excerpt: content.excerpt,
          source: {name: source?.label ?? fallback, kind, host},
          ...(record?.value.inboxSummary
            ? {summary: record.value.inboxSummary}
            : {}),
        });
      } catch (error) {
        failed.push({
          snapshotId,
          code:
            error instanceof OperationError
              ? error.code
              : 'inbox_preview_failed',
        });
      }
    }
    return {previews, failed};
  }
  /** A single owner-requested reading aid: no receipt, Entry or evidence writes. */
  public async translate(
    snapshotId: string,
  ): Promise<Readonly<EntryTranslationText>> {
    await this.snapshot(snapshotId);
    const active = this.translations.get(snapshotId);
    if (active) return active;
    const work = (async () => {
      if (!this.deps.translationProvider)
        throw new OperationError('rejected', 'ai_not_configured');
      await this.deps.checkModelCall();
      const {text} = await this.text(snapshotId);
      if (!text.trim())
        throw new OperationError('rejected', 'inbox_summary_empty_source');
      const title = inboxTextPreview(text).title;
      if (
        Array.from(text + title).length >
        ENTRY_TRANSLATION_MAXIMUM_SOURCE_CHARACTERS
      )
        throw new OperationError('rejected', 'translation_input_too_large');
      return validateEntryTranslationText(
        await this.deps.translationProvider.translate({title, body: text}),
      );
    })().catch((error: unknown) => {
      if (isAiDispatchWait(error) || error instanceof EntryTranslationError)
        throw new OperationError('rejected', error.code);
      throw error;
    });
    this.translations.set(snapshotId, work);
    try {
      return await work;
    } finally {
      this.translations.delete(snapshotId);
    }
  }
  public async summarize(snapshotId: string): Promise<InboxSummary> {
    await this.snapshot(snapshotId);
    const cached = (await this.deps.repository.read(snapshotId))?.value
      .inboxSummary;
    if (cached) return cached;
    const active = this.running.get(snapshotId);
    if (active) return active;
    const work = this.generate(snapshotId).catch((error: unknown) => {
      if (isAiDispatchWait(error))
        throw new OperationError('rejected', error.code);
      throw error;
    });
    this.running.set(snapshotId, work);
    try {
      return await work;
    } finally {
      this.running.delete(snapshotId);
    }
  }
  private async generate(snapshotId: string): Promise<InboxSummary> {
    if (!this.deps.provider || !this.deps.repository.saveInboxSummary)
      throw new OperationError('rejected', 'ai_not_configured');
    await this.deps.checkModelCall();
    const {text} = await this.text(snapshotId);
    if (!text.trim())
      throw new OperationError('rejected', 'inbox_summary_empty_source');
    // Keep the whole received text within the existing adapter input budget; never silently truncate it.
    if (Array.from(text).length > 120_000)
      throw new OperationError('rejected', 'ai_intake_input_too_large');
    const result = await this.deps.provider.summarizeInbox({text});
    const summary = inboxSummarySchema.parse({
      ...result,
      model: this.deps.provider.model,
      promptVersion: 'struinfo.inbox-summary.v1',
      createdAt: this.deps.now?.() ?? new Date().toISOString(),
    });
    await this.deps.repository.saveInboxSummary(snapshotId, summary);
    return (
      (await this.deps.repository.read(snapshotId))?.value.inboxSummary ??
      summary
    );
  }
}
