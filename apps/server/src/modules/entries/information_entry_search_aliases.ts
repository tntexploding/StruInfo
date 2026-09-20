import {informationEntrySearchKey} from './information_entry.js';
import type {InformationEntrySearchRequest} from './information_entry_contract.js';

/** Only owner-confirmed equivalence mappings enter this port; never model guesses. */
export interface ConfirmedEntryAlias {
  readonly source: string;
  readonly canonical: string;
}

export function prepareEntrySearchAliases(
  request: Readonly<InformationEntrySearchRequest>,
  aliases: readonly Readonly<ConfirmedEntryAlias>[],
): Readonly<{text: readonly string[]; contentKeyword: readonly string[]}> {
  const expand = (value: string | undefined): readonly string[] => {
    const key = informationEntrySearchKey(value ?? '');
    if (!key) return [];
    const found = new Set([key]);
    const pairs = aliases.map(
      ({source, canonical}) =>
        [
          informationEntrySearchKey(source),
          informationEntrySearchKey(canonical),
        ] as const,
    );
    const pending = [key];
    for (const term of pending) {
      for (const [source, canonical] of pairs) {
        const other =
          term === source ? canonical : term === canonical ? source : '';
        if (other && !found.has(other)) {
          found.add(other);
          pending.push(other);
        }
      }
    }
    return [...found].filter((term) => term !== key).sort();
  };
  return {
    text:
      request.retrievalMode !== 'semantic' &&
      (request.textFields === undefined || request.textFields.includes('tags'))
        ? expand(request.text)
        : [],
    contentKeyword: expand(request.contentKeyword),
  };
}
