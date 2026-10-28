import {useEffect, useState} from 'react';
import type {
  AnnotationFilter,
  AnnotationVocabulary,
} from '../api/annotation_contract.js';
import {aiWorkflowCommand, aiError} from '../api/ai_workflow_client.js';
import {
  annotationStatusLabels,
  readingStateLabels,
} from './annotation_labels.js';

export function AnnotationSearchFields({
  value = {},
  onChange,
}: {
  value?: AnnotationFilter | undefined;
  onChange: (value: AnnotationFilter) => void;
}) {
  const [vocabulary, setVocabulary] = useState<AnnotationVocabulary>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void aiWorkflowCommand<{vocabulary: AnnotationVocabulary}>(
      'annotation_vocabulary',
      {},
    )
      .then((r) => {
        if (live) setVocabulary(r.vocabulary);
      })
      .catch((e: unknown) => {
        if (live) setError(aiError(e));
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <fieldset className="entry-text-search-options annotation-editor">
      <legend>结构化分类</legend>
      {error && <p role="status">{error}</p>}
      <div className="annotation-editor__grid">
        <label>
          标注维度
          <select
            value={value.dimensionId ?? ''}
            onChange={(e) => {
              const next = {...value};
              delete next.termIds;
              if (e.target.value) next.dimensionId = e.target.value;
              else delete next.dimensionId;
              onChange(next);
            }}
          >
            <option value="">全部维度</option>
            {vocabulary?.dimensions.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          词条
          <select
            value={value.termIds?.[0] ?? ''}
            onChange={(e) => {
              const next = {...value};
              if (e.target.value) next.termIds = [e.target.value];
              else delete next.termIds;
              onChange(next);
            }}
          >
            <option value="">全部词条</option>
            {vocabulary?.terms
              .filter(
                (t) =>
                  !value.dimensionId || t.dimensionId === value.dimensionId,
              )
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.label}
                  {t.meaning ? ` · ${t.meaning}` : ''}
                </option>
              ))}
          </select>
        </label>
        <label>
          标注状态
          <select
            value={value.status ?? ''}
            onChange={(e) => {
              const next = {...value};
              if (e.target.value)
                next.status = e.target.value as NonNullable<
                  AnnotationFilter['status']
                >;
              else delete next.status;
              onChange(next);
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(annotationStatusLabels).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          阅读进度
          <select
            value={value.readingState ?? ''}
            onChange={(e) => {
              const next = {...value};
              if (e.target.value)
                next.readingState = e.target.value as NonNullable<
                  AnnotationFilter['readingState']
                >;
              else delete next.readingState;
              onChange(next);
            }}
          >
            <option value="">全部进度</option>
            {Object.entries(readingStateLabels).map(([v, n]) => (
              <option value={v} key={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
