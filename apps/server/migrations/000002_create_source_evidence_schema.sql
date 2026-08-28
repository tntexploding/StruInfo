CREATE TABLE struinfo.workspace (
  workspace_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_pk PRIMARY KEY (workspace_id)
);

CREATE TABLE struinfo.evidence_blob (
  workspace_id uuid NOT NULL,
  blob_id uuid NOT NULL,
  digest_algorithm text NOT NULL,
  digest text NOT NULL,
  byte_length bigint NOT NULL,
  media_type text,
  read_revoked_at timestamp with time zone,
  delete_after timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT evidence_blob_pk PRIMARY KEY (workspace_id, blob_id),
  CONSTRAINT evidence_blob_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT evidence_blob_digest_algorithm_ck
    CHECK (digest_algorithm = 'sha256'),
  CONSTRAINT evidence_blob_digest_ck
    CHECK (digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT evidence_blob_byte_length_ck CHECK (byte_length >= 0),
  CONSTRAINT evidence_blob_media_type_ck
    CHECK (media_type IS NULL OR btrim(media_type) <> ''),
  CONSTRAINT evidence_blob_digest_uq
    UNIQUE (workspace_id, digest_algorithm, digest),
  CONSTRAINT evidence_blob_exact_identity_uq
    UNIQUE (workspace_id, blob_id, digest, byte_length)
);

CREATE TABLE struinfo.resource (
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  resource_kind text NOT NULL,
  source_key text NOT NULL,
  canonical_uri text,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT resource_pk PRIMARY KEY (workspace_id, resource_id),
  CONSTRAINT resource_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT resource_kind_ck
    CHECK (resource_kind IN ('git_file', 'manual_text', 'uploaded_file')),
  CONSTRAINT resource_source_key_ck CHECK (btrim(source_key) <> ''),
  CONSTRAINT resource_canonical_uri_ck
    CHECK (canonical_uri IS NULL OR btrim(canonical_uri) <> ''),
  CONSTRAINT resource_source_identity_uq
    UNIQUE (workspace_id, resource_kind, source_key)
);

CREATE TABLE struinfo.git_resource (
  workspace_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  canonical_repository_uri text NOT NULL,
  repository_relative_path text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT git_resource_pk PRIMARY KEY (workspace_id, resource_id),
  CONSTRAINT git_resource_resource_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES struinfo.resource (workspace_id, resource_id),
  CONSTRAINT git_resource_repository_uri_ck
    CHECK (btrim(canonical_repository_uri) <> ''),
  CONSTRAINT git_resource_relative_path_ck
    CHECK (
      btrim(repository_relative_path) <> ''
      AND left(repository_relative_path, 1) <> '/'
      AND position(E'\\' IN repository_relative_path) = 0
      AND repository_relative_path !~ '(^|/)\.\.?(/|$)'
      AND repository_relative_path !~ '^[A-Za-z]:'
    ),
  CONSTRAINT git_resource_location_uq
    UNIQUE (
      workspace_id,
      canonical_repository_uri,
      repository_relative_path
    )
);

CREATE TABLE struinfo.snapshot (
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  raw_sha256 text NOT NULL,
  raw_blob_id uuid,
  raw_blob_byte_length bigint,
  canonical_content_sha256 text NOT NULL,
  canonicalization_version text NOT NULL,
  media_type text,
  published_at timestamp with time zone,
  published_timezone text,
  published_precision text,
  published_source_text text,
  published_inferred boolean NOT NULL DEFAULT false,
  captured_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT snapshot_pk PRIMARY KEY (workspace_id, snapshot_id),
  CONSTRAINT snapshot_resource_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES struinfo.resource (workspace_id, resource_id),
  CONSTRAINT snapshot_raw_blob_fk
    FOREIGN KEY (
      workspace_id,
      raw_blob_id,
      raw_sha256,
      raw_blob_byte_length
    )
    REFERENCES struinfo.evidence_blob (
      workspace_id,
      blob_id,
      digest,
      byte_length
    ),
  CONSTRAINT snapshot_raw_sha256_ck
    CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT snapshot_raw_blob_presence_ck
    CHECK ((raw_blob_id IS NULL) = (raw_blob_byte_length IS NULL)),
  CONSTRAINT snapshot_raw_blob_byte_length_ck
    CHECK (raw_blob_byte_length IS NULL OR raw_blob_byte_length >= 0),
  CONSTRAINT snapshot_canonical_sha256_ck
    CHECK (canonical_content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT snapshot_canonicalization_version_ck
    CHECK (btrim(canonicalization_version) <> ''),
  CONSTRAINT snapshot_media_type_ck
    CHECK (media_type IS NULL OR btrim(media_type) <> ''),
  CONSTRAINT snapshot_published_timezone_ck
    CHECK (
      published_timezone IS NULL OR btrim(published_timezone) <> ''
    ),
  CONSTRAINT snapshot_published_precision_ck
    CHECK (
      published_precision IS NULL
      OR published_precision IN ('year', 'month', 'day', 'hour', 'minute', 'second')
    ),
  CONSTRAINT snapshot_publication_shape_ck
    CHECK (
      published_at IS NOT NULL
      OR (published_timezone IS NULL AND published_precision IS NULL)
    ),
  CONSTRAINT snapshot_resource_raw_uq
    UNIQUE (workspace_id, resource_id, raw_sha256),
  CONSTRAINT snapshot_resource_identity_uq
    UNIQUE (workspace_id, resource_id, snapshot_id)
);

CREATE TABLE struinfo.git_snapshot_observation (
  workspace_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  repository_ref text NOT NULL,
  commit_hash_algorithm text NOT NULL,
  commit_hash text NOT NULL,
  git_blob_hash_algorithm text,
  git_blob_hash text,
  observed_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT git_snapshot_observation_pk
    PRIMARY KEY (workspace_id, observation_id),
  CONSTRAINT git_snapshot_observation_snapshot_fk
    FOREIGN KEY (workspace_id, resource_id, snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id),
  CONSTRAINT git_snapshot_observation_repository_ref_ck
    CHECK (btrim(repository_ref) <> ''),
  CONSTRAINT git_snapshot_observation_commit_hash_ck
    CHECK (
      (commit_hash_algorithm = 'sha1' AND commit_hash ~ '^[0-9a-f]{40}$')
      OR (
        commit_hash_algorithm = 'sha256'
        AND commit_hash ~ '^[0-9a-f]{64}$'
      )
    ),
  CONSTRAINT git_snapshot_observation_blob_presence_ck
    CHECK (
      (git_blob_hash_algorithm IS NULL) = (git_blob_hash IS NULL)
    ),
  CONSTRAINT git_snapshot_observation_blob_hash_ck
    CHECK (
      git_blob_hash_algorithm IS NULL
      OR (
        git_blob_hash_algorithm = 'sha1'
        AND git_blob_hash ~ '^[0-9a-f]{40}$'
      )
      OR (
        git_blob_hash_algorithm = 'sha256'
        AND git_blob_hash ~ '^[0-9a-f]{64}$'
      )
    ),
  CONSTRAINT git_snapshot_observation_identity_uq
    UNIQUE (
      workspace_id,
      resource_id,
      repository_ref,
      commit_hash_algorithm,
      commit_hash
    )
);

CREATE TABLE struinfo.document_structure (
  workspace_id uuid NOT NULL,
  structure_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  text_normalization_version text NOT NULL,
  text_blob_id uuid NOT NULL,
  text_blob_sha256 text NOT NULL,
  text_blob_byte_length bigint NOT NULL,
  structure_sha256 text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_structure_pk
    PRIMARY KEY (workspace_id, structure_id),
  CONSTRAINT document_structure_snapshot_fk
    FOREIGN KEY (workspace_id, resource_id, snapshot_id)
    REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id),
  CONSTRAINT document_structure_text_blob_fk
    FOREIGN KEY (
      workspace_id,
      text_blob_id,
      text_blob_sha256,
      text_blob_byte_length
    )
    REFERENCES struinfo.evidence_blob (
      workspace_id,
      blob_id,
      digest,
      byte_length
    ),
  CONSTRAINT document_structure_parser_name_ck
    CHECK (btrim(parser_name) <> ''),
  CONSTRAINT document_structure_parser_version_ck
    CHECK (btrim(parser_version) <> ''),
  CONSTRAINT document_structure_normalization_ck
    CHECK (btrim(text_normalization_version) <> ''),
  CONSTRAINT document_structure_text_sha256_ck
    CHECK (text_blob_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_structure_text_length_ck
    CHECK (text_blob_byte_length >= 0),
  CONSTRAINT document_structure_sha256_ck
    CHECK (structure_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_structure_idempotency_uq
    UNIQUE (
      workspace_id,
      snapshot_id,
      parser_name,
      parser_version,
      text_normalization_version,
      structure_sha256
    ),
  CONSTRAINT document_structure_context_uq
    UNIQUE (workspace_id, resource_id, snapshot_id, structure_id),
  CONSTRAINT document_structure_exact_text_uq
    UNIQUE (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      text_blob_id,
      text_blob_sha256,
      text_blob_byte_length
    )
);

CREATE TABLE struinfo.document_node (
  workspace_id uuid NOT NULL,
  structure_id uuid NOT NULL,
  node_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  parent_node_id uuid,
  node_kind text NOT NULL,
  sibling_ordinal integer NOT NULL,
  code_point_start bigint NOT NULL,
  code_point_end bigint NOT NULL,
  line_start integer,
  line_end integer,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_node_pk
    PRIMARY KEY (workspace_id, structure_id, node_id),
  CONSTRAINT document_node_structure_fk
    FOREIGN KEY (workspace_id, resource_id, snapshot_id, structure_id)
    REFERENCES struinfo.document_structure (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id
    ),
  CONSTRAINT document_node_parent_fk
    FOREIGN KEY (workspace_id, structure_id, parent_node_id)
    REFERENCES struinfo.document_node (workspace_id, structure_id, node_id),
  CONSTRAINT document_node_parent_not_self_ck
    CHECK (parent_node_id IS NULL OR parent_node_id <> node_id),
  CONSTRAINT document_node_kind_ck
    CHECK (
      node_kind IN (
        'document',
        'section',
        'heading',
        'paragraph',
        'blockquote',
        'list',
        'list_item',
        'code_block',
        'table',
        'table_row',
        'table_cell',
        'image',
        'thematic_break'
      )
    ),
  CONSTRAINT document_node_ordinal_ck CHECK (sibling_ordinal >= 0),
  CONSTRAINT document_node_root_ordinal_ck
    CHECK (parent_node_id IS NOT NULL OR sibling_ordinal = 0),
  CONSTRAINT document_node_code_point_range_ck
    CHECK (code_point_start >= 0 AND code_point_end > code_point_start),
  CONSTRAINT document_node_line_range_ck
    CHECK (
      (line_start IS NULL AND line_end IS NULL)
      OR (
        line_start IS NOT NULL
        AND line_end IS NOT NULL
        AND line_start >= 1
        AND line_end >= line_start
      )
    ),
  CONSTRAINT document_node_sibling_ordinal_uq
    UNIQUE NULLS NOT DISTINCT (
      workspace_id,
      structure_id,
      parent_node_id,
      sibling_ordinal
    ),
  CONSTRAINT document_node_context_uq
    UNIQUE (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id
    )
);

CREATE TABLE struinfo.fragment (
  workspace_id uuid NOT NULL,
  fragment_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  structure_id uuid NOT NULL,
  node_id uuid NOT NULL,
  text_blob_id uuid NOT NULL,
  text_blob_sha256 text NOT NULL,
  text_blob_byte_length bigint NOT NULL,
  locator_kind text NOT NULL,
  locator_version integer NOT NULL,
  code_point_start bigint NOT NULL,
  code_point_end bigint NOT NULL,
  line_start integer,
  line_end integer,
  selected_text_sha256 text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fragment_pk PRIMARY KEY (workspace_id, fragment_id),
  CONSTRAINT fragment_structure_text_fk
    FOREIGN KEY (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      text_blob_id,
      text_blob_sha256,
      text_blob_byte_length
    )
    REFERENCES struinfo.document_structure (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      text_blob_id,
      text_blob_sha256,
      text_blob_byte_length
    ),
  CONSTRAINT fragment_node_fk
    FOREIGN KEY (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id
    )
    REFERENCES struinfo.document_node (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id
    ),
  CONSTRAINT fragment_text_sha256_ck
    CHECK (text_blob_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fragment_text_length_ck CHECK (text_blob_byte_length >= 0),
  CONSTRAINT fragment_locator_kind_ck
    CHECK (locator_kind = 'unicode_code_point_range'),
  CONSTRAINT fragment_locator_version_ck CHECK (locator_version = 1),
  CONSTRAINT fragment_code_point_range_ck
    CHECK (code_point_start >= 0 AND code_point_end > code_point_start),
  CONSTRAINT fragment_line_range_ck
    CHECK (
      (line_start IS NULL AND line_end IS NULL)
      OR (
        line_start IS NOT NULL
        AND line_end IS NOT NULL
        AND line_start >= 1
        AND line_end >= line_start
      )
    ),
  CONSTRAINT fragment_selected_text_sha256_ck
    CHECK (selected_text_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fragment_locator_identity_uq
    UNIQUE (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id,
      locator_kind,
      locator_version,
      code_point_start,
      code_point_end
    )
);

CREATE TABLE struinfo.media_asset (
  workspace_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  storage_mode text NOT NULL,
  blob_id uuid,
  blob_sha256 text,
  blob_byte_length bigint,
  original_uri text,
  media_type text,
  pixel_width integer,
  pixel_height integer,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT media_asset_pk PRIMARY KEY (workspace_id, media_asset_id),
  CONSTRAINT media_asset_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES struinfo.workspace (workspace_id),
  CONSTRAINT media_asset_blob_fk
    FOREIGN KEY (workspace_id, blob_id, blob_sha256, blob_byte_length)
    REFERENCES struinfo.evidence_blob (
      workspace_id,
      blob_id,
      digest,
      byte_length
    ),
  CONSTRAINT media_asset_storage_mode_ck
    CHECK (storage_mode IN ('stored_blob', 'external_reference')),
  CONSTRAINT media_asset_storage_shape_ck
    CHECK (
      (
        storage_mode = 'stored_blob'
        AND blob_id IS NOT NULL
        AND blob_sha256 IS NOT NULL
        AND blob_byte_length IS NOT NULL
      )
      OR (
        storage_mode = 'external_reference'
        AND blob_id IS NULL
        AND blob_sha256 IS NULL
        AND blob_byte_length IS NULL
        AND original_uri IS NOT NULL
        AND btrim(original_uri) <> ''
      )
    ),
  CONSTRAINT media_asset_blob_sha256_ck
    CHECK (blob_sha256 IS NULL OR blob_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_asset_blob_length_ck
    CHECK (blob_byte_length IS NULL OR blob_byte_length >= 0),
  CONSTRAINT media_asset_original_uri_ck
    CHECK (original_uri IS NULL OR btrim(original_uri) <> ''),
  CONSTRAINT media_asset_media_type_ck
    CHECK (media_type IS NULL OR btrim(media_type) <> ''),
  CONSTRAINT media_asset_pixel_dimensions_ck
    CHECK (
      (pixel_width IS NULL AND pixel_height IS NULL)
      OR (
        pixel_width IS NOT NULL
        AND pixel_height IS NOT NULL
        AND pixel_width > 0
        AND pixel_height > 0
      )
    ),
  CONSTRAINT media_asset_stored_blob_uq
    UNIQUE (workspace_id, storage_mode, blob_sha256)
);

CREATE TABLE struinfo.media_usage (
  workspace_id uuid NOT NULL,
  media_usage_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  structure_id uuid NOT NULL,
  node_id uuid NOT NULL,
  ordinal integer NOT NULL,
  purpose text NOT NULL,
  purpose_origin text NOT NULL,
  confidence double precision,
  superseded_usage_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT media_usage_pk PRIMARY KEY (workspace_id, media_usage_id),
  CONSTRAINT media_usage_asset_fk
    FOREIGN KEY (workspace_id, media_asset_id)
    REFERENCES struinfo.media_asset (workspace_id, media_asset_id),
  CONSTRAINT media_usage_node_fk
    FOREIGN KEY (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id
    )
    REFERENCES struinfo.document_node (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id
    ),
  CONSTRAINT media_usage_superseded_position_fk
    FOREIGN KEY (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id,
      ordinal,
      superseded_usage_id
    )
    REFERENCES struinfo.media_usage (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id,
      ordinal,
      media_usage_id
    ),
  CONSTRAINT media_usage_ordinal_ck CHECK (ordinal >= 0),
  CONSTRAINT media_usage_purpose_ck
    CHECK (
      purpose IN (
        'cover',
        'concept_explanation',
        'data_visualization',
        'screenshot',
        'example',
        'decorative',
        'unknown'
      )
    ),
  CONSTRAINT media_usage_purpose_origin_ck
    CHECK (
      purpose_origin IN (
        'source_statement',
        'deterministic_parser',
        'ai_inference',
        'user_confirmation',
        'unknown'
      )
    ),
  CONSTRAINT media_usage_confidence_ck
    CHECK (
      confidence IS NULL
      OR (
        purpose_origin = 'ai_inference'
        AND confidence >= 0
        AND confidence <= 1
      )
    ),
  CONSTRAINT media_usage_superseded_not_self_ck
    CHECK (
      superseded_usage_id IS NULL
      OR superseded_usage_id <> media_usage_id
    ),
  CONSTRAINT media_usage_exact_position_uq
    UNIQUE (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id,
      ordinal,
      media_usage_id
    ),
  CONSTRAINT media_usage_position_revision_uq
    UNIQUE NULLS NOT DISTINCT (
      workspace_id,
      resource_id,
      snapshot_id,
      structure_id,
      node_id,
      ordinal,
      superseded_usage_id
    )
);
