import {describe, expect, it} from 'vitest';
import {
  isPublicationOnly,
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
});
