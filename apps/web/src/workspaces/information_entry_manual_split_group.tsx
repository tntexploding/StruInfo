import {useState} from 'react';

import {
  manualSplitCaretCodePoint,
  manualSplitPieceText,
  type ManualSplitDraftGroup,
} from './information_entry_manual_split_model.js';

interface ManualSplitGroupEditorProps {
  readonly busy: boolean;
  readonly group: Readonly<ManualSplitDraftGroup>;
  readonly groupIndex: number;
  readonly onMergePrevious: () => void;
  readonly onSplitBefore: (pieceIndex: number) => void;
  readonly onSplitWithin: (pieceIndex: number, codePoint: number) => void;
  readonly onTitleChange: (titlePath: string) => void;
}

export function ManualSplitGroupEditor({
  busy,
  group,
  groupIndex,
  onMergePrevious,
  onSplitBefore,
  onSplitWithin,
  onTitleChange,
}: ManualSplitGroupEditorProps) {
  const [caret, setCaret] = useState<
    Readonly<{pieceIndex: number; utf16Offset: number}> | undefined
  >();
  const [guidance, setGuidance] = useState<string>();
  const titleId = `manual-split-title-${groupIndex.toString()}`;

  return (
    <li>
      {groupIndex === 0 ? null : (
        <button
          className="entry-manual-split__merge"
          type="button"
          disabled={busy}
          onClick={onMergePrevious}
        >
          与上一条合并
        </button>
      )}
      <article className="entry-manual-split__group">
        <header>
          <strong>条目 {String(groupIndex + 1).padStart(2, '0')}</strong>
          <span>{group.pieces.length.toString()} 个来源段</span>
        </header>
        <label htmlFor={titleId}>条目标题</label>
        <input
          id={titleId}
          type="text"
          value={group.titlePath}
          maxLength={200}
          disabled={busy}
          onChange={(event) => {
            onTitleChange(event.currentTarget.value);
          }}
        />
        <div className="entry-manual-split__fragments">
          {group.pieces.map((piece, pieceIndex) => {
            const pieceText = manualSplitPieceText(piece);
            const scalarLength = piece.endCodePoint - piece.startCodePoint;
            function rememberCaret(utf16Offset: number) {
              setCaret({pieceIndex, utf16Offset});
              setGuidance(undefined);
            }
            return (
              <div
                key={`${piece.fragment.fragmentId}:${piece.startCodePoint.toString()}`}
              >
                {pieceIndex === 0 ? null : (
                  <button
                    className="entry-manual-split__cut"
                    type="button"
                    disabled={busy}
                    aria-label={`在条目 ${String(groupIndex + 1)} 的第 ${String(pieceIndex + 1)} 个来源段前拆开`}
                    onClick={() => {
                      setGuidance(undefined);
                      onSplitBefore(pieceIndex);
                    }}
                  >
                    在段前拆开
                  </button>
                )}
                <article className="entry-manual-split__piece">
                  <header>
                    <span>
                      来源段 {String(pieceIndex + 1).padStart(2, '0')}
                    </span>
                    <span>
                      字符 {piece.startCodePoint.toString()}–
                      {piece.endCodePoint.toString()}
                    </span>
                  </header>
                  <textarea
                    readOnly
                    spellCheck={false}
                    value={pieceText}
                    aria-label={`条目 ${String(groupIndex + 1)} 来源段 ${String(pieceIndex + 1)} 正文`}
                    onClick={(event) => {
                      rememberCaret(event.currentTarget.selectionStart);
                    }}
                    onKeyUp={(event) => {
                      rememberCaret(event.currentTarget.selectionStart);
                    }}
                    onSelect={(event) => {
                      rememberCaret(event.currentTarget.selectionStart);
                    }}
                  />
                  <div className="entry-manual-split__piece-actions">
                    <span>将光标放在正文中，再明确执行拆分。</span>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={busy || scalarLength < 2}
                      onClick={() => {
                        const codePoint =
                          caret?.pieceIndex === pieceIndex
                            ? manualSplitCaretCodePoint(
                                piece,
                                caret.utf16Offset,
                              )
                            : undefined;
                        if (
                          codePoint === undefined ||
                          codePoint <= piece.startCodePoint ||
                          codePoint >= piece.endCodePoint
                        ) {
                          setGuidance('请把光标放在本段正文的两个字符之间。');
                          return;
                        }
                        setGuidance(undefined);
                        onSplitWithin(pieceIndex, codePoint);
                      }}
                    >
                      在光标处分开
                    </button>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
        {guidance === undefined ? null : (
          <p className="entry-manual-split__guidance" role="status">
            {guidance}
          </p>
        )}
      </article>
    </li>
  );
}
