import {researchRecordValueSchema} from '../application/research_contract.js';
import {topicRecordValueSchema} from '../modules/entries/content_topics.js';
import {structuredAnnotationsSchema} from '../modules/entries/structured_annotations.js';
import {Buffer} from 'node:buffer';
import {
  publicationContentSchema,
  organizationStatusSchema,
} from '../application/document_publication_contract.js';
import {reportStateSchema} from '../application/report_contract.js';
import {validateReportState} from '../application/report_content.js';
import {intakeRecordValueSchema} from '../application/document_intake_contract.js';

import {
  encodeCanonicalJson,
  normalizeJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from '../serialization/canonical_json.js';
import {
  DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_VALUES,
  type WorkspaceBundleSectionCodec,
} from './workspace_bundle.js';

export const M1E_PROCESSING_BUNDLE_SECTION_TYPE = 'struinfo.m1e-processing';
export const M1E_PROCESSING_BUNDLE_SECTION_VERSION = 19;
export const M1E_PROCESSING_BUNDLE_SCHEMA = 'struinfo.m1e-processing.v19';
export const M1E_PROCESSING_VERSION_FOURTEEN_BUNDLE_SECTION_VERSION = 14;
export const M1E_PROCESSING_VERSION_FOURTEEN_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v14';
export const M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_SECTION_VERSION = 13;
export const M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v13';
export const M1E_PROCESSING_VERSION_TWELVE_BUNDLE_SECTION_VERSION = 12;
export const M1E_PROCESSING_VERSION_TWELVE_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v12';
export const M1E_PROCESSING_VERSION_ELEVEN_BUNDLE_SECTION_VERSION = 11;
export const M1E_PROCESSING_VERSION_ELEVEN_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v11';
export const M1E_PROCESSING_VERSION_TEN_BUNDLE_SECTION_VERSION = 10;
export const M1E_PROCESSING_VERSION_TEN_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v10';
export const M1E_PROCESSING_VERSION_NINE_BUNDLE_SECTION_VERSION = 9;
export const M1E_PROCESSING_VERSION_NINE_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v9';
export const M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SECTION_VERSION = 8;
export const M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v8';
export const M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SECTION_VERSION = 7;
export const M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v7';
export const M1E_PROCESSING_VERSION_SIX_BUNDLE_SECTION_VERSION = 6;
export const M1E_PROCESSING_VERSION_SIX_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v6';
export const M1E_PROCESSING_VERSION_FIVE_BUNDLE_SECTION_VERSION = 5;
export const M1E_PROCESSING_VERSION_FIVE_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v5';
export const M1E_PROCESSING_VERSION_FOUR_BUNDLE_SECTION_VERSION = 4;
export const M1E_PROCESSING_VERSION_FOUR_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v4';
export const M1E_PROCESSING_VERSION_THREE_BUNDLE_SECTION_VERSION = 3;
export const M1E_PROCESSING_VERSION_THREE_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v3';
export const M1E_PROCESSING_VERSION_TWO_BUNDLE_SECTION_VERSION = 2;
export const M1E_PROCESSING_VERSION_TWO_BUNDLE_SCHEMA =
  'struinfo.m1e-processing.v2';
export const M1E_PROCESSING_LEGACY_BUNDLE_SECTION_VERSION = 1;
export const M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA = 'struinfo.m1e-processing.v1';

const PROCESSING_VALUE_LIMIT = DEFAULT_MAXIMUM_WORKSPACE_BUNDLE_VALUES;
const ROW_BYTE_LIMIT = 1024 * 1024;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface M1eProcessingTableDescriptor {
  readonly name: string;
  readonly columns: readonly string[];
}

export type M1eProcessingRow = Readonly<Record<string, JsonPrimitive>>;

export interface M1eProcessingTableSnapshot {
  readonly name: string;
  readonly rows: readonly M1eProcessingRow[];
}

export interface M1eProcessingSnapshot {
  readonly schemaVersion: typeof M1E_PROCESSING_BUNDLE_SCHEMA;
  readonly tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}

export const M1E_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze([
    table('processing_run', [
      'workspace_id',
      'run_id',
      'idempotency_key',
      'origin',
      'provider_key',
      'status',
      'target_snapshot_id',
      'privacy_scope',
      'current_stage',
      'current_step',
      'completed_units',
      'total_units',
      'attempt',
      'current_version',
      'error_code',
      'created_at',
      'started_at',
      'finished_at',
      'updated_at',
    ]),
    table('processing_proposal', [
      'workspace_id',
      'proposal_id',
      'run_id',
      'proposal_ordinal',
      'stage',
      'proposal_kind',
      'target_snapshot_id',
      'target_entry_id',
      'related_entry_id',
      'status',
      'summary',
      'created_at',
      'decided_at',
    ]),
    table('processing_proposal_fragment_input', [
      'workspace_id',
      'proposal_id',
      'input_ordinal',
      'fragment_id',
    ]),
    table('processing_tag_proposal', [
      'workspace_id',
      'proposal_id',
      'expected_entry_revision',
      'provider_model',
      'prompt_version',
      'type_keyword',
      'type_custom_name',
    ]),
    table('processing_tag_proposal_content_keyword', [
      'workspace_id',
      'proposal_id',
      'keyword_ordinal',
      'display_value',
      'normalized_value',
    ]),
    table('processing_tag_proposal_domain', [
      'workspace_id',
      'proposal_id',
      'domain_ordinal',
      'domain_keyword',
      'custom_name',
    ]),
    table('processing_association_proposal', [
      'workspace_id',
      'proposal_id',
      'expected_entry_low_revision',
      'expected_entry_high_revision',
      'expected_override_revision',
      'provider_model',
      'prompt_version',
      'relation_label',
      'graph_direction',
    ]),
    table('processing_split_proposal', [
      'workspace_id',
      'proposal_id',
      'provider_model',
      'prompt_version',
      'split_rule_version',
    ]),
    table('processing_split_proposal_entry', [
      'workspace_id',
      'proposal_id',
      'entry_ordinal',
      'title_path',
    ]),
    table('processing_split_proposal_entry_fragment', [
      'workspace_id',
      'proposal_id',
      'entry_ordinal',
      'fragment_ordinal',
      'fragment_id',
      'start_code_point',
      'end_code_point',
    ]),
    table('processing_entry_automation_run', [
      'workspace_id',
      'run_id',
      'request_sha256',
      'plan_sha256',
      'policy_revision',
      'profile_revision',
      'created_at',
    ]),
    table('processing_entry_automation_claim', [
      'workspace_id',
      'run_id',
      'claim_ordinal',
      'entry_id',
      'entry_revision',
      'entry_revision_id',
      'route',
      'reason',
      'status',
      'error_code',
      'created_at',
      'finished_at',
    ]),
    table('processing_entry_automation_work_item', [
      'workspace_id',
      'run_id',
      'claim_ordinal',
      'state',
      'current_version',
      'created_at',
      'updated_at',
      'resolved_at',
    ]),
    table('processing_entry_automation_action', [
      'workspace_id',
      'run_id',
      'claim_ordinal',
      'deterministic_tags_enabled',
      'rebuild_associations_enabled',
      'state',
      'origin_version',
      'result_entry_revision',
      'result_entry_revision_id',
      'added_tag_count',
      'association_projection_count',
      'current_version',
      'created_at',
      'updated_at',
      'completed_at',
    ]),
    table('processing_bulk_ingestion_batch', [
      'workspace_id',
      'batch_id',
      'idempotency_key',
      'request_sha256',
      'plan_sha256',
      'privacy_scope',
      'status',
      'active_run_id',
      'attempt',
      'snapshot_count',
      'planned_entry_count',
      'succeeded_snapshot_count',
      'succeeded_entry_count',
      'failed_snapshot_count',
      'current_version',
      'created_at',
      'started_at',
      'finished_at',
      'updated_at',
    ]),
    table('processing_bulk_ingestion_item', [
      'workspace_id',
      'batch_id',
      'item_ordinal',
      'snapshot_id',
      'canonical_content_sha256',
      'is_private',
      'planned_entry_count',
      'status',
      'attempt',
      'claimed_run_id',
      'result_entry_count',
      'error_code',
      'current_version',
      'started_at',
      'finished_at',
      'updated_at',
    ]),
    table('processing_bulk_ingestion_enrichment_item', [
      'workspace_id',
      'batch_id',
      'item_ordinal',
      'status',
      'attempt',
      'claimed_run_id',
      'rules_sha256',
      'result_entry_count',
      'revised_entry_count',
      'added_tag_count',
      'association_projection_count',
      'exception_entry_count',
      'error_code',
      'current_version',
      'started_at',
      'finished_at',
      'updated_at',
    ]),
    table('processing_bulk_ingestion_exception', [
      'workspace_id',
      'batch_id',
      'item_ordinal',
      'entry_id',
      'entry_revision',
      'entry_revision_id',
      'exception_code',
      'created_at',
    ]),
    table('processing_bulk_ingestion_adjudication', [
      'workspace_id',
      'batch_id',
      'item_ordinal',
      'entry_id',
      'status',
      'current_version',
      'decided_at',
      'updated_at',
    ]),
    table('processing_agent_task', [
      'workspace_id',
      'task_id',
      'actor_kind',
      'actor_id',
      'policy_version',
      'request_key',
      'request_text',
      'model',
      'state_text',
      'cancel_requested',
      'pause_requested',
      'current_version',
      'created_at',
      'updated_at',
    ]),
    table('processing_ingestion_policy', [
      'workspace_id',
      'current_version',
      'settings_text',
      'authorized_by_kind',
      'authorized_by_id',
      'updated_at',
    ]),
    table('processing_ingestion_item', [
      'workspace_id',
      'snapshot_id',
      'source_kind',
      'subscription_id',
      'policy_revision',
      'settings_text',
      'authorized_by_kind',
      'authorized_by_id',
      'status',
      'task_id',
      'error_code',
      'current_version',
      'created_at',
      'admitted_at',
      'updated_at',
    ]),
    table('processing_document_intake', [
      'workspace_id',
      'snapshot_id',
      'prepared_snapshot_id',
      'state_text',
      'current_version',
      'updated_at',
    ]),
    table('processing_report', [
      'workspace_id',
      'report_id',
      'state_text',
      'current_version',
      'created_at',
      'updated_at',
    ]),
    table('document_publication_version', [
      'workspace_id',
      'publication_id',
      'document_id',
      'snapshot_id',
      'content_text',
      'confirmed_at',
      'origin',
    ]),
    table('document_publication_pointer', [
      'workspace_id',
      'document_id',
      'publication_id',
    ]),
    table('document_organization_work', [
      'workspace_id',
      'publication_id',
      'status',
      'current_version',
      'error_code',
      'updated_at',
    ]),
    table('processing_tag_annotation_payload', [
      'workspace_id',
      'proposal_id',
      'value_text',
    ]),
    table('content_organization_record', [
      'workspace_id',
      'record_id',
      'kind',
      'value_text',
      'current_version',
      'updated_at',
    ]),
    table('research_pipeline_record', [
      'workspace_id',
      'record_id',
      'kind',
      'value_text',
      'current_version',
      'updated_at',
    ]),
  ]);

const VERSION_EIGHTEEN_PROCESSING_TABLES = Object.freeze(
  M1E_PROCESSING_TABLES.slice(0, -1),
);
const VERSION_SEVENTEEN_PROCESSING_TABLES = Object.freeze(
  VERSION_EIGHTEEN_PROCESSING_TABLES.slice(0, -1),
);
const VERSION_SIXTEEN_PROCESSING_TABLES = Object.freeze(
  VERSION_SEVENTEEN_PROCESSING_TABLES.slice(0, -1),
);
const VERSION_FIFTEEN_PROCESSING_TABLES = Object.freeze(
  VERSION_SIXTEEN_PROCESSING_TABLES.slice(0, -3),
);
const VERSION_FOURTEEN_PROCESSING_TABLES = Object.freeze(
  VERSION_FIFTEEN_PROCESSING_TABLES.map((descriptor) =>
    descriptor.name === 'processing_split_proposal_entry_fragment'
      ? table(
          descriptor.name,
          descriptor.columns.filter(
            (column) =>
              column !== 'start_code_point' && column !== 'end_code_point',
          ),
        )
      : descriptor,
  ),
);
const VERSION_THIRTEEN_PROCESSING_TABLES = Object.freeze(
  VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 23),
);
const VERSION_TWELVE_PROCESSING_TABLES = Object.freeze(
  VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 22),
);
const VERSION_ELEVEN_PROCESSING_TABLES = Object.freeze(
  VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 20),
);
const VERSION_TEN_PROCESSING_TABLES = Object.freeze(
  VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 19),
);

const VERSION_NINE_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 18));

const VERSION_EIGHT_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 16));

const VERSION_SEVEN_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 14));

const VERSION_SIX_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 13));

const VERSION_FIVE_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 12));

const VERSION_FOUR_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 10));

const VERSION_THREE_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 7));

const VERSION_TWO_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 6));

const LEGACY_PROCESSING_TABLES: readonly Readonly<M1eProcessingTableDescriptor>[] =
  Object.freeze(VERSION_FOURTEEN_PROCESSING_TABLES.slice(0, 3));

export const M1E_PROCESSING_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_BUNDLE_SECTION_VERSION,
    encode: normalizeM1eProcessingSnapshot,
    decode: normalizeM1eProcessingSnapshot,
  });

export const M1E_PROCESSING_VERSION_FOURTEEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_FOURTEEN_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionFourteenSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionFourteenSnapshot(payload));
    },
  });
export const M1E_PROCESSING_VERSION_EIGHTEEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: 18,
    encode: (value: unknown) =>
      normalizeSnapshot(
        value,
        'struinfo.m1e-processing.v18',
        VERSION_EIGHTEEN_PROCESSING_TABLES,
      ),
    decode: (value: JsonValue) =>
      upgradePreviousSnapshot(
        normalizeSnapshot(
          value,
          'struinfo.m1e-processing.v18',
          VERSION_EIGHTEEN_PROCESSING_TABLES,
        ),
      ),
  });
export const M1E_PROCESSING_VERSION_SEVENTEEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: 17,
    encode: (value: unknown) =>
      normalizeSnapshot(
        value,
        'struinfo.m1e-processing.v17',
        VERSION_SEVENTEEN_PROCESSING_TABLES,
      ),
    decode: (value: JsonValue) =>
      upgradePreviousSnapshot(
        normalizeSnapshot(
          value,
          'struinfo.m1e-processing.v17',
          VERSION_SEVENTEEN_PROCESSING_TABLES,
        ),
      ),
  });
export const M1E_PROCESSING_VERSION_SIXTEEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: 16,
    encode: (value: unknown) =>
      normalizeSnapshot(
        value,
        'struinfo.m1e-processing.v16',
        VERSION_SIXTEEN_PROCESSING_TABLES,
      ),
    decode: (value: JsonValue) =>
      upgradePreviousSnapshot(
        normalizeSnapshot(
          value,
          'struinfo.m1e-processing.v16',
          VERSION_SIXTEEN_PROCESSING_TABLES,
        ),
      ),
  });
export const M1E_PROCESSING_VERSION_FIFTEEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: 15,
    encode: (payload: unknown) =>
      normalizeSnapshot(
        payload,
        'struinfo.m1e-processing.v15',
        VERSION_FIFTEEN_PROCESSING_TABLES,
      ),
    decode: (payload: JsonValue) =>
      upgradePreviousSnapshot(
        normalizeSnapshot(
          payload,
          'struinfo.m1e-processing.v15',
          VERSION_FIFTEEN_PROCESSING_TABLES,
        ),
      ),
  });
export const M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionThirteenSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionThirteenSnapshot(payload));
    },
  });
export const M1E_PROCESSING_VERSION_TWELVE_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_TWELVE_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionTwelveSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionTwelveSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_ELEVEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_ELEVEN_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionElevenSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionElevenSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_TEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_TEN_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionTenSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionTenSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_NINE_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_NINE_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionNineSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionNineSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_EIGHT_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionEightSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionEightSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_SEVEN_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionSevenSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionSevenSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_SIX_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_SIX_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionSixSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionSixSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_FIVE_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_FIVE_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionFiveSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionFiveSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_FOUR_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_FOUR_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionFourSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionFourSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_THREE_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_THREE_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionThreeSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionThreeSnapshot(payload));
    },
  });

export const M1E_PROCESSING_VERSION_TWO_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_VERSION_TWO_BUNDLE_SECTION_VERSION,
    encode: normalizeVersionTwoSnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeVersionTwoSnapshot(payload));
    },
  });
export const M1E_PROCESSING_LEGACY_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: M1E_PROCESSING_BUNDLE_SECTION_TYPE,
    version: M1E_PROCESSING_LEGACY_BUNDLE_SECTION_VERSION,
    encode: normalizeLegacySnapshot,
    decode(payload: JsonValue): unknown {
      return upgradePreviousSnapshot(normalizeLegacySnapshot(payload));
    },
  });

export function normalizeM1eProcessingSnapshot(
  value: unknown,
): M1eProcessingSnapshot {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_BUNDLE_SCHEMA,
    M1E_PROCESSING_TABLES,
  ) as M1eProcessingSnapshot;
}

function normalizeVersionFourteenSnapshot(payload: JsonValue) {
  return normalizeSnapshot(
    payload,
    M1E_PROCESSING_VERSION_FOURTEEN_BUNDLE_SCHEMA,
    VERSION_FOURTEEN_PROCESSING_TABLES,
  );
}
function normalizeVersionThirteenSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_SCHEMA,
    VERSION_THIRTEEN_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}
function normalizeVersionTwelveSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_TWELVE_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_TWELVE_BUNDLE_SCHEMA,
    VERSION_TWELVE_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_TWELVE_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionElevenSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_ELEVEN_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_ELEVEN_BUNDLE_SCHEMA,
    VERSION_ELEVEN_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_ELEVEN_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionTenSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_TEN_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_TEN_BUNDLE_SCHEMA,
    VERSION_TEN_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_TEN_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionNineSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_NINE_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_NINE_BUNDLE_SCHEMA,
    VERSION_NINE_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_NINE_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionEightSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SCHEMA,
    VERSION_EIGHT_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_EIGHT_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionSevenSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SCHEMA,
    VERSION_SEVEN_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_SEVEN_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionSixSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_SIX_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_SIX_BUNDLE_SCHEMA,
    VERSION_SIX_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_SIX_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionFiveSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_FIVE_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_FIVE_BUNDLE_SCHEMA,
    VERSION_FIVE_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_FIVE_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionFourSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_FOUR_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_FOUR_BUNDLE_SCHEMA,
    VERSION_FOUR_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_FOUR_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionThreeSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_THREE_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_THREE_BUNDLE_SCHEMA,
    VERSION_THREE_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_THREE_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeVersionTwoSnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_VERSION_TWO_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_VERSION_TWO_BUNDLE_SCHEMA,
    VERSION_TWO_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_VERSION_TWO_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeLegacySnapshot(value: unknown): Readonly<{
  schemaVersion: typeof M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  return normalizeSnapshot(
    value,
    M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA,
    LEGACY_PROCESSING_TABLES,
  ) as Readonly<{
    schemaVersion: typeof M1E_PROCESSING_LEGACY_BUNDLE_SCHEMA;
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>;
}

function normalizeSnapshot(
  value: unknown,
  schemaVersion: string,
  descriptors: readonly Readonly<M1eProcessingTableDescriptor>[],
): Readonly<{
  schemaVersion: string;
  tables: readonly Readonly<M1eProcessingTableSnapshot>[];
}> {
  const normalized = normalizeJsonValue(value, {
    maximumValues: PROCESSING_VALUE_LIMIT,
  });
  const record = requireClosedObject(normalized, ['schemaVersion', 'tables']);
  if (
    record.schemaVersion !== schemaVersion ||
    !isJsonArray(record.tables) ||
    record.tables.length !== descriptors.length
  ) {
    fail();
  }
  const tableValues = record.tables;
  const tables = descriptors.map((descriptor, index) => {
    const candidate = requireClosedObject(tableValues[index], ['name', 'rows']);
    if (candidate.name !== descriptor.name || !isJsonArray(candidate.rows)) {
      fail();
    }
    const rows = candidate.rows.map((row) => normalizeRow(row, descriptor));
    rows.sort(compareRows);
    return Object.freeze({name: descriptor.name, rows: Object.freeze(rows)});
  });
  return Object.freeze({schemaVersion, tables: Object.freeze(tables)});
}

function upgradePreviousSnapshot(
  previous: Readonly<{
    tables: readonly Readonly<M1eProcessingTableSnapshot>[];
  }>,
): M1eProcessingSnapshot {
  return normalizeM1eProcessingSnapshot({
    schemaVersion: M1E_PROCESSING_BUNDLE_SCHEMA,
    tables: [
      ...previous.tables.map((table) =>
        table.name === 'processing_split_proposal_entry_fragment'
          ? {
              ...table,
              rows: table.rows.map((row) => ({
                ...row,
                start_code_point: row.start_code_point ?? null,
                end_code_point: row.end_code_point ?? null,
              })),
            }
          : table,
      ),
      ...M1E_PROCESSING_TABLES.slice(previous.tables.length).map(
        (descriptor) => ({name: descriptor.name, rows: []}),
      ),
    ],
  });
}

export function assertM1eProcessingWorkspace(
  snapshot: Readonly<M1eProcessingSnapshot>,
  workspaceId: string,
): void {
  if (!CANONICAL_UUID.test(workspaceId)) fail();
  for (const tableSnapshot of snapshot.tables) {
    for (const row of tableSnapshot.rows) {
      if (row.workspace_id !== workspaceId) fail();
    }
  }
}

export function createEmptyM1eProcessingSnapshot(): M1eProcessingSnapshot {
  return normalizeM1eProcessingSnapshot({
    schemaVersion: M1E_PROCESSING_BUNDLE_SCHEMA,
    tables: M1E_PROCESSING_TABLES.map((descriptor) => ({
      name: descriptor.name,
      rows: [],
    })),
  });
}

export function m1eProcessingTableCounts(
  snapshot: Readonly<M1eProcessingSnapshot>,
): Readonly<Record<string, number>> {
  const counts = Object.create(null) as Record<string, number>;
  for (const tableSnapshot of snapshot.tables) {
    counts[tableSnapshot.name] = tableSnapshot.rows.length;
  }
  return Object.freeze(counts);
}

function table(
  name: string,
  columns: readonly string[],
): Readonly<M1eProcessingTableDescriptor> {
  return Object.freeze({name, columns: Object.freeze(columns)});
}

function normalizeRow(
  value: JsonValue | undefined,
  descriptor: Readonly<M1eProcessingTableDescriptor>,
): M1eProcessingRow {
  const record = requireClosedObject(value, descriptor.columns);
  if (descriptor.name === 'processing_tag_annotation_payload') {
    if (typeof record.value_text !== 'string') fail();
    try {
      structuredAnnotationsSchema.parse(JSON.parse(record.value_text));
    } catch {
      fail();
    }
  }
  if (
    typeof record.workspace_id !== 'string' ||
    !CANONICAL_UUID.test(record.workspace_id)
  ) {
    fail();
  }
  const row = Object.create(null) as Record<string, JsonPrimitive>;
  for (const column of descriptor.columns) {
    const field = record[column];
    if (
      field === undefined ||
      (typeof field === 'object' && field !== null) ||
      (typeof field === 'number' &&
        Number.isInteger(field) &&
        !Number.isSafeInteger(field))
    ) {
      fail();
    }
    row[column] = field;
  }
  if (descriptor.name.startsWith('document_')) {
    if (
      typeof row.publication_id !== 'string' ||
      !CANONICAL_UUID.test(row.publication_id)
    )
      fail();
    if (
      descriptor.name !== 'document_organization_work' &&
      (typeof row.document_id !== 'string' ||
        !CANONICAL_UUID.test(row.document_id))
    )
      fail();
    if (descriptor.name === 'document_publication_version') {
      if (
        typeof row.content_text !== 'string' ||
        Buffer.byteLength(row.content_text) > 33554432 ||
        typeof row.confirmed_at !== 'string' ||
        !Number.isFinite(Date.parse(row.confirmed_at)) ||
        !['manual', 'external_agent', 'internal_ai'].includes(
          String(row.origin),
        )
      )
        fail();
      const content = publicationContentSchema.parse(
        JSON.parse(row.content_text),
      );
      if (
        content.documentId !== row.document_id ||
        content.snapshotId !== row.snapshot_id ||
        content.entries.some(
          (e) =>
            e.workspaceId !== row.workspace_id ||
            e.snapshotId !== row.snapshot_id ||
            e.resourceId !== content.source.resourceId,
        ) ||
        new Set(content.entries.map((e) => e.entryId)).size !==
          content.entries.length
      )
        fail();
    }
    if (descriptor.name === 'document_organization_work') {
      organizationStatusSchema.parse(row.status);
      if (
        typeof row.current_version !== 'number' ||
        !Number.isInteger(row.current_version) ||
        row.current_version < 1 ||
        typeof row.updated_at !== 'string' ||
        !Number.isFinite(Date.parse(row.updated_at)) ||
        (row.error_code !== null &&
          (typeof row.error_code !== 'string' ||
            !/^[a-z0-9_]{1,160}$/u.test(row.error_code)))
      )
        fail();
    }
  }
  if (
    descriptor.name === 'content_organization_record' ||
    descriptor.name === 'research_pipeline_record'
  ) {
    try {
      if (
        typeof row.value_text !== 'string' ||
        Buffer.byteLength(row.value_text) > ROW_BYTE_LIMIT ||
        typeof row.record_id !== 'string' ||
        !CANONICAL_UUID.test(row.record_id) ||
        typeof row.current_version !== 'number' ||
        !Number.isInteger(row.current_version) ||
        row.current_version < 1 ||
        typeof row.updated_at !== 'string' ||
        !Number.isFinite(Date.parse(row.updated_at))
      )
        fail();
      const value = (
        descriptor.name === 'research_pipeline_record'
          ? researchRecordValueSchema
          : topicRecordValueSchema
      ).parse(JSON.parse(row.value_text));
      if (value.kind !== row.kind) fail();
    } catch {
      fail();
    }
  }
  if (descriptor.name === 'processing_report') {
    try {
      if (
        typeof row.state_text !== 'string' ||
        Buffer.byteLength(row.state_text) > ROW_BYTE_LIMIT ||
        typeof row.report_id !== 'string' ||
        !CANONICAL_UUID.test(row.report_id) ||
        typeof row.current_version !== 'number' ||
        !Number.isInteger(row.current_version) ||
        row.current_version < 1 ||
        typeof row.created_at !== 'string' ||
        !Number.isFinite(Date.parse(row.created_at)) ||
        typeof row.updated_at !== 'string' ||
        !Number.isFinite(Date.parse(row.updated_at))
      )
        fail();
      validateReportState(reportStateSchema.parse(JSON.parse(row.state_text)));
    } catch {
      fail();
    }
  }
  if (descriptor.name === 'processing_document_intake') {
    try {
      if (
        typeof row.state_text !== 'string' ||
        Buffer.byteLength(row.state_text) > 16384 ||
        typeof row.snapshot_id !== 'string' ||
        !CANONICAL_UUID.test(row.snapshot_id) ||
        typeof row.current_version !== 'number' ||
        !Number.isInteger(row.current_version) ||
        row.current_version < 1 ||
        typeof row.updated_at !== 'string' ||
        !Number.isFinite(Date.parse(row.updated_at))
      )
        fail();
      const state = intakeRecordValueSchema.parse(JSON.parse(row.state_text));
      if (
        (state.preparedSnapshotId ?? null) !== row.prepared_snapshot_id ||
        state.preparedSnapshotId === row.snapshot_id ||
        (state.bodySource === 'web_article' && !state.preparedSnapshotId) ||
        (state.previousPreparedSnapshotIds ?? []).some(
          (id) => id === row.snapshot_id || id === state.preparedSnapshotId,
        ) ||
        new Set(state.previousPreparedSnapshotIds ?? []).size !==
          (state.previousPreparedSnapshotIds?.length ?? 0)
      )
        fail();
    } catch {
      fail();
    }
  }
  return Object.freeze(row);
}

function requireClosedObject(
  value: JsonValue | undefined,
  expectedKeys: readonly string[],
): JsonObject {
  if (
    value === undefined ||
    value === null ||
    typeof value !== 'object' ||
    isJsonArray(value)
  ) {
    fail();
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail();
  }
  return value;
}

function isJsonArray(
  value: JsonValue | undefined,
): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function compareRows(left: M1eProcessingRow, right: M1eProcessingRow): number {
  return Buffer.compare(
    Buffer.from(encodeCanonicalJson(left, ROW_BYTE_LIMIT)),
    Buffer.from(encodeCanonicalJson(right, ROW_BYTE_LIMIT)),
  );
}

function fail(): never {
  throw new Error('The M1E Processing Bundle section is invalid.');
}
