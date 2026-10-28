import {useEffect, useRef, useState} from 'react';
import {aiError, aiWorkflowCommand} from '../api/ai_workflow_client.js';
import type {AnnotationVocabulary} from '../api/annotation_contract.js';
import {AnnotationVocabularyEditor} from './annotation_vocabulary_editor.js';

export function AnnotationSettings() {
  const [value, setValue] = useState<AnnotationVocabulary>();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    void aiWorkflowCommand<{vocabulary: AnnotationVocabulary}>(
      'annotation_vocabulary',
      {},
    )
      .then((r) => {
        if (live) setValue(r.vocabulary);
      })
      .catch((e: unknown) => {
        if (live) setMessage(aiError(e));
      });
    return () => {
      live = false;
    };
  }, [reload]);
  async function save() {
    if (!value || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const r = await aiWorkflowCommand<{vocabulary: AnnotationVocabulary}>(
        'annotation_vocabulary_save',
        {expectedRevision: value.revision, vocabulary: value},
      );
      setValue(r.vocabulary);
      setMessage('词表已保存。');
    } catch (e) {
      setMessage(aiError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="settings-group">
      <header>
        <h2>标注维度与词表</h2>
        <p>管理类型、领域、用途、主题词及确认过的别名。</p>
      </header>
      {value ? (
        <AnnotationVocabularyEditor
          value={value}
          onChange={setValue}
          onSave={() => void save()}
          busy={busy}
        />
      ) : (
        <button
          className="secondary-action"
          onClick={() => {
            setReload((v) => v + 1);
          }}
        >
          读取词表
        </button>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
