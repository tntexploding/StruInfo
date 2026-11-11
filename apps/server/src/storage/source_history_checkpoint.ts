import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {
  HistoryArticle,
  HistorySession,
  HistorySourceState,
  HistoryItemResult,
  HistoryCheckpointStore,
} from '../modules/subscriptions/source_history.js';

type Header = Omit<HistorySession, 'sources' | 'articles' | 'plan'> & {
  sources: (Omit<
    HistorySourceState,
    'seen' | 'pageFingerprints' | 'methods'
  > & {seen: string[]; pageFingerprints: string[]; methods: string[]})[];
  plan?: Omit<NonNullable<HistorySession['plan']>, 'ids' | 'results'> & {
    ids: string[];
    results: HistoryItemResult[];
  };
};

// The owner API is the single writer. A page is visible only after its header commits.
// Store directory metadata once per page. Source bodies belong to the evidence store.
export class SourceHistoryCheckpoint implements HistoryCheckpointStore {
  constructor(private readonly directory: string) {}
  private folder(id: string) {
    return join(this.directory, z.uuid().parse(id));
  }
  async load(): Promise<HistorySession[]> {
    await mkdir(this.directory, {recursive: true});
    const sessions: HistorySession[] = [];
    for (const id of await readdir(this.directory)) {
      if (!z.uuid().safeParse(id).success) continue;
      const dir = this.folder(id);
      let header: Header;
      try {
        header = JSON.parse(
          await readFile(join(dir, 'session.json'), 'utf8'),
        ) as Header;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (
        header.id !== id ||
        !Number.isSafeInteger(header.parts) ||
        header.parts < 0
      )
        throw new Error('history_checkpoint_invalid');
      const {sources, plan, ...meta} = header;
      const session: HistorySession = {
        ...meta,
        articles: new Map(),
        sources: new Map(
          sources.map((s) => [
            s.subscriptionId,
            {
              ...s,
              busy: false,
              seen: new Set(s.seen),
              pageFingerprints: new Set(s.pageFingerprints),
              methods: new Set(s.methods),
            },
          ]),
        ),
      };
      if (plan)
        session.plan = {
          ...plan,
          ids: new Set(plan.ids),
          results: new Map(plan.results.map((r) => [r.id, r])),
        };
      for (let i = 0; i < header.parts; i++) {
        const rows = JSON.parse(
          await readFile(join(dir, String(i) + '.json'), 'utf8'),
        ) as HistoryArticle[];
        for (const row of rows) session.articles.set(row.id, row);
      }
      sessions.push(session);
    }
    return sessions;
  }
  async save(s: HistorySession, changed: readonly HistoryArticle[]) {
    const dir = this.folder(s.id);
    await mkdir(dir, {recursive: true});
    const parts = s.parts + (changed.length ? 1 : 0);
    const header: Header = {
      id: s.id,
      ...(s.batchKey ? {batchKey: s.batchKey} : {}),
      ...(s.legacyOwned ? {legacyOwned: s.legacyOwned} : {}),
      touched: s.touched,
      parts,
      ...(s.work ? {work: s.work} : {}),
      ...(s.problem ? {problem: s.problem} : {}),
      ...(s.selection ? {selection: s.selection} : {}),
      sources: [...s.sources.values()].map((row) => ({
        ...row,
        busy: false,
        seen: [...row.seen],
        methods: [...row.methods],
        pageFingerprints: [...row.pageFingerprints],
      })),
      ...(s.plan
        ? {
            plan: {
              ...s.plan,
              ids: [...s.plan.ids],
              results: [...s.plan.results.values()],
            },
          }
        : {}),
    };
    if (changed.length)
      await this.replace(join(dir, String(s.parts) + '.json'), changed);
    await this.replace(join(dir, 'session.json'), header);
    s.parts = parts;
  }
  async remove(id: string) {
    await rm(this.folder(id), {recursive: true, force: true});
  }
  private async replace(path: string, value: unknown) {
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(value), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, {force: true});
    }
  }
}
