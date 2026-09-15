import type {
  EntryTranslation,
  EntryTranslationRepositoryPort,
  EntryTranslationSearchRepositoryPort,
} from '../../../modules/entries/information_entry_translation.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {canonicalUuid, integer, text} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

export const READ_ENTRY_TRANSLATION_SQL = `SELECT t.*,
  to_char(t.translated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS translated_at_text
FROM struinfo.information_entry_translation t
JOIN struinfo.information_entry e USING (workspace_id, entry_id)
WHERE e.workspace_id = $1 AND e.entry_id = $2 AND e.current_revision = $3
  AND e.is_current_structure AND NOT e.is_private
  AND t.target_language = 'zh-CN'
  AND t.source_revision = e.current_revision
  AND t.source_revision_id = e.current_revision_id`;

export const READ_CURRENT_ENTRY_TRANSLATIONS_SQL = `SELECT t.*,
  to_char(t.translated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS translated_at_text
FROM struinfo.information_entry_translation t
JOIN struinfo.information_entry e USING (workspace_id, entry_id)
WHERE e.workspace_id = $1 AND e.is_current_structure AND NOT e.is_private
  AND t.target_language = 'zh-CN'
  AND t.source_revision = e.current_revision
  AND t.source_revision_id = e.current_revision_id
ORDER BY e.entry_id`;

export const SAVE_ENTRY_TRANSLATION_SQL = `INSERT INTO struinfo.information_entry_translation (
  workspace_id, entry_id, target_language, source_revision, source_revision_id,
  title, body, provider_key, model, prompt_version, translated_at
)
SELECT e.workspace_id, e.entry_id, 'zh-CN', e.current_revision, e.current_revision_id,
  $5, $6, $7, $8, $9, $10::timestamptz
FROM struinfo.information_entry e
WHERE e.workspace_id = $1 AND e.entry_id = $2
  AND e.current_revision = $3 AND e.current_revision_id = $4
  AND e.is_current_structure AND NOT e.is_private
ON CONFLICT (workspace_id, entry_id, target_language) DO UPDATE SET
  source_revision = EXCLUDED.source_revision, source_revision_id = EXCLUDED.source_revision_id,
  title = EXCLUDED.title, body = EXCLUDED.body, provider_key = EXCLUDED.provider_key,
  model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version, translated_at = EXCLUDED.translated_at
WHERE information_entry_translation.source_revision <> EXCLUDED.source_revision
   OR information_entry_translation.source_revision_id <> EXCLUDED.source_revision_id`;

export class PostgresEntryTranslationRepository
  implements
    EntryTranslationRepositoryPort,
    EntryTranslationSearchRepositoryPort
{
  public constructor(private readonly pool: PostgresPoolBoundary) {}

  public load(
    workspaceId: string,
    entryId: string,
    revision: number,
  ): Promise<Readonly<EntryTranslation> | undefined> {
    return runPostgresTransaction(
      this.pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Readonly<Record<string, unknown>>>(
          READ_ENTRY_TRANSLATION_SQL,
          [
            canonicalUuid(workspaceId),
            canonicalUuid(entryId),
            integer(revision),
          ],
        );
        const row = result.rows[0];
        if (row === undefined) return undefined;
        return decodeTranslation(row);
      },
    );
  }

  public loadCurrentTranslations(
    workspaceId: string,
  ): Promise<readonly Readonly<EntryTranslation>[]> {
    return runPostgresTransaction(
      this.pool,
      'repeatable_read_only',
      async (client) => {
        const result = await client.query<Readonly<Record<string, unknown>>>(
          READ_CURRENT_ENTRY_TRANSLATIONS_SQL,
          [canonicalUuid(workspaceId)],
        );
        return Object.freeze(result.rows.map(decodeTranslation));
      },
    );
  }

  public saveIfCurrent(
    workspaceId: string,
    translation: Readonly<EntryTranslation>,
  ): Promise<boolean> {
    return runPostgresTransaction(
      this.pool,
      'read_committed',
      async (client) => {
        await acquireWorkspaceWriteLock(client, canonicalUuid(workspaceId));
        const result = await client.query(SAVE_ENTRY_TRANSLATION_SQL, [
          workspaceId,
          canonicalUuid(translation.entryId),
          integer(translation.sourceRevision),
          canonicalUuid(translation.sourceRevisionId),
          translation.title,
          translation.body,
          translation.providerKey,
          translation.model,
          translation.promptVersion,
          translation.translatedAt,
        ]);
        return result.rowCount === 1;
      },
    );
  }
}

function decodeTranslation(
  row: Readonly<Record<string, unknown>>,
): Readonly<EntryTranslation> {
  const providerKey = text(row.provider_key);
  if (
    providerKey !== 'openai-responses-v1' &&
    providerKey !== 'deepseek-responses-v1' &&
    providerKey !== 'provided-translation-v1'
  )
    throw new Error('Unsupported translation origin.');
  return Object.freeze({
    entryId: canonicalUuid(row.entry_id),
    sourceRevision: integer(row.source_revision),
    sourceRevisionId: canonicalUuid(row.source_revision_id),
    targetLanguage: 'zh-CN',
    title: text(row.title),
    body: text(row.body),
    providerKey,
    model: text(row.model),
    promptVersion: text(row.prompt_version),
    translatedAt: text(row.translated_at_text),
  });
}
