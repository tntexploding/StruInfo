import {useState} from 'react';
import type {
  AnnotationDimension,
  AnnotationVocabulary,
} from '../api/annotation_contract.js';

import {annotationRoles} from './annotation_labels.js';
export function AnnotationVocabularyEditor({
  value,
  onChange,
  onSave,
  busy,
}: {
  value: AnnotationVocabulary;
  onChange: (value: AnnotationVocabulary) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<AnnotationDimension['role']>('custom');
  const [dimensionId, setDimensionId] = useState('');
  const [termLabel, setTermLabel] = useState('');
  const [meaning, setMeaning] = useState('');
  const [termId, setTermId] = useState('');
  const [alias, setAlias] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'equivalent' | 'broader' | 'related'>(
    'related',
  );
  const termOptions = value.terms.map((t) => (
    <option key={t.id} value={t.id}>
      {t.label}
      {t.meaning ? ` · ${t.meaning}` : ''}
    </option>
  ));
  return (
    <div className="annotation-editor">
      <p>
        词表用于公开文章的 AI 标注和分类查询。名称相同、含义不同的词条分别保存。
      </p>
      <fieldset disabled={busy}>
        <legend>标注维度</legend>
        {!value.dimensions.length && (
          <button
            className="secondary-action"
            onClick={() => {
              onChange({
                ...value,
                dimensions: Object.entries(annotationRoles)
                  .filter(([r]) => r !== 'custom')
                  .map(([r, n]) => ({
                    id: crypto.randomUUID(),
                    name: n,
                    role: r as AnnotationDimension['role'],
                    description: '',
                    enabled: true,
                  })),
              });
            }}
          >
            使用六个起始维度
          </button>
        )}
        {value.dimensions.map((d, i) => (
          <div className="annotation-editor__row" key={d.id}>
            <label>
              <input
                type="checkbox"
                checked={d.enabled}
                onChange={(e) => {
                  onChange({
                    ...value,
                    dimensions: value.dimensions.map((x, j) =>
                      j === i ? {...x, enabled: e.target.checked} : x,
                    ),
                  });
                }}
              />
              {d.name} · {annotationRoles[d.role]}
            </label>
            <input
              type="text"
              aria-label={`${d.name}说明`}
              value={d.description}
              placeholder="说明这个维度记录什么"
              maxLength={400}
              onChange={(e) => {
                onChange({
                  ...value,
                  dimensions: value.dimensions.map((x, j) =>
                    j === i ? {...x, description: e.target.value} : x,
                  ),
                });
              }}
            />
          </div>
        ))}
        <div className="annotation-editor__grid">
          <label>
            维度名称
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={120}
            />
          </label>
          <label>
            维度用途
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as typeof role);
              }}
            >
              {Object.entries(annotationRoles).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="secondary-action"
          disabled={!name.trim()}
          onClick={() => {
            onChange({
              ...value,
              dimensions: [
                ...value.dimensions,
                {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  role,
                  description: '',
                  enabled: true,
                },
              ],
            });
            setName('');
          }}
        >
          添加维度
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>词条</legend>
        <p>
          已有 {value.terms.length}{' '}
          个词条。可从本条标注保存词条，也可在这里添加。
        </p>
        <div className="annotation-editor__grid">
          <label>
            词条维度
            <select
              value={dimensionId}
              onChange={(e) => {
                setDimensionId(e.target.value);
              }}
            >
              <option value="">选择维度</option>
              {value.dimensions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            词条名称
            <input
              type="text"
              value={termLabel}
              maxLength={120}
              onChange={(e) => {
                setTermLabel(e.target.value);
              }}
            />
          </label>
        </div>
        <label>
          词条含义
          <input
            type="text"
            value={meaning}
            maxLength={400}
            onChange={(e) => {
              setMeaning(e.target.value);
            }}
            placeholder="用于区分同名对象"
          />
        </label>
        <button
          className="secondary-action"
          disabled={!dimensionId || !termLabel.trim()}
          onClick={() => {
            onChange({
              ...value,
              terms: [
                ...value.terms,
                {
                  id: crypto.randomUUID(),
                  dimensionId,
                  label: termLabel.trim(),
                  meaning: meaning.trim(),
                },
              ],
            });
            setTermLabel('');
            setMeaning('');
          }}
        >
          添加词条
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>别名与词条关系</legend>
        <label>
          选择词条
          <select
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value);
            }}
          >
            <option value="">选择词条</option>
            {termOptions}
          </select>
        </label>
        <label>
          别名或译名
          <input
            type="text"
            value={alias}
            maxLength={120}
            onChange={(e) => {
              setAlias(e.target.value);
            }}
          />
        </label>
        <button
          className="secondary-action"
          disabled={!termId || !alias.trim()}
          onClick={() => {
            onChange({
              ...value,
              aliases: [
                ...value.aliases,
                {termId, text: alias.trim(), status: 'pending'},
              ],
            });
            setAlias('');
          }}
        >
          添加待确认别名
        </button>
        {value.aliases
          .filter((a) => a.termId === termId)
          .map((a, i) => (
            <label key={i} className="annotation-editor__row">
              <input
                type="checkbox"
                checked={a.status === 'confirmed'}
                onChange={(e) => {
                  onChange({
                    ...value,
                    aliases: value.aliases.map((x) =>
                      x === a
                        ? {
                            ...x,
                            status: e.target.checked ? 'confirmed' : 'pending',
                          }
                        : x,
                    ),
                  });
                }}
              />
              确认“{a.text}”指同一个词条
            </label>
          ))}
        <div className="annotation-editor__grid">
          <label>
            另一个词条
            <select
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
            >
              <option value="">选择词条</option>
              {termOptions}
            </select>
          </label>
          <label>
            词条关系
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
              }}
            >
              <option value="related">相关</option>
              <option value="broader">当前词条是上位词</option>
              <option value="equivalent">同一含义</option>
            </select>
          </label>
        </div>
        <button
          className="secondary-action"
          disabled={!termId || !to || termId === to}
          onClick={() => {
            onChange({
              ...value,
              relations: [
                ...value.relations,
                {from: termId, to, kind, status: 'pending'},
              ],
            });
          }}
        >
          添加待确认关系
        </button>
        {value.relations
          .filter((r) => r.from === termId)
          .map((r, i) => (
            <label className="annotation-editor__row" key={i}>
              <input
                type="checkbox"
                checked={r.status === 'confirmed'}
                onChange={(e) => {
                  onChange({
                    ...value,
                    relations: value.relations.map((x) =>
                      x === r
                        ? {
                            ...x,
                            status: e.target.checked ? 'confirmed' : 'pending',
                          }
                        : x,
                    ),
                  });
                }}
              />
              确认
              {r.kind === 'equivalent'
                ? '同义'
                : r.kind === 'broader'
                  ? '上位'
                  : '相关'}
              ：{value.terms.find((t) => t.id === r.to)?.label}
            </label>
          ))}
        <p>只有确认的别名和同义关系用于同义检索。上位词和相关词分别保留。</p>
      </fieldset>
      <button className="primary-action" disabled={busy} onClick={onSave}>
        保存词表设置
      </button>
    </div>
  );
}
