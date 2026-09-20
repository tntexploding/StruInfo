import {createPortal} from 'react-dom';
import type {ReactNode, RefObject} from 'react';
import {ReadingContent} from '../components/reading_content.js';
import {readingTitle} from '../components/reading_text.js';
import type {InformationEntry} from '../api/m1c_api_contract.js';
import {
  useEntryTranslation,
  type EntryTranslationServices,
} from './use_entry_translation.js';

export function InformationEntryTranslation({
  entry,
  services,
  preferTranslation = true,
  scrollPositions,
  active = true,
  controlsContainer,
  descriptiveLabels = false,
  allowRedo = false,
  leadingContent,
}: {
  readonly controlsContainer?: HTMLElement | null;
  readonly descriptiveLabels?: boolean;
  readonly allowRedo?: boolean;
  readonly leadingContent?: ReactNode;
  readonly entry: Readonly<InformationEntry>;
  readonly services: Readonly<EntryTranslationServices>;
  readonly preferTranslation?: boolean;
  readonly active?: boolean;
  readonly scrollPositions?: RefObject<Map<string, number>> | undefined;
}) {
  const state = useEntryTranslation(entry, services, preferTranslation);
  const translated = state.showTranslation && state.translation !== undefined;
  const tooLarge =
    Array.from(entry.value.titlePath + entry.value.body).length > 24_000;
  const controls = (
    <div className="translation-controls">
      {' '}
      <div className="entry-command-actions" aria-label="阅读语言">
        <button
          type="button"
          className="secondary-action"
          aria-pressed={!translated}
          onClick={() => {
            state.setShowTranslation(false);
          }}
        >
          {descriptiveLabels ? '查看原文' : '原文'}
        </button>
        <button
          type="button"
          className="secondary-action"
          aria-pressed={translated}
          disabled={state.translation === undefined}
          onClick={() => {
            state.setShowTranslation(true);
          }}
        >
          {descriptiveLabels ? '查看译文' : '中文译文'}
        </button>
        {state.translation !== undefined &&
        (!allowRedo ||
          state.translation.providerKey ===
            'provided-translation-v1') ? null : (
          <button
            type="button"
            className="secondary-action"
            disabled={
              !services.enabled ||
              entry.value.isPrivate ||
              tooLarge ||
              state.busy !== undefined
            }
            onClick={() => {
              void state.generate(state.translation !== undefined);
            }}
          >
            {state.busy === 'generating'
              ? '正在翻译…'
              : state.translation
                ? 'AI 重做译文'
                : '生成中文译文'}
          </button>
        )}
      </div>
      <p className="workflow-boundary-note">
        {entry.value.isPrivate
          ? '隐私条目仅支持原文阅读，不会发送给翻译服务。'
          : state.translation !== undefined
            ? '译文单独保存，原文保留。'
            : !services.enabled
              ? '翻译服务尚未启用。配置后可按需生成。'
              : tooLarge
                ? '标题与正文超过 24,000 字符，本次无法翻译。'
                : '点击生成会将当前条目的标题和正文发送给 模型服务。译文单独保存，原文保留；仅翻译已入库内容，摘要不会补全为全文。'}
      </p>
      <div role="status" aria-live="polite">
        {state.busy === 'reading' ? <p>正在读取已保存的译文…</p> : null}
        {state.busy === 'generating' ? (
          <p>正在生成并保存译文。离开页面后，已发出的任务可能继续完成。</p>
        ) : null}
        {state.message === '' ? null : (
          <>
            <p>{state.message}</p>
            <button
              type="button"
              className="secondary-action"
              disabled={state.busy !== undefined}
              onClick={state.retryRead}
            >
              重新读取译文
            </button>
          </>
        )}
      </div>
    </div>
  );
  return (
    <section className="entry-translation" aria-label="原文与中文译文">
      {controlsContainer === undefined
        ? controls
        : controlsContainer === null
          ? null
          : createPortal(controls, controlsContainer)}
      {translated && state.translation !== undefined ? (
        <>
          <p className="workflow-boundary-note">
            {state.translation.providerKey === 'provided-translation-v1'
              ? '外部导入译文 · 可能包含机器翻译，请结合原文核对。'
              : '机器翻译 · 供阅读参考，请结合原文核对。'}
          </p>
          {state.translation.title === '' ? null : (
            <h3 lang="zh-CN">{readingTitle(state.translation.title)}</h3>
          )}
          <ReadingContent
            leadingContent={leadingContent}
            active={active}
            scrollMemory={
              scrollPositions === undefined
                ? undefined
                : {
                    key:
                      entry.entryId +
                      ':' +
                      entry.revision.toString() +
                      ':translation',
                    positions: scrollPositions,
                  }
            }
            text={state.translation.body}
            scrollLabel="中文译文正文"
            baseUri={entry.canonicalUri}
            omitLeadingTitle={state.translation.title}
            lang="zh-CN"
          />
        </>
      ) : (
        <ReadingContent
          leadingContent={leadingContent}
          active={active}
          scrollMemory={
            scrollPositions === undefined
              ? undefined
              : {
                  key:
                    entry.entryId + ':' + entry.revision.toString() + ':source',
                  positions: scrollPositions,
                }
          }
          text={entry.value.body}
          scrollLabel="原文正文"
          baseUri={entry.canonicalUri}
          omitLeadingTitle={entry.value.titlePath}
        />
      )}
    </section>
  );
}
