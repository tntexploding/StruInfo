import {useEffect, useRef, useState} from 'react';
import type {
  EntryTranslation,
  EntryTranslationResponse,
  InformationEntry,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';

export interface EntryTranslationServices {
  readonly enabled: boolean;
  readonly onRead: (
    entryId: string,
    revision: number,
    signal: AbortSignal,
  ) => Promise<M1cHttpResponse<EntryTranslationResponse>>;
  readonly onGenerate: (
    entryId: string,
    revision: number,
    signal: AbortSignal,
  ) => Promise<M1cHttpResponse<EntryTranslationResponse>>;
}

export function useEntryTranslation(
  entry: Readonly<InformationEntry>,
  services: Readonly<EntryTranslationServices>,
  preferTranslation = false,
) {
  const [translation, setTranslation] = useState<Readonly<EntryTranslation>>();
  const [busy, setBusy] = useState<'reading' | 'generating' | undefined>(
    entry.value.isPrivate ? undefined : 'reading',
  );
  const [message, setMessage] = useState('');
  const [readVersion, setReadVersion] = useState(0);
  const [showTranslation, setShowTranslation] = useState(preferTranslation);
  const request = useRef<AbortController | undefined>(undefined);
  const {onRead, onGenerate} = services;

  useEffect(() => {
    if (entry.value.isPrivate) return;
    const controller = new AbortController();
    request.current = controller;
    void onRead(entry.entryId, entry.revision, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.body.status === 'ok') {
          const saved = response.body.translation;
          if (
            saved !== null &&
            saved.entryId === entry.entryId &&
            saved.sourceRevisionId === entry.revisionId
          )
            setTranslation(saved);
        } else setMessage(translationErrorMessage(response.body.issue.code));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage('暂时无法读取已保存的译文，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          request.current = undefined;
          setBusy(undefined);
        }
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [
    entry.entryId,
    entry.revision,
    entry.revisionId,
    entry.value.isPrivate,
    onRead,
    readVersion,
  ]);

  async function generate() {
    if (
      !services.enabled ||
      entry.value.isPrivate ||
      request.current !== undefined
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setBusy('generating');
    setMessage('');
    try {
      const response = await onGenerate(
        entry.entryId,
        entry.revision,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (response.body.status !== 'ok') {
        setMessage(translationErrorMessage(response.body.issue.code));
        return;
      }
      const saved = response.body.translation;
      if (
        saved?.entryId !== entry.entryId ||
        saved.sourceRevisionId !== entry.revisionId
      ) {
        setMessage(translationErrorMessage('translation_source_stale'));
        return;
      }
      setTranslation(saved);
      setShowTranslation(true);
    } catch {
      if (!controller.signal.aborted)
        setMessage('翻译请求未完成，请重试；已保存的译文会直接复用。');
    } finally {
      if (!controller.signal.aborted) {
        request.current = undefined;
        setBusy(undefined);
      }
    }
  }
  return {
    retryRead: () => {
      setBusy('reading');
      setMessage('');
      setReadVersion((version) => version + 1);
    },
    translation,
    busy,
    message,
    showTranslation,
    setShowTranslation,
    generate,
  };
}

function translationErrorMessage(code: string): string {
  switch (code) {
    case 'translation_source_stale':
      return '原文版本已变化，请重新查询后再翻译。';
    case 'translation_entry_unavailable':
      return '此条目已不在当前公开范围，请重新查询。';
    case 'translation_input_too_large':
      return '标题与正文超过 24,000 字符，本次无法翻译。原文仍可阅读。';
    case 'ai_provider_not_configured':
      return '翻译服务尚未启用，原文仍可阅读。';
    case 'ai_provider_timeout':
      return '翻译超时，未保存不完整译文。可稍后重试。';
    case 'ai_provider_invalid_response':
      return '未获得完整有效的译文，未保存。可重试或查看原文。';
    default:
      return '翻译服务暂时不可用。原文仍可阅读，可稍后重试。';
  }
}
