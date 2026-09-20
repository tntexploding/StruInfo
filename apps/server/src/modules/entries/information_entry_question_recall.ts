import {createHash} from 'node:crypto';
import type {InformationEntrySearchResult} from './information_entry_contract.js';
import {tokenizeInformationEntryText} from './information_entry_search_index.js';
const COMMON = new Set(
  'the a an and or of to in on for is are was were be been with from what which how why can could should would do does did please explain describe compare tell me about these those this that have has us it its we you your according 根据 关于 哪些 什么 如何 怎样 为什么 请问 介绍 解释 说明 这些 那些 目前 现在 内容 材料 文档 资料 以及 是否 我们 他们 可以 有何 有什么 的是 是什么'.split(
    ' ',
  ),
);
/** Local lexical question recall; does not generate embeddings or transfer source text. */
export function rankQuestionEvidence(
  result: Readonly<InformationEntrySearchResult>,
  question: string,
  limit: number,
): Readonly<InformationEntrySearchResult> {
  const terms = [...new Set(tokenizeInformationEntryText(question))].filter(
    (term) => Array.from(term).length > 1 && !COMMON.has(term),
  );
  const indexed = result.items.map((item) => {
    const title = new Set(
      tokenizeInformationEntryText(item.entry.value.titlePath),
    );
    const tags = new Set(
      tokenizeInformationEntryText(
        item.entry.value.contentKeywords
          .map((tag) => tag.displayValue)
          .join(' '),
      ),
    );
    const body = new Set(tokenizeInformationEntryText(item.entry.value.body));
    return {item, title, tags, body};
  });
  const frequency = new Map(
    terms.map((term) => [
      term,
      indexed.filter(
        (row) =>
          row.title.has(term) || row.tags.has(term) || row.body.has(term),
      ).length,
    ]),
  );
  const ranked = indexed
    .map((row) => ({
      ...row,
      score: terms.reduce((sum, term) => {
        const weight = row.title.has(term)
          ? 3
          : row.tags.has(term)
            ? 2.5
            : row.body.has(term)
              ? 1
              : 0;
        return (
          sum +
          weight *
            Math.log(1 + indexed.length / (1 + (frequency.get(term) ?? 0)))
        );
      }, 0),
    }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.entry.entryId.localeCompare(b.item.entry.entryId),
    );
  return {
    querySha256: createHash('sha256')
      .update(result.querySha256 + '\nquestion-v1\n' + question)
      .digest('hex'),
    totalCount: ranked.length,
    items: ranked.slice(0, limit).map((row) => row.item),
  };
}
