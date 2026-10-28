import {describe, expect, it} from 'vitest';
import {
  isPublicationOnly,
  isReferenceOnly,
  withoutPublicationContext,
} from './publication_context.js';

describe('publication context projection', () => {
  it('removes explicit appendices from model subjects while preserving stored evidence', () => {
    const body =
      '# A synthetic mechanism\n\nA valve controls pressure.\n\n# Colophon ( permalink )\n\nUpcoming books: a fictional catalogue.\n\n# How to get Example Bulletin\n\nSubscription links.';
    expect(withoutPublicationContext(body)).toBe(
      '# A synthetic mechanism\n\nA valve controls pressure.\n\n',
    );
    expect(body).toContain('Subscription links.');
    expect(isPublicationOnly(body)).toBe(false);
    expect(isPublicationOnly(body.slice(body.indexOf('# Colophon')))).toBe(
      true,
    );
  });

  it('keeps conclusions after a same-level appendix and all Related discussion', () => {
    const body =
      '# Article\n\nMain result.\n\n## Copyright\n\nLicence terms.\n\n## Conclusion\n\nThe mechanism has limits.\n\n## Related\n\nA further experiment changes the conclusion.';
    const projected = withoutPublicationContext(body);
    expect(projected).not.toContain('Licence terms.');
    expect(projected).toContain('The mechanism has limits.');
    expect(projected).toContain('A further experiment');
    expect(isPublicationOnly(body.slice(body.indexOf('## Copyright')))).toBe(
      false,
    );
  });

  it('does not mistake source-code headings or a whole biography for appendices', () => {
    for (const body of [
      '# About the author\n\nA complete biography.',
      '# Example\n\n```markdown\n# Colophon\nSample syntax\n```\n\nActual discussion.',
    ]) {
      expect(withoutPublicationContext(body)).toBe(body);
    }
    expect(isPublicationOnly('# Example\n\n```markdown\n# Colophon\n```')).toBe(
      false,
    );
  });

  it('preserves reference directories, selected reading and substantive subscription articles', () => {
    for (const body of [
      '# References\n\nTwo resources explained in detail.',
      '# Further reading\n\nAn editor-selected annotated list.',
      '# Subscription mechanisms\n\nHow consumer queues acknowledge events.',
    ]) {
      expect(withoutPublicationContext(body)).toBe(body);
      expect(isPublicationOnly(body)).toBe(false);
    }
  });

  it('recognizes bare linked headlines, archive lists and a short book availability notice', () => {
    for (const body of [
      '# Links\n\n- An interesting question? [https://example.invalid/a](https://example.invalid/a)\n\n- Another headline [https://example.invalid/b](https://example.invalid/b)',
      '# Past issues\n\n#5yrsago A historical headline; an update [https://example.invalid/a](https://example.invalid/a)\n\n# Upcoming appearances\n\nA talk next week.\n\n# Latest books\n\nA catalogue.',
      '# A synthetic book\n\nIf you want to learn about queues, Chapter 4 in my [Queue Book](https://example.invalid/book) is now available in early access.\n\n![Cover](https://example.invalid/cover)\nQueue Book [repository](https://example.invalid/code) and [book](https://example.invalid/book)',
    ]) {
      expect(isPublicationOnly(body)).toBe(true);
      const article = '# A valve\n\nA valve limits pressure.\n\n' + body;
      expect(withoutPublicationContext(article)).toBe(
        '# A valve\n\nA valve limits pressure.\n\n',
      );
      // Whole documents remain available; projection cannot erase their text.
      expect(withoutPublicationContext(body)).toBe(body);
    }
  });

  it('retains annotated resources, technical notes and substantive book discussion', () => {
    for (const body of [
      '# Tools\n\n[Profiler](https://example.invalid/a)\n\nIt samples allocations without stopping the process.',
      '# Queue book\n\nChapter 4 is now available. It explains how ownership prevents two workers from acknowledging the same event.',
      '# Short note\n\n- A valve reduces pressure by venting excess flow. [https://example.invalid/a](https://example.invalid/a)',
      '# Paper collection\n\nA paper title [https://example.invalid/a](https://example.invalid/a)\n\nThe benchmark measures queue throughput across three load levels.',
      '# References\n\n- [Valve](https://example.invalid/a#result): It releases excess pressure.\n\n- [Cache](https://example.invalid/b#result): It expires old records.',
    ]) {
      expect(isReferenceOnly(body)).toBe(false);
      expect(isPublicationOnly(body)).toBe(false);
      expect(withoutPublicationContext(body)).toBe(body);
    }
  });
});
