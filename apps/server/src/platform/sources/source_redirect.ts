import {SourceConnectorError} from '../../modules/subscriptions/source_connector.js';
import {historyUrl} from '../../modules/subscriptions/source_history.js';

/** Follow publisher path/www moves, retaining the public-host check at each hop. */
export async function readSourceResponse(
  initial: URL,
  init: RequestInit,
  fetcher: typeof fetch,
  admit: (hostname: string) => Promise<void>,
): Promise<{response: Response; url: URL}> {
  let url = initial;
  for (let hop = 0; hop <= 3; hop++) {
    await admit(url.hostname);
    const headers = new Headers(init.headers);
    if (hop) {
      headers.delete('if-none-match');
      headers.delete('if-modified-since');
    }
    let response: Response;
    try {
      response = await fetcher(url, {...init, headers, redirect: 'manual'});
    } catch {
      throw new SourceConnectorError('connector_unavailable');
    }
    if (![301, 302, 303, 307, 308].includes(response.status))
      return {response, url};
    await response.body?.cancel();
    const location = response.headers.get('location');
    const next = location ? historyUrl(location, url.href) : undefined;
    if (!next || hop === 3)
      throw new SourceConnectorError('connector_result_invalid');
    url = new URL(next);
  }
  throw new SourceConnectorError('connector_result_invalid');
}
