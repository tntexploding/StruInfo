import {z} from 'zod';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import {
  importMarkdownEvidence,
  type ImportMarkdownEvidenceResult,
} from '../modules/evidence/markdown/markdown_import.js';
import type {
  EvidenceRepositoryPort,
  EvidenceReadRepositoryPort,
} from '../modules/evidence/index.js';
import type {BlobStore} from '../storage/blob_store.js';
import {
  SourceSubscriptionServiceError,
  type SourceSubscriptionServicePort,
  type SourceSubscriptionWrite,
} from '../modules/subscriptions/source_subscription.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

export const captureTextSchema = z
  .object({
    requestKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
    title: z.string().trim().min(1).max(120),
    markdown: z.string().min(1).max(1_048_576),
  })
  .strict();
const common = {
  subscriptionId: z.uuid(),
  label: z.string().trim().min(1).max(120),
  sourceAlias: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(false),
  intervalMinutes: z.number().int().min(15).max(10080).default(60),
};
const url = z.url().max(2048);
export const publicSubscriptionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...common,
      kind: z.literal('rss_atom'),
      feedUrl: url,
      itemLimit: z.number().int().min(1).max(20).default(5),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('github_markdown'),
      repositoryUri: url,
      repositoryRef: z.string().min(1).max(240),
      repositoryPath: z.string().min(1).max(1000),
      profile: z
        .enum(['commonmark-v1', 'ruanyf-weekly-v1'])
        .default('commonmark-v1'),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('web'),
      pageUrl: url,
      additionalPaths: z.array(z.string().max(1000)).max(20).default([]),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('json_api'),
      endpointUrl: url,
      recordsPath: z.string().max(200),
      externalIdPath: z.string().min(1).max(200),
      titlePath: z.string().min(1).max(200),
      bodyPath: z.string().min(1).max(200),
      canonicalUriPath: z.string().max(200).optional(),
      publishedAtPath: z.string().max(200).optional(),
      versionPath: z.string().max(200).optional(),
      recordLimit: z.number().int().min(1).max(32).default(5),
    })
    .strict(),
]);
export class AgentCaptureService {
  public constructor(
    private readonly workspaceId: string,
    private readonly deps: {
      blobStore: BlobStore;
      evidence: EvidenceRepositoryPort;
      evidenceRead: EvidenceReadRepositoryPort;
      subscriptions: SourceSubscriptionServicePort;
    },
  ) {}
  public async importText(
    authority: ExecutionAuthority,
    input: z.infer<typeof captureTextSchema>,
  ): Promise<
    Extract<ImportMarkdownEvidenceResult, {status: 'created' | 'existing'}>
  > {
    this.authorize(authority, true);
    const request = captureTextSchema.parse(input);
    const bytes = new TextEncoder().encode(request.markdown);
    if (bytes.length > 1_048_576)
      throw new OperationError('invalid_input', 'document_too_large');
    const key = [
      'agent-capture',
      authority.identity.kind,
      authority.identity.id,
      request.requestKey,
    ].join(':');
    const snapshotId = deriveProcessingRunId(
      this.workspaceId,
      key + ':snapshot',
    );
    const resourceId = deriveProcessingRunId(
      this.workspaceId,
      key + ':resource',
    );
    const previous = await this.deps.evidenceRead.loadSnapshot(
      this.workspaceId,
      snapshotId,
    );
    const result = await importMarkdownEvidence(
      {blobStore: this.deps.blobStore, evidenceRepository: this.deps.evidence},
      {
        workspaceId: this.workspaceId,
        commandIdempotencyKey: key,
        resource: {
          workspaceId: this.workspaceId,
          resourceId,
          resourceKind: 'manual_text',
          sourceKey: request.title,
        },
        snapshot: {
          workspaceId: this.workspaceId,
          resourceId,
          snapshotId,
          mediaType: 'text/markdown',
          capturedAt: previous?.capturedAt ?? new Date().toISOString(),
        },
        gitObservations: [],
        profile: 'commonmark-v1',
        sourceUtf8: bytes,
      },
    );
    if (result.status === 'created' || result.status === 'existing')
      return result;
    throw new OperationError(
      result.status === 'conflict' ? 'conflict' : 'rejected',
      'code' in result ? result.code : 'capture_failed',
    );
  }
  public async list(authority: ExecutionAuthority) {
    this.authorize(authority, false);
    const current = await this.deps.subscriptions.list();
    return {
      revision: current.revision,
      subscriptions: current.subscriptions
        .filter((s) => !s.isPrivate)
        .map((s) => {
          const publicState = {...s};
          delete publicState.cursor;
          // Authenticated APIs and installed plugin configuration references stay owner-managed.
          if (
            s.kind === 'plugin' ||
            (s.kind === 'json_api' && s.authentication.kind !== 'none')
          )
            return {
              subscriptionId: s.subscriptionId,
              label: s.label,
              kind: s.kind,
              enabled: s.enabled,
              ownerManaged: true,
            };
          return {...publicState, ownerManaged: false};
        }),
    };
  }
  public async put(
    authority: ExecutionAuthority,
    expectedRevision: number,
    input: z.infer<typeof publicSubscriptionSchema>,
  ) {
    this.authorize(authority, true);
    const request = publicSubscriptionSchema.parse(input);
    const current = await this.deps.subscriptions.list();
    if (current.revision !== expectedRevision)
      throw new OperationError('conflict', 'source_subscription_stale');
    const previous = current.subscriptions.find(
      (s) => s.subscriptionId === request.subscriptionId,
    );
    if (previous) this.publicSource(previous);
    const next: SourceSubscriptionWrite = {
      ...request,
      isPrivate: false,
      routeAfterImport: previous?.routeAfterImport ?? false,
      ...(request.kind === 'json_api'
        ? {authentication: {kind: 'none' as const}}
        : {}),
    } as SourceSubscriptionWrite;
    try {
      const saved = await this.deps.subscriptions.replace(expectedRevision, [
        ...current.subscriptions.filter(
          (s) => s.subscriptionId !== request.subscriptionId,
        ),
        next,
      ]);
      return {
        revision: saved.value.revision,
        subscriptionId: request.subscriptionId,
      };
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  public async check(
    authority: ExecutionAuthority,
    subscriptionId: string,
    requestKey: string,
  ) {
    this.authorize(authority, true);
    const source = (await this.deps.subscriptions.list()).subscriptions.find(
      (s) => s.subscriptionId === subscriptionId,
    );
    if (!source)
      throw new OperationError('not_found', 'source_subscription_not_found');
    this.publicSource(source);
    try {
      return await this.deps.subscriptions.runNow(
        subscriptionId,
        deriveProcessingRunId(
          this.workspaceId,
          [
            'agent-source',
            authority.identity.kind,
            authority.identity.id,
            requestKey,
          ].join(':'),
        ),
        (current) => {
          this.publicSource(current);
        },
      );
    } catch (error) {
      throw subscriptionError(error);
    }
  }
  private publicSource(source: SourceSubscriptionWrite) {
    if (
      source.isPrivate ||
      source.kind === 'plugin' ||
      (source.kind === 'json_api' && source.authentication.kind !== 'none')
    )
      throw new OperationError('forbidden', 'source_owner_managed');
  }
  private authorize(authority: ExecutionAuthority, write: boolean) {
    if (authority.workspaceId !== this.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    authority.require(write ? 'sources.capture' : 'documents.read');
  }
}
function subscriptionError(error: unknown) {
  if (error instanceof SourceSubscriptionServiceError)
    return new OperationError(
      error.code === 'source_subscription_stale' ? 'conflict' : 'rejected',
      error.code,
    );
  return error;
}
