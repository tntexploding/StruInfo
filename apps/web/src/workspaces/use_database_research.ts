import {useEffect, useRef, useState} from 'react';
import {
  researchCommand,
  researchError,
  type ResearchAnswer,
  type WebEvidence,
} from '../api/research_client.js';

export interface ResearchQuery {
  mode: 'local' | 'web' | 'mixed';
  operation: 'search' | 'ask';
  text: string;
  webQuery: string;
  query: Readonly<Record<string, unknown>>;
}
interface SearchResult {
  sessionId: string;
  results: WebEvidence[];
  warnings: string[];
}
export function useDatabaseResearch(input: ResearchQuery) {
  const scope = JSON.stringify(input),
    current = useRef(scope);
  useEffect(() => {
    current.current = scope;
    return () => {
      current.current = '';
    };
  }, [scope]);
  const request = useRef<{scope: string; key: string} | undefined>(undefined);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [output, setOutput] = useState<{
    scope: string;
    answer?: ResearchAnswer;
    search?: SearchResult;
  }>();
  async function run() {
    if (lock.current) return;
    if (input.query.includePrivate || input.query.onlyPrivate) {
      setError('请切换到公开资料范围。');
      return;
    }
    if (input.operation === 'ask' && !input.text.trim()) {
      setError('请输入问题。');
      return;
    }
    if (input.mode !== 'local' && !input.webQuery.trim()) {
      setError('请在搜索设置中填写公开搜索词。');
      return;
    }
    if (request.current?.scope !== scope)
      request.current = {scope, key: crypto.randomUUID()};
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const requestKey = request.current.key;
      if (input.operation === 'ask') {
        const answer = await researchCommand<ResearchAnswer>(
          'research_answer',
          {
            requestKey,
            question: input.text,
            mode: input.mode,
            query: input.query,
            ...(input.mode === 'local' ? {} : {webQuery: input.webQuery}),
          },
        );
        if (current.current === scope) setOutput({scope, answer});
      } else {
        const search = await researchCommand<SearchResult>('web_search', {
          requestKey,
          query: input.webQuery,
        });
        if (current.current === scope) setOutput({scope, search});
      }
    } catch (e) {
      if (current.current === scope) setError(researchError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    run,
    output: output?.scope === scope ? output : undefined,
  };
}
