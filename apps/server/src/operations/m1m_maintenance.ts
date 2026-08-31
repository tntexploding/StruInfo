import type {M1cWorkspaceTransferSummary} from '../workspace_transfer/m1c_workspace_transfer.js';
import type {
  ApplyBulkIngestionCodexReviewResult,
  BulkIngestionAdjudicationSample,
  BulkIngestionAdjudicationSampleScope,
  BulkIngestionAdjudicationStatus,
  BulkIngestionAdjudicationSummary,
  BulkIngestionBatch,
  BulkIngestionEnrichmentBatch,
  BulkIngestionEnrichmentExceptionCode,
  BulkIngestionPipelineStatus,
  DecideBulkIngestionAdjudicationResult,
  ExecuteBulkIngestionEnrichmentResult,
  ExecuteBulkIngestionResult,
  ExportBulkIngestionCodexReviewResult,
  PlanBulkIngestionResult,
  ProcessingPrivacyScope,
} from '../modules/processing/index.js';

export type M1mMaintenanceRequest =
  | Readonly<{operation: 'preflight'}>
  | Readonly<{operation: 'backup'}>
  | Readonly<{operation: 'restore'; fileName: string}>
  | Readonly<{
      operation: 'ingest_plan';
      idempotencyKey: string;
      privacyScope: ProcessingPrivacyScope;
      limit: number;
    }>
  | Readonly<{
      operation: 'ingest_execute';
      mode: 'run' | 'resume' | 'retry';
      batchId: string;
      maxItems: number;
    }>
  | Readonly<{operation: 'ingest_pause'; batchId: string}>
  | Readonly<{operation: 'ingest_status'; batchId: string}>
  | Readonly<{operation: 'ingest_report'; batchId: string}>
  | Readonly<{
      operation: 'ingest_enrich_execute';
      mode: 'run' | 'resume' | 'retry';
      batchId: string;
      maxItems: number;
    }>
  | Readonly<{operation: 'ingest_enrich_status'; batchId: string}>
  | Readonly<{operation: 'ingest_enrich_report'; batchId: string}>
  | Readonly<{operation: 'ingest_exception_summary'; batchId: string}>
  | Readonly<{
      operation: 'ingest_exception_sample';
      batchId: string;
      exceptionCode?: BulkIngestionEnrichmentExceptionCode;
      status?: BulkIngestionAdjudicationStatus;
      scope: BulkIngestionAdjudicationSampleScope;
      limit: number;
    }>
  | Readonly<{
      operation: 'ingest_exception_adjudicate';
      batchId: string;
      exceptionCode: BulkIngestionEnrichmentExceptionCode;
      fromStatus: BulkIngestionAdjudicationStatus;
      toStatus: BulkIngestionAdjudicationStatus;
      expectedCount: number;
    }>
  | Readonly<{
      operation: 'ingest_review_export';
      batchId: string;
      exceptionCode?: BulkIngestionEnrichmentExceptionCode;
      includePrivate: boolean;
      limit: number;
    }>
  | Readonly<{operation: 'ingest_review_apply'; packetId: string}>
  | Readonly<{
      operation: 'ingest_pipeline_start';
      idempotencyKey: string;
      privacyScope: ProcessingPrivacyScope;
      limit: number;
      maxItems: number;
    }>
  | Readonly<{
      operation: 'ingest_pipeline_advance';
      batchId: string;
      maxItems: number;
    }>
  | Readonly<{operation: 'ingest_pipeline_status'; batchId: string}>;

export type M1mMaintenanceReport =
  | Readonly<{
      event: 'm1m_preflight_completed';
      outcome: 'ready';
    }>
  | Readonly<{
      event: 'm1m_backup_created' | 'm1m_restore_completed';
      outcome: 'succeeded';
      fileName: string;
      byteLength: number;
      sha256?: string;
      blobCount: number;
      tableRowCount: number;
    }>
  | Readonly<{
      event: 'm2_p0a_ingest_empty';
      outcome: 'empty';
    }>
  | Readonly<{
      event:
        | 'm2_p0a_ingest_planned'
        | 'm2_p0a_ingest_executed'
        | 'm2_p0a_ingest_paused'
        | 'm2_p0a_ingest_status';
      outcome:
        | 'planned'
        | 'existing'
        | 'running'
        | 'pause_requested'
        | 'paused'
        | 'succeeded'
        | 'failed';
      batch: Readonly<ReturnType<typeof summarizeBatch>>;
    }>
  | Readonly<{
      event: 'm2_p0a_ingest_report';
      outcome: BulkIngestionBatch['status'];
      batch: Readonly<ReturnType<typeof summarizeBatch>>;
      items: readonly Readonly<{
        ordinal: number;
        snapshotId: string;
        status: string;
        attempt: number;
        plannedEntryCount: number;
        resultEntryCount?: number;
        errorCode?: string;
      }>[];
    }>
  | Readonly<{
      event: 'm2_p0b_enrichment_executed' | 'm2_p0b_enrichment_status';
      outcome: BulkIngestionEnrichmentBatch['status'];
      rulesSha256?: string;
      batch: Readonly<ReturnType<typeof summarizeEnrichmentBatch>>;
    }>
  | Readonly<{
      event: 'm2_p0b_enrichment_report';
      outcome: BulkIngestionEnrichmentBatch['status'];
      batch: Readonly<ReturnType<typeof summarizeEnrichmentBatch>>;
      items: readonly Readonly<{
        ordinal: number;
        snapshotId: string;
        status: string;
        attempt: number;
        resultEntryCount?: number;
        revisedEntryCount?: number;
        addedTagCount?: number;
        associationProjectionCount?: number;
        exceptionEntryCount?: number;
        rulesSha256?: string;
        errorCode?: string;
        exceptions: readonly Readonly<{
          entryId: string;
          entryRevision: number;
          entryRevisionId: string;
          code: string;
        }>[];
      }>[];
    }>
  | Readonly<{
      event: 'm2_p0c_exception_summary';
      outcome: 'ready';
      summary: Readonly<BulkIngestionAdjudicationSummary>;
    }>
  | Readonly<{
      event: 'm2_p0c_exception_sample';
      outcome: 'ready';
      batchId: string;
      samples: readonly Readonly<BulkIngestionAdjudicationSample>[];
    }>
  | Readonly<{
      event: 'm2_p0c_exception_adjudicated';
      outcome: DecideBulkIngestionAdjudicationResult['outcome'];
      appliedCount: number;
      summary: Readonly<BulkIngestionAdjudicationSummary>;
    }>
  | Readonly<{
      event: 'm2_p0e_review_packet_empty';
      outcome: 'empty';
    }>
  | Readonly<{
      event: 'm2_p0e_review_packet_exported';
      outcome: 'created' | 'existing';
      packetId: string;
      packetSha256: string;
      itemCount: number;
      privateItemCount: number;
      packetFileName: string;
      resultFileName: string;
      packetByteLength: number;
      packetFileSha256: string;
    }>
  | Readonly<{
      event: 'm2_p0f_review_result_applied';
      outcome: ApplyBulkIngestionCodexReviewResult['outcome'];
      result: Readonly<ApplyBulkIngestionCodexReviewResult>;
    }>
  | Readonly<{
      event: 'm2_p0g_pipeline_empty';
      outcome: 'empty';
    }>
  | Readonly<{
      event:
        | 'm2_p0g_pipeline_started'
        | 'm2_p0g_pipeline_advanced'
        | 'm2_p0g_pipeline_status';
      outcome: BulkIngestionPipelineStatus['outcome'];
      planOutcome?: 'started' | 'existing';
      status: Readonly<BulkIngestionPipelineStatus>;
    }>;

export interface M1mMaintenanceRuntimePort {
  checkReadiness(): Promise<boolean>;
  backup(): Promise<Readonly<M1cWorkspaceTransferSummary>>;
  restore(fileName: string): Promise<Readonly<M1cWorkspaceTransferSummary>>;
  planIngestion(
    input: Readonly<{
      idempotencyKey: string;
      privacyScope: ProcessingPrivacyScope;
      limit: number;
    }>,
  ): Promise<Readonly<PlanBulkIngestionResult>>;
  executeIngestion(
    input: Readonly<{
      batchId: string;
      mode: 'run' | 'resume' | 'retry';
      maxItems: number;
    }>,
  ): Promise<Readonly<ExecuteBulkIngestionResult>>;
  pauseIngestion(batchId: string): Promise<Readonly<BulkIngestionBatch>>;
  loadIngestion(batchId: string): Promise<Readonly<BulkIngestionBatch>>;
  executeIngestionEnrichment(
    input: Readonly<{
      batchId: string;
      mode: 'run' | 'resume' | 'retry';
      maxItems: number;
    }>,
  ): Promise<Readonly<ExecuteBulkIngestionEnrichmentResult>>;
  loadIngestionEnrichment(
    batchId: string,
  ): Promise<Readonly<BulkIngestionEnrichmentBatch>>;
  summarizeIngestionExceptions(
    batchId: string,
  ): Promise<Readonly<BulkIngestionAdjudicationSummary>>;
  sampleIngestionExceptions(
    input: Readonly<{
      batchId: string;
      exceptionCode?: BulkIngestionEnrichmentExceptionCode;
      status?: BulkIngestionAdjudicationStatus;
      scope: BulkIngestionAdjudicationSampleScope;
      limit: number;
    }>,
  ): Promise<readonly Readonly<BulkIngestionAdjudicationSample>[]>;
  adjudicateIngestionExceptions(
    input: Readonly<{
      batchId: string;
      exceptionCode: BulkIngestionEnrichmentExceptionCode;
      fromStatus: BulkIngestionAdjudicationStatus;
      toStatus: BulkIngestionAdjudicationStatus;
      expectedCount: number;
    }>,
  ): Promise<Readonly<DecideBulkIngestionAdjudicationResult>>;
  exportIngestionReviewPacket(
    input: Readonly<{
      batchId: string;
      exceptionCode?: BulkIngestionEnrichmentExceptionCode;
      includePrivate: boolean;
      limit: number;
    }>,
  ): Promise<Readonly<ExportBulkIngestionCodexReviewResult>>;
  applyIngestionReviewResult(
    packetId: string,
  ): Promise<Readonly<ApplyBulkIngestionCodexReviewResult>>;
  startIngestionPipeline(
    input: Readonly<{
      idempotencyKey: string;
      privacyScope: ProcessingPrivacyScope;
      limit: number;
      maxItems: number;
    }>,
  ): Promise<
    | Readonly<{outcome: 'empty'}>
    | Readonly<{
        outcome: 'started' | 'existing';
        status: Readonly<BulkIngestionPipelineStatus>;
      }>
  >;
  advanceIngestionPipeline(
    batchId: string,
    maxItems: number,
  ): Promise<Readonly<BulkIngestionPipelineStatus>>;
  loadIngestionPipelineStatus(
    batchId: string,
  ): Promise<Readonly<BulkIngestionPipelineStatus>>;
  close(): Promise<void>;
}

export type M1mMaintenanceErrorCode =
  'usage_invalid' | 'database_not_ready' | 'operation_failed';

export class M1mMaintenanceError extends Error {
  public readonly code: M1mMaintenanceErrorCode;

  public constructor(code: M1mMaintenanceErrorCode) {
    super('The StruInfo maintenance operation failed.');
    this.name = 'M1mMaintenanceError';
    this.code = code;
  }
}

const BACKUP_FILE_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.personal-data\.json$/u;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function decodeM1mMaintenanceRequest(
  arguments_: readonly string[],
): Readonly<M1mMaintenanceRequest> {
  if (arguments_.length === 1 && arguments_[0] === 'preflight') {
    return Object.freeze({operation: 'preflight'});
  }
  if (arguments_.length === 1 && arguments_[0] === 'backup') {
    return Object.freeze({operation: 'backup'});
  }
  if (
    arguments_.length === 3 &&
    arguments_[0] === 'restore' &&
    arguments_[1] === '--file' &&
    BACKUP_FILE_NAME_PATTERN.test(arguments_[2] ?? '')
  ) {
    return Object.freeze({operation: 'restore', fileName: arguments_[2] ?? ''});
  }
  const ingest = decodeIngestRequest(arguments_);
  if (ingest !== undefined) return ingest;
  throw new M1mMaintenanceError('usage_invalid');
}

export async function executeM1mMaintenance(
  request: Readonly<M1mMaintenanceRequest>,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  if (!(await runtime.checkReadiness())) {
    throw new M1mMaintenanceError('database_not_ready');
  }
  if (request.operation === 'preflight') {
    return Object.freeze({
      event: 'm1m_preflight_completed' as const,
      outcome: 'ready' as const,
    });
  }

  if (
    request.operation === 'ingest_plan' ||
    request.operation === 'ingest_execute' ||
    request.operation === 'ingest_pause' ||
    request.operation === 'ingest_status' ||
    request.operation === 'ingest_report'
  ) {
    return executeIngestionMaintenance(request, runtime);
  }
  if (
    request.operation === 'ingest_enrich_execute' ||
    request.operation === 'ingest_enrich_status' ||
    request.operation === 'ingest_enrich_report'
  ) {
    return executeIngestionEnrichmentMaintenance(request, runtime);
  }
  if (
    request.operation === 'ingest_exception_summary' ||
    request.operation === 'ingest_exception_sample' ||
    request.operation === 'ingest_exception_adjudicate'
  ) {
    return executeIngestionAdjudicationMaintenance(request, runtime);
  }
  if (
    request.operation === 'ingest_review_export' ||
    request.operation === 'ingest_review_apply'
  ) {
    return executeIngestionCodexReviewMaintenance(request, runtime);
  }
  if (
    request.operation === 'ingest_pipeline_start' ||
    request.operation === 'ingest_pipeline_advance' ||
    request.operation === 'ingest_pipeline_status'
  ) {
    return executeIngestionPipelineMaintenance(request, runtime);
  }

  let summary: Readonly<M1cWorkspaceTransferSummary>;
  try {
    summary =
      request.operation === 'backup'
        ? await runtime.backup()
        : await runtime.restore(request.fileName);
  } catch {
    throw new M1mMaintenanceError('operation_failed');
  }
  return Object.freeze({
    event:
      request.operation === 'backup'
        ? ('m1m_backup_created' as const)
        : ('m1m_restore_completed' as const),
    outcome: 'succeeded' as const,
    fileName: summary.fileName,
    byteLength: summary.byteLength,
    ...(summary.sha256 === undefined ? {} : {sha256: summary.sha256}),
    blobCount: summary.blobCount,
    tableRowCount: Object.values(summary.tableCounts).reduce(
      (total, count) => total + count,
      0,
    ),
  });
}

function decodeIngestRequest(
  arguments_: readonly string[],
): Readonly<M1mMaintenanceRequest> | undefined {
  if (arguments_[0] !== 'ingest' || arguments_.length < 2) return undefined;
  const action = arguments_[1];
  const flags = decodeFlags(arguments_.slice(2));
  if (flags === undefined) throw new M1mMaintenanceError('usage_invalid');
  if (action === 'plan') {
    const idempotencyKey = flags.get('key');
    const privacyScope = flags.get('scope') ?? 'public_only';
    const limit = parseBoundedInteger(flags.get('limit') ?? '500', 1, 500);
    if (
      !onlyFlags(flags, ['key', 'scope', 'limit']) ||
      !validIdempotencyKey(idempotencyKey) ||
      !['public_only', 'include_private', 'private_only'].includes(privacyScope)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_plan' as const,
      idempotencyKey,
      privacyScope: privacyScope as ProcessingPrivacyScope,
      limit,
    });
  }
  if (['run', 'resume', 'retry'].includes(action ?? '')) {
    const batchId = flags.get('batch');
    const maxItems = parseBoundedInteger(
      flags.get('max-items') ?? '500',
      1,
      500,
    );
    if (
      !onlyFlags(flags, ['batch', 'max-items']) ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_execute' as const,
      mode: action as 'run' | 'resume' | 'retry',
      batchId,
      maxItems,
    });
  }
  if (['enrich', 'enrich-resume', 'enrich-retry'].includes(action ?? '')) {
    const batchId = flags.get('batch');
    const maxItems = parseBoundedInteger(
      flags.get('max-items') ?? '500',
      1,
      500,
    );
    if (
      !onlyFlags(flags, ['batch', 'max-items']) ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_enrich_execute' as const,
      mode:
        action === 'enrich'
          ? ('run' as const)
          : action === 'enrich-resume'
            ? ('resume' as const)
            : ('retry' as const),
      batchId,
      maxItems,
    });
  }
  if (['enrich-status', 'enrich-report'].includes(action ?? '')) {
    const batchId = flags.get('batch');
    if (
      flags.size !== 1 ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation:
        action === 'enrich-report'
          ? ('ingest_enrich_report' as const)
          : ('ingest_enrich_status' as const),
      batchId,
    });
  }
  if (action === 'exceptions-summary') {
    const batchId = flags.get('batch');
    if (
      flags.size !== 1 ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_exception_summary' as const,
      batchId,
    });
  }
  if (action === 'exceptions-sample') {
    const batchId = flags.get('batch');
    const exceptionCode = flags.get('code');
    const status = flags.get('status');
    const scope = flags.get('scope') ?? 'current';
    const limit = parseBoundedInteger(flags.get('limit') ?? '20', 1, 50);
    if (
      !onlyFlags(flags, ['batch', 'code', 'status', 'scope', 'limit']) ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId) ||
      (exceptionCode !== undefined && !validExceptionCode(exceptionCode)) ||
      (status !== undefined && !validAdjudicationStatus(status)) ||
      !['current', 'stale', 'all'].includes(scope)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_exception_sample' as const,
      batchId,
      ...(exceptionCode === undefined ? {} : {exceptionCode}),
      ...(status === undefined ? {} : {status}),
      scope: scope as BulkIngestionAdjudicationSampleScope,
      limit,
    });
  }
  if (action === 'exceptions-adjudicate') {
    const batchId = flags.get('batch');
    const exceptionCode = flags.get('code');
    const fromStatus = flags.get('from');
    const toStatus = flags.get('to');
    const expectedCount = parseBoundedInteger(
      flags.get('expected-count') ?? '',
      1,
      50_000,
    );
    if (
      !onlyFlags(flags, ['batch', 'code', 'from', 'to', 'expected-count']) ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId) ||
      !validExceptionCode(exceptionCode) ||
      !validAdjudicationStatus(fromStatus) ||
      !validAdjudicationStatus(toStatus) ||
      fromStatus === toStatus
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_exception_adjudicate' as const,
      batchId,
      exceptionCode,
      fromStatus,
      toStatus,
      expectedCount,
    });
  }
  if (action === 'review-export') {
    const batchId = flags.get('batch');
    const exceptionCode = flags.get('code');
    const includePrivate = parseBoolean(
      flags.get('include-private') ?? 'false',
    );
    const limit = parseBoundedInteger(flags.get('limit') ?? '12', 1, 20);
    if (
      !onlyFlags(flags, ['batch', 'code', 'include-private', 'limit']) ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId) ||
      (exceptionCode !== undefined && !validExceptionCode(exceptionCode))
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_review_export' as const,
      batchId,
      ...(exceptionCode === undefined ? {} : {exceptionCode}),
      includePrivate,
      limit,
    });
  }
  if (action === 'review-apply') {
    const packetId = flags.get('packet');
    if (
      flags.size !== 1 ||
      packetId === undefined ||
      !CANONICAL_UUID.test(packetId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_review_apply' as const,
      packetId,
    });
  }
  if (action === 'pipeline-start') {
    const idempotencyKey = flags.get('key');
    const privacyScope = flags.get('scope') ?? 'public_only';
    const limit = parseBoundedInteger(flags.get('limit') ?? '500', 1, 500);
    const maxItems = parseBoundedInteger(
      flags.get('max-items') ?? '500',
      1,
      500,
    );
    if (
      !onlyFlags(flags, ['key', 'scope', 'limit', 'max-items']) ||
      !validIdempotencyKey(idempotencyKey) ||
      !['public_only', 'include_private', 'private_only'].includes(privacyScope)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_pipeline_start' as const,
      idempotencyKey,
      privacyScope: privacyScope as ProcessingPrivacyScope,
      limit,
      maxItems,
    });
  }
  if (action === 'pipeline-advance') {
    const batchId = flags.get('batch');
    const maxItems = parseBoundedInteger(
      flags.get('max-items') ?? '500',
      1,
      500,
    );
    if (
      !onlyFlags(flags, ['batch', 'max-items']) ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_pipeline_advance' as const,
      batchId,
      maxItems,
    });
  }
  if (action === 'pipeline-status') {
    const batchId = flags.get('batch');
    if (
      flags.size !== 1 ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'ingest_pipeline_status' as const,
      batchId,
    });
  }
  if (['pause', 'status', 'report'].includes(action ?? '')) {
    const batchId = flags.get('batch');
    if (
      flags.size !== 1 ||
      batchId === undefined ||
      !CANONICAL_UUID.test(batchId)
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation:
        action === 'pause'
          ? ('ingest_pause' as const)
          : action === 'report'
            ? ('ingest_report' as const)
            : ('ingest_status' as const),
      batchId,
    });
  }
  throw new M1mMaintenanceError('usage_invalid');
}

function validIdempotencyKey(value: string | undefined): value is string {
  if (value === undefined || value.length === 0) return false;
  if (value.trim() !== value || Array.from(value).length > 160) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return false;
  }
  return true;
}

function validExceptionCode(
  value: string | undefined,
): value is BulkIngestionEnrichmentExceptionCode {
  return [
    'automatic_tagging_disabled',
    'no_deterministic_tags',
    'keyword_capacity_reached',
  ].includes(value ?? '');
}

function validAdjudicationStatus(
  value: string | undefined,
): value is BulkIngestionAdjudicationStatus {
  return ['pending', 'accepted', 'manual_review', 'deferred'].includes(
    value ?? '',
  );
}

function decodeFlags(
  values: readonly string[],
): ReadonlyMap<string, string> | undefined {
  if (values.length % 2 !== 0) return undefined;
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !flag.startsWith('--') ||
      flag.length < 3 ||
      result.has(flag.slice(2))
    ) {
      return undefined;
    }
    result.set(flag.slice(2), value);
  }
  return result;
}

function onlyFlags(
  flags: ReadonlyMap<string, string>,
  allowed: readonly string[],
): boolean {
  return [...flags.keys()].every((key) => allowed.includes(key));
}

function parseBoundedInteger(
  value: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new M1mMaintenanceError('usage_invalid');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new M1mMaintenanceError('usage_invalid');
  }
  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new M1mMaintenanceError('usage_invalid');
}

async function executeIngestionMaintenance(
  request: Extract<
    M1mMaintenanceRequest,
    {
      operation:
        | 'ingest_plan'
        | 'ingest_execute'
        | 'ingest_pause'
        | 'ingest_status'
        | 'ingest_report';
    }
  >,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  if (request.operation === 'ingest_plan') {
    const result = await runtime.planIngestion(request);
    if (result.outcome === 'empty') {
      return Object.freeze({
        event: 'm2_p0a_ingest_empty' as const,
        outcome: 'empty' as const,
      });
    }
    return Object.freeze({
      event: 'm2_p0a_ingest_planned' as const,
      outcome:
        result.outcome === 'created'
          ? ('planned' as const)
          : ('existing' as const),
      batch: summarizeBatch(result.batch),
    });
  }
  if (request.operation === 'ingest_execute') {
    const result = await runtime.executeIngestion(request);
    return Object.freeze({
      event: 'm2_p0a_ingest_executed' as const,
      outcome: result.outcome,
      batch: summarizeBatch(result.batch),
    });
  }
  if (request.operation === 'ingest_pause') {
    const batch = await runtime.pauseIngestion(request.batchId);
    return Object.freeze({
      event: 'm2_p0a_ingest_paused' as const,
      outcome: batch.status,
      batch: summarizeBatch(batch),
    });
  }
  const batch = await runtime.loadIngestion(request.batchId);
  if (request.operation === 'ingest_report') {
    return Object.freeze({
      event: 'm2_p0a_ingest_report' as const,
      outcome: batch.status,
      batch: summarizeBatch(batch),
      items: Object.freeze(
        batch.items.map((item) =>
          Object.freeze({
            ordinal: item.ordinal,
            snapshotId: item.snapshotId,
            status: item.status,
            attempt: item.attempt,
            plannedEntryCount: item.plannedEntryCount,
            ...(item.resultEntryCount === undefined
              ? {}
              : {resultEntryCount: item.resultEntryCount}),
            ...(item.errorCode === undefined
              ? {}
              : {errorCode: item.errorCode}),
          }),
        ),
      ),
    });
  }
  return Object.freeze({
    event: 'm2_p0a_ingest_status' as const,
    outcome: batch.status,
    batch: summarizeBatch(batch),
  });
}

function summarizeBatch(batch: Readonly<BulkIngestionBatch>) {
  return Object.freeze({
    batchId: batch.batchId,
    status: batch.status,
    privacyScope: batch.privacyScope,
    attempt: batch.attempt,
    snapshotCount: batch.snapshotCount,
    plannedEntryCount: batch.plannedEntryCount,
    succeededSnapshotCount: batch.succeededSnapshotCount,
    succeededEntryCount: batch.succeededEntryCount,
    failedSnapshotCount: batch.failedSnapshotCount,
    pendingSnapshotCount: batch.items.filter(
      (item) => item.status === 'pending',
    ).length,
  });
}

async function executeIngestionEnrichmentMaintenance(
  request: Extract<
    M1mMaintenanceRequest,
    {operation: `ingest_enrich_${string}`}
  >,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  if (request.operation === 'ingest_enrich_execute') {
    const result = await runtime.executeIngestionEnrichment(request);
    return Object.freeze({
      event: 'm2_p0b_enrichment_executed' as const,
      outcome: result.outcome,
      rulesSha256: result.rulesSha256,
      batch: summarizeEnrichmentBatch(result.batch),
    });
  }
  const batch = await runtime.loadIngestionEnrichment(request.batchId);
  if (request.operation === 'ingest_enrich_report') {
    return Object.freeze({
      event: 'm2_p0b_enrichment_report' as const,
      outcome: batch.status,
      batch: summarizeEnrichmentBatch(batch),
      items: Object.freeze(
        batch.items.map((item) =>
          Object.freeze({
            ordinal: item.ordinal,
            snapshotId: item.snapshotId,
            status: item.status,
            attempt: item.attempt,
            ...(item.resultEntryCount === undefined
              ? {}
              : {resultEntryCount: item.resultEntryCount}),
            ...(item.revisedEntryCount === undefined
              ? {}
              : {revisedEntryCount: item.revisedEntryCount}),
            ...(item.addedTagCount === undefined
              ? {}
              : {addedTagCount: item.addedTagCount}),
            ...(item.associationProjectionCount === undefined
              ? {}
              : {
                  associationProjectionCount: item.associationProjectionCount,
                }),
            ...(item.exceptionEntryCount === undefined
              ? {}
              : {exceptionEntryCount: item.exceptionEntryCount}),
            ...(item.rulesSha256 === undefined
              ? {}
              : {rulesSha256: item.rulesSha256}),
            ...(item.errorCode === undefined
              ? {}
              : {errorCode: item.errorCode}),
            exceptions: Object.freeze(
              item.exceptions.map((exception) => Object.freeze({...exception})),
            ),
          }),
        ),
      ),
    });
  }
  return Object.freeze({
    event: 'm2_p0b_enrichment_status' as const,
    outcome: batch.status,
    batch: summarizeEnrichmentBatch(batch),
  });
}

function summarizeEnrichmentBatch(
  batch: Readonly<BulkIngestionEnrichmentBatch>,
) {
  return Object.freeze({
    batchId: batch.batchId,
    status: batch.status,
    privacyScope: batch.privacyScope,
    attempt: batch.attempt,
    snapshotCount: batch.snapshotCount,
    plannedEntryCount: batch.plannedEntryCount,
    succeededSnapshotCount: batch.succeededSnapshotCount,
    succeededEntryCount: batch.succeededEntryCount,
    revisedEntryCount: batch.revisedEntryCount,
    addedTagCount: batch.addedTagCount,
    associationProjectionCount: batch.associationProjectionCount,
    exceptionEntryCount: batch.exceptionEntryCount,
    failedSnapshotCount: batch.failedSnapshotCount,
    pendingSnapshotCount: batch.pendingSnapshotCount,
    runningSnapshotCount: batch.runningSnapshotCount,
  });
}

async function executeIngestionAdjudicationMaintenance(
  request: Extract<
    M1mMaintenanceRequest,
    {operation: `ingest_exception_${string}`}
  >,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  if (request.operation === 'ingest_exception_summary') {
    return Object.freeze({
      event: 'm2_p0c_exception_summary' as const,
      outcome: 'ready' as const,
      summary: await runtime.summarizeIngestionExceptions(request.batchId),
    });
  }
  if (request.operation === 'ingest_exception_sample') {
    return Object.freeze({
      event: 'm2_p0c_exception_sample' as const,
      outcome: 'ready' as const,
      batchId: request.batchId,
      samples: await runtime.sampleIngestionExceptions(request),
    });
  }
  const result = await runtime.adjudicateIngestionExceptions(request);
  return Object.freeze({
    event: 'm2_p0c_exception_adjudicated' as const,
    outcome: result.outcome,
    appliedCount: result.appliedCount,
    summary: result.summary,
  });
}

async function executeIngestionCodexReviewMaintenance(
  request: Extract<
    M1mMaintenanceRequest,
    {operation: 'ingest_review_export' | 'ingest_review_apply'}
  >,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  if (request.operation === 'ingest_review_export') {
    const result = await runtime.exportIngestionReviewPacket(request);
    if (result.outcome === 'empty') {
      return Object.freeze({
        event: 'm2_p0e_review_packet_empty' as const,
        outcome: 'empty' as const,
      });
    }
    return Object.freeze({
      event: 'm2_p0e_review_packet_exported' as const,
      ...result,
    });
  }
  const result = await runtime.applyIngestionReviewResult(request.packetId);
  return Object.freeze({
    event: 'm2_p0f_review_result_applied' as const,
    outcome: result.outcome,
    result,
  });
}

async function executeIngestionPipelineMaintenance(
  request: Extract<
    M1mMaintenanceRequest,
    {
      operation:
        | 'ingest_pipeline_start'
        | 'ingest_pipeline_advance'
        | 'ingest_pipeline_status';
    }
  >,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  if (request.operation === 'ingest_pipeline_start') {
    const result = await runtime.startIngestionPipeline(request);
    if (result.outcome === 'empty') {
      return Object.freeze({
        event: 'm2_p0g_pipeline_empty' as const,
        outcome: 'empty' as const,
      });
    }
    return Object.freeze({
      event: 'm2_p0g_pipeline_started' as const,
      outcome: result.status.outcome,
      planOutcome: result.outcome,
      status: result.status,
    });
  }
  if (request.operation === 'ingest_pipeline_advance') {
    const status = await runtime.advanceIngestionPipeline(
      request.batchId,
      request.maxItems,
    );
    return Object.freeze({
      event: 'm2_p0g_pipeline_advanced' as const,
      outcome: status.outcome,
      status,
    });
  }
  const status = await runtime.loadIngestionPipelineStatus(request.batchId);
  return Object.freeze({
    event: 'm2_p0g_pipeline_status' as const,
    outcome: status.outcome,
    status,
  });
}
