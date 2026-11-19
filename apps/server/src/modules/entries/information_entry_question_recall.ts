import type {
  CurrentInformationEntry,
  EntryTextSearchField,
} from './information_entry_contract.js';
import type {AnnotationVocabulary} from './structured_annotations.js';
import {entryTagWords} from './entry_tags.js';
import {tokenizeInformationEntryText} from './information_entry_search_index.js';
const COMMON = new Set(
  'the a an and or of to in on for is are was were be been with from what which how why can could should would do does did please explain describe compare tell me about these those this that have has us it its we you your according 根据 关于 哪些 什么 如何 怎样 为什么 请问 介绍 解释 说明 这些 那些 目前 现在 内容 材料 文档 资料 以及 是否 我们 他们 可以 有何 有什么 的是 是什么'.split(
    ' ',
  ),
);
/** Weighted term recall shared by search, questions and report evidence. */
export function lexicalQuestionScores(
  entries: readonly Readonly<CurrentInformationEntry>[],
  question: string,
  fields: readonly EntryTextSearchField[],
  vocabulary: AnnotationVocabulary,
): ReadonlyMap<string, number> {
  const terms = [...new Set(tokenizeInformationEntryText(question))].filter(
    (term) => Array.from(term).length > 1 && !COMMON.has(term),
  );
  const indexed = entries.map((entry) => ({
    entry,
    title: new Set(
      fields.includes('title')
        ? tokenizeInformationEntryText(entry.value.titlePath)
        : [],
    ),
    tags: new Set(
      fields.includes('tags')
        ? tokenizeInformationEntryText(
            entryTagWords(entry.value, vocabulary).join(' '),
          )
        : [],
    ),
    body: new Set(
      fields.includes('body')
        ? tokenizeInformationEntryText(entry.value.body)
        : [],
    ),
  }));
  const frequency = new Map(
    terms.map((term) => [
      term,
      indexed.filter(
        (row) =>
          row.title.has(term) || row.tags.has(term) || row.body.has(term),
      ).length,
    ]),
  );
  const weights = new Map(
    terms.map((term) => [
      term,
      Math.log(1 + indexed.length / (1 + (frequency.get(term) ?? 0))),
    ]),
  );
  const totalWeight = [...weights.values()].reduce(
    (sum, weight) => sum + weight,
    0,
  );
  return new Map(
    indexed.flatMap((row) => {
      let score = 0;
      for (const term of terms) {
        const weight = row.title.has(term)
          ? 3
          : row.tags.has(term)
            ? 2.5
            : row.body.has(term)
              ? 1
              : 0;
        score += weight * (weights.get(term) ?? 0);
      }
      return score > 0
        ? [
            [
              row.entry.entryId,
              Math.min(
                9500,
                Math.round((score / Math.max(totalWeight, 1)) * 4000),
              ),
            ] as const,
          ]
        : [];
    }),
  );
}
