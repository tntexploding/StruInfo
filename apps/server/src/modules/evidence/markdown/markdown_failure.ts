import type {
  MarkdownBudgetName,
  MarkdownIssue,
  MarkdownIssueCode,
  ParsedSourceRange,
} from './markdown_contract.js';

export class MarkdownFault extends Error {
  public readonly issue: Readonly<MarkdownIssue>;

  public constructor(
    code: MarkdownIssueCode,
    path: string,
    options?: Readonly<{
      range?: Readonly<ParsedSourceRange>;
      budget?: MarkdownBudgetName;
    }>,
  ) {
    super('Markdown transformation failed.');
    this.name = 'MarkdownFault';
    this.issue = Object.freeze({
      code,
      path,
      ...(options?.range === undefined
        ? {}
        : {range: freezeRange(options.range)}),
      ...(options?.budget === undefined ? {} : {budget: options.budget}),
    });
  }
}

export function markdownFail(
  code: MarkdownIssueCode,
  path: string,
  options?: Readonly<{
    range?: Readonly<ParsedSourceRange>;
    budget?: MarkdownBudgetName;
  }>,
): never {
  throw new MarkdownFault(code, path, options);
}

export function freezeMarkdownMetadata<Value>(value: Value): Value {
  if (
    value === null ||
    typeof value !== 'object' ||
    value instanceof Uint8Array ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  const record = value as unknown as Readonly<Record<string, unknown>>;
  for (const child of Object.values(record)) {
    freezeMarkdownMetadata(child);
  }
  return Object.freeze(value);
}

function freezeRange(
  range: Readonly<ParsedSourceRange>,
): Readonly<ParsedSourceRange> {
  return Object.freeze({
    codePointRange: Object.freeze({...range.codePointRange}),
    lineRange: Object.freeze({...range.lineRange}),
  });
}
