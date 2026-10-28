import {useEffect, useRef, useState} from 'react';
import type {InformationEntry} from '../api/m1c_api_contract.js';
import type {
  AnnotationDraft,
  AnnotationVocabulary,
  AnnotationEvidence,
  AnnotationClaim,
} from '../api/annotation_contract.js';
import {aiWorkflowCommand, aiError} from '../api/ai_workflow_client.js';
import {AnnotationVocabularyEditor} from './annotation_vocabulary_editor.js';
import './entry_annotation_panel.css';

import {
  annotationStatusLabels,
  readingStateLabels,
} from './annotation_labels.js';
const emptyDraft = (): AnnotationDraft => ({
  status: 'unknown',
  note: '',
  readingState: 'unread',
  labels: [],
  claims: [],
});
const draftOf = (entry: InformationEntry): AnnotationDraft => {
  const a = entry.value.annotations;
  return a
    ? {
        status: a.status,
        note: a.note,
        readingState: a.readingState,
        labels: a.labels,
        claims: a.claims,
      }
    : emptyDraft();
};
export function EntryAnnotationPanel({
  entryId,
  includePrivate,
  onSaved,
}: {
  entryId: string;
  includePrivate: boolean;
  onSaved: () => void;
}) {
  const [entry, setEntry] = useState<InformationEntry>();
  const [vocabulary, setVocabulary] = useState<AnnotationVocabulary>();
  const [draft, setDraft] = useState<AnnotationDraft>(emptyDraft);
  const [tab, setTab] = useState('entry');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dimensionId, setDimensionId] = useState('');
  const [termId, setTermId] = useState('');
  const [label, setLabel] = useState('');
  const [meaning, setMeaning] = useState('');
  const [wording, setWording] = useState('');
  const [quote, setQuote] = useState('');
  const [primary, setPrimary] = useState(true);
  const [editing, setEditing] = useState<number>();
  const [claim, setClaim] = useState<Omit<AnnotationClaim, 'evidence'>>({
    statement: '',
    speaker: '',
    stance: 'reports',
    conditions: '',
    time: '',
  });
  const [claimQuote, setClaimQuote] = useState('');
  const [editingClaim, setEditingClaim] = useState<number>();
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (e) {
      setError(aiError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    void aiWorkflowCommand<{
      entry: InformationEntry;
      vocabulary: AnnotationVocabulary;
    }>('entry_annotations_read', {entryId, includePrivate})
      .then((r) => {
        if (live) {
          setEntry(r.entry);
          setVocabulary(r.vocabulary);
          setDraft(draftOf(r.entry));
        }
      })
      .catch((e: unknown) => {
        if (live) setError(aiError(e));
      });
    return () => {
      live = false;
    };
  }, [entryId, includePrivate, reload]);
  function evidence(text: string): AnnotationEvidence | undefined {
    const body = entry?.value.body ?? '';
    const index = body.indexOf(text);
    if (!text.trim() || index < 0 || body.includes(text, index + 1)) {
      setError('请粘贴本条正文中一处完整、可定位的原句。');
      return;
    }
    const start = Array.from(body.slice(0, index)).length;
    return {start, end: start + Array.from(text).length, quote: text};
  }
  if (!entry || !vocabulary)
    return (
      <div className="annotation-editor">
        <p role="status">{error || '正在读取标注…'}</p>
        {error && (
          <button
            className="secondary-action"
            onClick={() => {
              setError('');
              setReload(reload + 1);
            }}
          >
            重新读取
          </button>
        )}
      </div>
    );
  const saveVocabulary = () =>
    action(async () => {
      const r = await aiWorkflowCommand<{vocabulary: AnnotationVocabulary}>(
        'annotation_vocabulary_save',
        {expectedRevision: vocabulary.revision, vocabulary},
      );
      setVocabulary(r.vocabulary);
      setMessage('词表已保存。');
    });
  return (
    <div className="annotation-editor">
      <p className="annotation-editor__subject">{entry.value.titlePath}</p>
      <div
        className="annotation-editor__row"
        role="group"
        aria-label="标注编辑范围"
      >
        <button
          className="secondary-action"
          aria-pressed={tab === 'entry'}
          onClick={() => {
            setTab('entry');
          }}
        >
          本条标注
        </button>
        <button
          className="secondary-action"
          aria-pressed={tab === 'vocabulary'}
          onClick={() => {
            setTab('vocabulary');
          }}
        >
          词表设置
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {tab === 'vocabulary' ? (
        <AnnotationVocabularyEditor
          value={vocabulary}
          onChange={setVocabulary}
          onSave={() => void saveVocabulary()}
          busy={busy}
        />
      ) : (
        <>
          <fieldset disabled={busy}>
            <legend>标注状态</legend>
            <div className="annotation-editor__grid">
              <label>
                标注结果
                <select
                  value={draft.status}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      status: e.target.value as AnnotationDraft['status'],
                    });
                  }}
                >
                  {(['complete', 'partial', 'unknown', 'none'] as const).map(
                    (v) => (
                      <option key={v} value={v}>
                        {annotationStatusLabels[v]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                阅读状态
                <select
                  value={draft.readingState}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      readingState: e.target
                        .value as AnnotationDraft['readingState'],
                    });
                  }}
                >
                  {Object.entries(readingStateLabels).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              备注
              <input
                type="text"
                value={draft.note}
                maxLength={400}
                onChange={(e) => {
                  setDraft({...draft, note: e.target.value});
                }}
              />
            </label>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>分类与标签</legend>
            {!vocabulary.dimensions.length && (
              <p>先在“词表设置”选择标注维度。</p>
            )}
            {draft.labels.map((l, i) => (
              <article className="annotation-editor__item" key={l.term.id}>
                <strong>
                  {
                    vocabulary.dimensions.find((d) => d.id === l.dimensionId)
                      ?.name
                  }{' '}
                  · {l.term.label}
                  {l.primary ? ' · 主要' : ''}
                </strong>
                <p>{l.term.meaning}</p>
                <blockquote>{l.evidence.quote}</blockquote>
                <div className="annotation-editor__row">
                  <button
                    className="text-action"
                    onClick={() => {
                      setEditing(i);
                      setDimensionId(l.dimensionId);
                      setTermId(
                        vocabulary.terms.some((t) => t.id === l.term.id)
                          ? l.term.id
                          : '',
                      );
                      setLabel(l.term.label);
                      setMeaning(l.term.meaning);
                      setWording(l.wording);
                      setQuote(l.evidence.quote);
                      setPrimary(l.primary);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="text-action"
                    onClick={() => {
                      setDraft({
                        ...draft,
                        labels: draft.labels.filter((_, j) => j !== i),
                      });
                      setEditing(undefined);
                    }}
                  >
                    移除
                  </button>
                  {!entry.value.isPrivate &&
                    !vocabulary.terms.some((t) => t.id === l.term.id) && (
                      <button
                        className="text-action"
                        onClick={() => {
                          setVocabulary({
                            ...vocabulary,
                            terms: [...vocabulary.terms, l.term],
                          });
                          setTab('vocabulary');
                        }}
                      >
                        加入词表草稿
                      </button>
                    )}
                </div>
              </article>
            ))}
            <div className="annotation-editor__grid">
              <label>
                标注维度
                <select
                  value={dimensionId}
                  onChange={(e) => {
                    setDimensionId(e.target.value);
                    setTermId('');
                  }}
                >
                  <option value="">选择维度</option>
                  {vocabulary.dimensions
                    .filter((d) => d.enabled)
                    .map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                词条
                <select
                  value={termId}
                  onChange={(e) => {
                    setTermId(e.target.value);
                    const t = vocabulary.terms.find(
                      (t) => t.id === e.target.value,
                    );
                    if (t) {
                      setLabel(t.label);
                      setMeaning(t.meaning);
                    }
                  }}
                >
                  <option value="">本条新词条</option>
                  {vocabulary.terms
                    .filter((t) => t.dimensionId === dimensionId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} · {t.meaning}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                标签名称
                <input
                  type="text"
                  value={label}
                  readOnly={!!termId}
                  maxLength={120}
                  onChange={(e) => {
                    setLabel(e.target.value);
                  }}
                />
              </label>
              <label>
                具体含义
                <input
                  type="text"
                  value={meaning}
                  readOnly={!!termId}
                  maxLength={400}
                  onChange={(e) => {
                    setMeaning(e.target.value);
                  }}
                />
              </label>
            </div>
            <label>
              原文中的称呼
              <input
                type="text"
                value={wording}
                maxLength={120}
                onChange={(e) => {
                  setWording(e.target.value);
                }}
                placeholder="可留空，采用标签名称"
              />
            </label>
            <label>
              正文依据
              <textarea
                value={quote}
                maxLength={2000}
                rows={3}
                onChange={(e) => {
                  setQuote(e.target.value);
                }}
                placeholder="粘贴本条正文中支持此标注的原句"
              />
            </label>
            <label className="annotation-editor__row">
              <input
                type="checkbox"
                checked={primary}
                onChange={(e) => {
                  setPrimary(e.target.checked);
                }}
              />
              主要归属
            </label>
            <button
              className="secondary-action"
              disabled={!dimensionId || !label.trim() || !quote.trim()}
              onClick={() => {
                const e = evidence(quote);
                if (!e) return;
                setError('');
                const previous =
                  editing === undefined ? undefined : draft.labels[editing];
                const term = vocabulary.terms.find((t) => t.id === termId) ?? {
                  id:
                    previous?.term.label === label &&
                    previous.term.meaning === meaning &&
                    previous.dimensionId === dimensionId
                      ? previous.term.id
                      : crypto.randomUUID(),
                  dimensionId,
                  label: label.trim(),
                  meaning: meaning.trim(),
                };
                const next = {
                  dimensionId,
                  term,
                  wording: wording.trim() || label.trim(),
                  primary,
                  evidence: e,
                };
                setDraft({
                  ...draft,
                  status: 'complete',
                  labels:
                    editing === undefined
                      ? [...draft.labels, next]
                      : draft.labels.map((l, i) => (i === editing ? next : l)),
                });
                setEditing(undefined);
                setQuote('');
                setLabel('');
                setMeaning('');
                setWording('');
                setTermId('');
              }}
            >
              {editing === undefined ? '添加到本条' : '更新本条标签'}
            </button>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>明确观点</legend>
            {draft.claims.map((c, i) => (
              <article className="annotation-editor__item" key={i}>
                <strong>{c.statement}</strong>
                <p>
                  {c.speaker || '提出者未知'} ·{' '}
                  {c.stance === 'supports'
                    ? '赞同'
                    : c.stance === 'opposes'
                      ? '反对'
                      : '转述'}
                </p>
                <blockquote>{c.evidence.quote}</blockquote>
                <button
                  className="text-action"
                  onClick={() => {
                    setClaim({
                      statement: c.statement,
                      speaker: c.speaker,
                      stance: c.stance,
                      conditions: c.conditions,
                      time: c.time,
                    });
                    setClaimQuote(c.evidence.quote);
                    setEditingClaim(i);
                  }}
                >
                  编辑
                </button>
                <button
                  className="text-action"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      claims: draft.claims.filter((_, j) => j !== i),
                    });
                    setEditingClaim(undefined);
                  }}
                >
                  移除
                </button>
              </article>
            ))}
            <label>
              主张
              <textarea
                rows={2}
                value={claim.statement}
                maxLength={800}
                onChange={(e) => {
                  setClaim({...claim, statement: e.target.value});
                }}
              />
            </label>
            <div className="annotation-editor__grid">
              <label>
                提出者
                <input
                  type="text"
                  value={claim.speaker}
                  maxLength={160}
                  onChange={(e) => {
                    setClaim({...claim, speaker: e.target.value});
                  }}
                />
              </label>
              <label>
                立场
                <select
                  value={claim.stance}
                  onChange={(e) => {
                    setClaim({
                      ...claim,
                      stance: e.target.value as AnnotationClaim['stance'],
                    });
                  }}
                >
                  <option value="reports">转述</option>
                  <option value="supports">赞同</option>
                  <option value="opposes">反对</option>
                </select>
              </label>
              <label>
                条件
                <input
                  type="text"
                  value={claim.conditions}
                  maxLength={400}
                  onChange={(e) => {
                    setClaim({...claim, conditions: e.target.value});
                  }}
                />
              </label>
              <label>
                时间
                <input
                  type="text"
                  value={claim.time}
                  maxLength={160}
                  onChange={(e) => {
                    setClaim({...claim, time: e.target.value});
                  }}
                />
              </label>
            </div>
            <label>
              观点原句
              <textarea
                rows={3}
                value={claimQuote}
                maxLength={2000}
                onChange={(e) => {
                  setClaimQuote(e.target.value);
                }}
              />
            </label>
            <button
              className="secondary-action"
              disabled={!claim.statement.trim() || !claimQuote.trim()}
              onClick={() => {
                const e = evidence(claimQuote);
                if (!e) return;
                setDraft({
                  ...draft,
                  status: 'complete',
                  claims:
                    editingClaim === undefined
                      ? [...draft.claims, {...claim, evidence: e}]
                      : draft.claims.map((c, i) =>
                          i === editingClaim ? {...claim, evidence: e} : c,
                        ),
                });
                setClaim({
                  statement: '',
                  speaker: '',
                  stance: 'reports',
                  conditions: '',
                  time: '',
                });
                setClaimQuote('');
                setEditingClaim(undefined);
              }}
            >
              {editingClaim === undefined ? '添加观点' : '更新本条观点'}
            </button>
          </fieldset>
          <p>
            保存后是草稿，确认文档后用于分类查询。AI
            重新标注会保留这里的人工修改。
          </p>
          <div className="annotation-editor__row">
            <button
              className="primary-action"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const r = await aiWorkflowCommand<{status: string}>(
                    'entry_annotations_save',
                    {
                      entryId,
                      includePrivate,
                      expectedRevision: entry.revision,
                      vocabularyRevision: vocabulary.revision,
                      annotation: draft,
                    },
                  );
                  if (r.status === 'applied')
                    setEntry({...entry, revision: entry.revision + 1});
                  setMessage('标注草稿已保存，请确认文档。');
                  onSaved();
                })
              }
            >
              保存标注草稿
            </button>
            <button
              className="secondary-action"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const r = await aiWorkflowCommand<{
                    entry: InformationEntry;
                    vocabulary: AnnotationVocabulary;
                  }>('entry_annotations_read', {entryId, includePrivate});
                  setEntry(r.entry);
                  setVocabulary(r.vocabulary);
                  setDraft(draftOf(r.entry));
                  setMessage('已重新读取。');
                })
              }
            >
              放弃草稿并重读
            </button>
          </div>
        </>
      )}
    </div>
  );
}
