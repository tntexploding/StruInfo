import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  InformationEntryQuerySynthesisResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';

export type InformationEntryQuerySynthesisState =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<InformationEntryQuerySynthesisResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

export type InformationEntryQuerySynthesisAction = (
  body: unknown,
  signal: AbortSignal,
) => Promise<M1cHttpResponse<InformationEntryQuerySynthesisResponse>>;

const IDLE_STATE = Object.freeze({
  status: 'idle',
} as const);

export function useInformationEntryQuerySynthesis({
  onSynthesize,
}: {
  readonly onSynthesize: InformationEntryQuerySynthesisAction;
}) {
  const [question, setQuestionValue] = useState('');
  const [state, setState] =
    useState<InformationEntryQuerySynthesisState>(IDLE_STATE);
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | undefined>(undefined);
  const activeRequestId = useRef<string | undefined>(undefined);

  const invalidate = useCallback(() => {
    activeController.current?.abort();
    activeController.current = undefined;
    activeRequestId.current = undefined;
    setState(IDLE_STATE);
  }, []);

  useEffect(
    () => () => {
      activeController.current?.abort();
    },
    [],
  );

  const setQuestion = useCallback(
    (value: string) => {
      if (value === question) return;
      setQuestionValue(value);
      invalidate();
    },
    [invalidate, question],
  );

  const execute = useCallback(
    async (
      query: Readonly<Record<string, unknown>>,
      retrieveForQuestion = false,
    ) => {
      const normalizedQuestion = question.trim();
      if (
        normalizedQuestion.length === 0 ||
        Array.from(normalizedQuestion).length > 600
      ) {
        setState({
          status: 'error',
          message: '请输入不超过 600 字的综合问题。',
        });
        return;
      }
      activeController.current?.abort();
      const controller = new AbortController();
      const requestId = `query-synthesis:${String(++requestSequence.current)}`;
      activeController.current = controller;
      activeRequestId.current = requestId;
      setState({status: 'loading'});

      try {
        const response = await onSynthesize(
          {
            requestId,
            question: normalizedQuestion,
            query,
            ...(retrieveForQuestion ? {retrieveForQuestion: true} : {}),
          },
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          activeRequestId.current !== requestId
        ) {
          return;
        }
        if (
          response.body.status !== 'ok' ||
          response.body.requestId !== requestId
        ) {
          setState({
            status: 'error',
            message: describeSynthesisFailure(response.body),
          });
          return;
        }
        setState({
          status: 'ready',
          response: response.body,
        });
      } catch {
        if (controller.signal.aborted) return;
        if (activeRequestId.current === requestId) {
          setState({
            status: 'error',
            message: 'AI 综合接口当前不可达；本地查询结果仍然可用。',
          });
        }
      } finally {
        if (activeRequestId.current === requestId) {
          activeController.current = undefined;
        }
      }
    },
    [onSynthesize, question],
  );

  return {
    execute,
    question,
    questionCodePoints: Array.from(question).length,
    setQuestion,
    state,
  };
}

function describeSynthesisFailure(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'issue' in value &&
    typeof value.issue === 'object' &&
    value.issue !== null &&
    'code' in value.issue &&
    typeof value.issue.code === 'string'
  ) {
    const labels: Readonly<Record<string, string>> = Object.freeze({
      ai_provider_not_configured: '模型服务 未配置；本地查询不受影响。',
      ai_operations_paused:
        '内置 AI 后续操作已禁止；可在总览允许继续，已有结果保留。',
      ai_price_window_closed:
        '当前为 DeepSeek 高峰时段，请在低价时段重新综合。恢复时间见设置 → AI 接入。',
      ai_query_private_scope_forbidden:
        '隐私查询不能发送给 模型服务；请切换到“仅公开结果”。',
      ai_query_no_evidence: '当前公开查询没有可供回答的内容。',
      ai_provider_timeout: '模型服务 响应超时；可以稍后重试。',
      ai_provider_unavailable: '模型服务 当前不可达；可以稍后重试。',
      ai_provider_rejected: '模型服务 拒绝了本次请求；没有保存任何回答。',
      ai_provider_invalid_response:
        '模型服务 返回的内容格式不正确；该回答已被丢弃。',
    });
    return labels[value.issue.code] ?? `AI 综合失败：${value.issue.code}`;
  }
  return 'AI 综合没有完成；本地查询结果仍然可用。';
}
