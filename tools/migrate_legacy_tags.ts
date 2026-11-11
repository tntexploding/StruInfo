import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {createNodePostgresPool} from '../apps/server/src/platform/database/postgresql/postgres_pool.js';
import {decodePostgresConnectionUrl} from '../apps/server/src/platform/database/postgresql/postgres_connection_config.js';
import {PostgresInformationEntryRepository} from '../apps/server/src/platform/database/postgresql/postgres_information_entry_repository.js';
import {acquireWorkspaceWriteLock} from '../apps/server/src/platform/database/postgresql/workspace_write_lock.js';
import {LocalReviewPreferencesStore} from '../apps/server/src/platform/storage/local_review_preferences_store.js';
import {publicationContentSchema} from '../apps/server/src/application/document_publication_contract.js';
import {
  canonicalAnnotationTerm,
  type AnnotationVocabulary,
} from '../apps/server/src/modules/entries/structured_annotations.js';
import {
  legacyTagVocabulary,
  migrateLegacyEntryTags,
} from '../apps/server/src/modules/entries/legacy_tag_migration.js';
import {prepareInformationEntrySearchProjection} from '../apps/server/src/modules/entries/information_entry_search_index.js';

// Offline conversion. Stop writers and keep a verified database + preferences backup first.
const {values} = parseArgs({
  options: {
    'database-url-file': {type: 'string'},
    preferences: {type: 'string'},
    apply: {type: 'boolean', default: false},
  },
});
assert(
  values['database-url-file'] && values.preferences,
  'Provide --database-url-file and --preferences.',
);
const preferenceBytes = await readFile(values.preferences);
const parsed: unknown = JSON.parse(preferenceBytes.toString('utf8'));
assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
const raw = parsed as Record<string, unknown>;
const workspaceId = raw.workspaceId;
assert(typeof workspaceId === 'string');
const store = new LocalReviewPreferencesStore(dirname(values.preferences));
const preferences = await store.load(workspaceId);
const config = decodePostgresConnectionUrl(
  (await readFile(values['database-url-file'], 'utf8')).trim(),
  'migrator',
);
const pool = createNodePostgresPool(config);
try {
  const entries = await new PostgresInformationEntryRepository(
    pool,
  ).loadCurrentEntries(workspaceId, true);
  const inventory = (
    await pool.query(
      `SELECT
    (SELECT count(*) FROM struinfo.information_entry WHERE workspace_id=$1) AS entries,
    (SELECT count(*) FROM struinfo.information_document_tag_value WHERE workspace_id=$1 AND origin='manual') AS document_manual_tags`,
      [workspaceId],
    )
  ).rows[0];
  assert(
    Number(inventory?.entries) === entries.length,
    'Inactive structures need a separate migration review.',
  );
  assert(
    Number(inventory?.document_manual_tags) === 0,
    'Document-level manual tags need explicit entry mapping.',
  );
  const publications = (
    await pool.query(
      'SELECT publication_id,content_text FROM struinfo.document_publication_version WHERE workspace_id=$1',
      [workspaceId],
    )
  ).rows;
  const hasLegacy =
    entries.some(
      (e) =>
        e.value.contentKeywords.length ||
        e.value.domains.length ||
        e.value.typeKeyword,
    ) ||
    publications.some((p) =>
      publicationContentSchema
        .parse(JSON.parse(String(p.content_text)))
        .entries.some(
          (e) =>
            e.value.contentKeywords.length ||
            e.value.domains.length ||
            e.value.typeKeyword,
        ),
    );
  const oldVocabulary = preferences.annotationVocabulary;
  assert(oldVocabulary);
  const vocabulary: AnnotationVocabulary = structuredClone(
    hasLegacy ||
      preferences.quickTags.length ||
      preferences.vocabulary?.aliases.length
      ? legacyTagVocabulary(oldVocabulary)
      : oldVocabulary,
  );
  if (
    JSON.stringify(vocabulary.dimensions) !==
    JSON.stringify(oldVocabulary.dimensions)
  )
    vocabulary.revision++;
  const dimension = vocabulary.dimensions.find(
    (d) => d.description === '迁移的旧关键词，尚未补充类别与原文依据。',
  );
  const terms = [...vocabulary.terms];
  for (const label of [
    ...preferences.quickTags,
    ...(preferences.vocabulary?.aliases.map((a) => a.canonical) ?? []),
  ]) {
    assert(dimension);
    const term = canonicalAnnotationTerm(
      {id: dimension.id, dimensionId: dimension.id, label, meaning: ''},
      {...vocabulary, terms},
    );
    if (!terms.some((t) => t.id === term.id)) terms.push(term);
  }
  vocabulary.terms = terms;
  for (const alias of preferences.vocabulary?.aliases ?? []) {
    const term = terms.find(
      (t) => t.dimensionId === dimension?.id && t.label === alias.canonical,
    );
    assert(term);
    if (
      !vocabulary.aliases.some(
        (a) => a.termId === term.id && a.text === alias.source,
      )
    )
      vocabulary.aliases.push({
        termId: term.id,
        text: alias.source,
        status: 'confirmed',
      });
  }
  const changed = entries.flatMap((e) => {
    const next = migrateLegacyEntryTags(e, vocabulary);
    return next === e ? [] : [{before: e, after: next}];
  });
  const published = publications.flatMap((p) => {
    const content = publicationContentSchema.parse(
      JSON.parse(String(p.content_text)),
    );
    const next = {
      ...content,
      entries: content.entries.map((e) =>
        migrateLegacyEntryTags(e, vocabulary),
      ),
    };
    return JSON.stringify(next) === JSON.stringify(content)
      ? []
      : [
          {
            id: p.publication_id,
            before: String(p.content_text),
            after: JSON.stringify(next),
          },
        ];
  });
  const nextPreferences: Record<string, unknown> = {
    ...raw,
    annotationVocabulary: vocabulary,
  };
  delete nextPreferences.quickTags;
  delete nextPreferences.automaticKeywords;
  delete nextPreferences.vocabulary;
  const summary = {
    mode: values.apply ? 'apply' : 'preview',
    workspaceId,
    entries: changed.length,
    publications: published.length,
    keywords: changed.reduce(
      (n, e) => n + e.before.value.contentKeywords.length,
      0,
    ),
    domains: changed.reduce((n, e) => n + e.before.value.domains.length, 0),
    labels: changed.reduce(
      (n, e) => n + (e.after.value.annotations?.labels.length ?? 0),
      0,
    ),
  };
  if (values.apply) {
    const client = await pool.connect();
    let fileWritten = false;
    try {
      await client.query('BEGIN');
      await acquireWorkspaceWriteLock(client, workspaceId);
      for (const {before, after} of changed) {
        const updated = await client.query(
          'UPDATE struinfo.information_entry SET type_keyword=NULL,type_custom_name=NULL WHERE workspace_id=$1 AND entry_id=$2 AND current_revision=$3 AND body_sha256=$4',
          [
            workspaceId,
            before.entryId,
            before.revision,
            before.value.bodySha256,
          ],
        );
        assert(updated.rowCount === 1, 'Entry changed during migration.');
        await client.query(
          'INSERT INTO struinfo.information_entry_annotation(workspace_id,entry_id,value_text) VALUES($1,$2,$3) ON CONFLICT(workspace_id,entry_id) DO UPDATE SET value_text=EXCLUDED.value_text',
          [workspaceId, after.entryId, JSON.stringify(after.value.annotations)],
        );
        for (const table of [
          'information_entry_content_keyword',
          'information_entry_domain_keyword',
          'information_entry_term_posting',
          'information_entry_search_projection',
        ])
          await client.query(
            `DELETE FROM struinfo.${table} WHERE workspace_id=$1 AND entry_id=$2`,
            [workspaceId, after.entryId],
          );
        if (!after.value.isPrivate) {
          const {projection: p, postings} =
            prepareInformationEntrySearchProjection(after);
          await client.query(
            'INSERT INTO struinfo.information_entry_search_projection(workspace_id,entry_id,entry_revision,entry_revision_id,projection_sha256,tokenizer_version) VALUES($1,$2,$3,$4,$5,$6)',
            [
              workspaceId,
              p.entryId,
              p.entryRevision,
              p.entryRevisionId,
              p.projectionSha256,
              p.tokenizerVersion,
            ],
          );
          await client.query(
            `INSERT INTO struinfo.information_entry_term_posting(workspace_id,entry_id,field,term,occurrences)
            SELECT $1::uuid,$2::uuid,x.field,x.term,x.occurrences FROM jsonb_to_recordset($3::jsonb) AS x(field text,term text,occurrences integer)`,
            [workspaceId, after.entryId, JSON.stringify(postings)],
          );
        }
      }
      for (const p of published) {
        const result = await client.query(
          'UPDATE struinfo.document_publication_version SET content_text=$3 WHERE workspace_id=$1 AND publication_id=$2 AND content_text=$4',
          [workspaceId, p.id, p.after, p.before],
        );
        assert(result.rowCount === 1, 'Publication changed during migration.');
      }
      // Aggregated document labels are a replaceable projection of the entries.
      await client.query(
        "DELETE FROM struinfo.information_document_tag_value WHERE workspace_id=$1 AND origin='aggregate'",
        [workspaceId],
      );
      await writeFile(
        values.preferences,
        JSON.stringify(nextPreferences, null, 2) + '\n',
      );
      fileWritten = true;
      await store.load(workspaceId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (fileWritten) await writeFile(values.preferences, preferenceBytes);
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify(summary));
} finally {
  await pool.end();
}
