import {z} from 'zod';
import type {
  WebEvidence,
  WebSearchProvider,
} from '../../application/research_contract.js';
import {OperationError} from '../../application/operation_error.js';
import {isBlockedHostname} from '../sources/rss_atom_source_connector.js';

// Fixed vendor endpoints. Never forward credentials to result URLs or redirects.
export function publicWebUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new OperationError('invalid_input', 'web_url_invalid');
  }
  const host = u.hostname.replace(/^\[|\]$/gu, '');
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    isBlockedHostname(host) ||
    !host.includes('.') ||
    host.endsWith('.internal') ||
    (u.port && !['80', '443'].includes(u.port))
  )
    throw new OperationError('invalid_input', 'web_url_invalid');
  u.hash = '';
  return u.href;
}
const result = z.object({
  title: z.string().max(4096),
  url: z.string().max(8192),
  summary: z.string().max(20000).optional(),
  snippet: z.string().max(4000).optional(),
  content: z.string().max(500000).optional(),
  date: z.string().nullable().optional(),
});
export class DeepSeekSearchProvider implements WebSearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = globalThis.fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  private async call(kind: 'search' | 'fetch', body: unknown) {
    const response = await this.request(
      'https://api.deepseek.com/v1/tools/' + kind,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new OperationError('rejected', 'web_provider_failed');
    }
    const reader = response.body?.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    if (reader)
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > 4 * 1024 * 1024)
            throw new OperationError('rejected', 'web_response_too_large');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new OperationError('rejected', 'web_response_invalid');
    }
  }
  async search(query: string, count: number): Promise<WebEvidence[]> {
    const data = z
      .object({results: z.array(result).max(50)})
      .parse(await this.call('search', {query, count, need_content: true}));
    const seen = new Set<string>();
    const results: WebEvidence[] = [];
    for (const row of data.results) {
      let url: string;
      try {
        url = publicWebUrl(row.url);
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({
        title: row.title,
        url,
        summary: row.summary ?? row.snippet ?? '',
        content: row.content ?? '',
        contentKind: row.content?.trim() ? 'body' : 'summary',
        retrievedAt: this.clock().toISOString(),
        ...(row.date && Number.isFinite(Date.parse(row.date))
          ? {publishedAt: new Date(row.date).toISOString()}
          : {}),
      });
    }
    if (data.results.length && !results.length)
      throw new OperationError('rejected', 'web_response_invalid');
    return results.slice(0, count);
  }
  async fetch(url: string): Promise<WebEvidence> {
    const safe = publicWebUrl(url);
    const data = z
      .object({title: z.string().max(4096), content: z.string().max(500000)})
      .parse(await this.call('fetch', {url: safe}));
    if (!data.content.trim())
      throw new OperationError('rejected', 'web_body_missing');
    return {
      title: data.title,
      url: safe,
      summary: '',
      content: data.content,
      contentKind: 'body',
      retrievedAt: this.clock().toISOString(),
    };
  }
}
