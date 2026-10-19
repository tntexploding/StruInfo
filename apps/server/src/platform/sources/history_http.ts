import {
  defaultResolveAddresses,
  isBlockedAddress,
  isBlockedHostname,
} from './rss_atom_source_connector.js';

export class HistoryReadError extends Error {}
import {historyUrl} from '../../modules/subscriptions/source_history.js';
export {
  historyUrl,
  historyIdentity,
} from '../../modules/subscriptions/source_history.js';
export class HistoryHttp {
  private readonly lastRequest = new Map<string, number>();
  public constructor(
    private readonly deps: {
      fetch?: typeof fetch;
      resolveAddresses?: (hostname: string) => Promise<readonly string[]>;
    } = {},
  ) {}
  public async read(input: string, base: string) {
    let target = historyUrl(input, base);
    if (!target) throw new HistoryReadError('history_url_not_allowed');
    const host = new URL(target).hostname;
    if (!this.deps.fetch) {
      const delay = Math.max(
        0,
        (this.lastRequest.get(host) ?? 0) + 1000 - Date.now(),
      );
      this.lastRequest.set(host, Date.now() + delay);
      if (delay)
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    const signal = AbortSignal.timeout(20_000);
    for (let hop = 0; hop < 5; hop++) {
      const url = new URL(target);
      const addresses = await (
        this.deps.resolveAddresses ?? defaultResolveAddresses
      )(url.hostname);
      if (
        isBlockedHostname(url.hostname) ||
        !addresses.length ||
        addresses.some(isBlockedAddress)
      )
        throw new HistoryReadError('history_url_not_allowed');
      const response = await (this.deps.fetch ?? fetch)(url, {
        redirect: 'manual',
        signal,
        headers: {
          accept: 'application/json, application/xml, text/html, */*',
          'user-agent': 'StruInfo/0.3 (+owner-requested-history)',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        target = historyUrl(response.headers.get('location') ?? '', target);
        if (!target) throw new HistoryReadError('history_redirect_not_allowed');
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new HistoryReadError('history_http_' + String(response.status));
      }
      const max = 8 * 1024 * 1024;
      if (Number(response.headers.get('content-length') ?? 0) > max) {
        await response.body?.cancel();
        throw new HistoryReadError('history_response_too_large');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      try {
        if (reader)
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > max)
              throw new HistoryReadError('history_response_too_large');
            chunks.push(chunk.value);
          }
      } finally {
        await reader?.cancel().catch(() => undefined);
      }
      const bytes = Buffer.concat(chunks);
      return {
        url: target,
        bytes,
        text: new TextDecoder('utf-8', {fatal: true}).decode(bytes),
        headers: response.headers,
      };
    }
    throw new HistoryReadError('history_redirect_limit');
  }
}
