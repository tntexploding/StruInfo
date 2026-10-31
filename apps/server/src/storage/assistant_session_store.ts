import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  rm,
} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {
  AssistantSession,
  AssistantSessionStore,
} from '../application/assistant_session.js';
import {OperationError} from '../application/operation_error.js';

/** One API process owns the assistant. The external data volume survives container replacement. */
export class LocalAssistantSessionStore implements AssistantSessionStore {
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}
  private path(id: string) {
    if (!/^[a-f0-9]{64}$/u.test(id))
      throw new OperationError('invalid_input', 'assistant_invalid_session');
    return join(this.directory, id + '.json');
  }
  async read(id: string): Promise<AssistantSession | undefined> {
    try {
      const value = JSON.parse(
        await readFile(this.path(id), 'utf8'),
      ) as AssistantSession;
      if (
        value.id !== id ||
        !Number.isInteger(value.version) ||
        !Array.isArray(value.turns)
      )
        throw new Error('Invalid assistant session');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async list() {
    await mkdir(this.directory, {recursive: true});
    const sessions: AssistantSession[] = [];
    for (const name of await readdir(this.directory))
      if (/^[a-f0-9]{64}\.json$/u.test(name)) {
        const session = await this.read(name.slice(0, -5));
        if (session) sessions.push(session);
      }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async save(session: AssistantSession, expectedVersion: number) {
    await this.write(session.id, async () => {
      const path = this.path(session.id),
        current = await this.read(session.id);
      if ((current?.version ?? 0) !== expectedVersion)
        throw new OperationError('conflict', 'assistant_session_changed');
      await mkdir(this.directory, {recursive: true});
      const temporary = path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(
          temporary,
          JSON.stringify({...session, version: expectedVersion + 1}),
          {encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true},
        );
        await rename(temporary, path);
        session.version = expectedVersion + 1;
      } finally {
        await rm(temporary, {force: true});
      }
    });
  }
  async delete(id: string, expectedVersion: number) {
    await this.write(id, async () => {
      const current = await this.read(id);
      if (!current) return;
      if (current.version !== expectedVersion)
        throw new OperationError('conflict', 'assistant_session_changed');
      await rm(this.path(id));
    });
  }
  private async write(id: string, operation: () => Promise<void>) {
    const previous = this.pending.get(id) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(operation);
    this.pending.set(id, work);
    try {
      await work;
    } finally {
      if (this.pending.get(id) === work) this.pending.delete(id);
    }
  }
}
