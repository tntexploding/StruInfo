import {escape as e} from './store.js';

const templateNames = {
  whole: '整篇保留',
  numbered: '独立编号',
  headings: '同级标题',
  directory: '链接条目',
};
const statusNames = {
  draft: '草稿',
  trial: '已试读',
  enabled: '使用中',
  paused: '已暂停',
  replaced: '已替代',
};
const reasonNames = {
  recipe_ai_required: '结构已检查，切点由 AI 生成',
  recipe_ready: '结构符合',
  recipe_not_configured: '该格式还没有模板',
  recipe_low_match: '匹配分不足',
  recipe_match_ambiguous: '两个模板过于接近',
  recipe_format_mismatch: '边界格式不同',
  recipe_number_sequence_changed: '编号顺序变化',
  recipe_entry_count_changed: '条目数超出范围',
  recipe_body_too_short: '条目缺少正文',
  recipe_unclosed_code: '代码块未闭合',
  recipe_entry_capacity: '超过条目上限',
  recipe_title_mismatch: '栏目标题不符',
};
const reason = (value) => reasonNames[value] || value;
const verdicts = {
  good: '切分合适',
  boundary: '切点错误',
  title: '标题不符',
  context: '上下文归属错误',
};
const numeric = (label, name, value, min, max, step = 1) =>
  `<label class="setting-field"><span>${label}</span><input type="number" data-recipe-value="${name}" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;

/** This panel owns only source templates; the page owns its shared dialog. */
export function sourceRecipePanel({
  root,
  sourceId,
  state,
  ingestion,
  saveSettings,
  notify,
}) {
  let catalog,
    samples,
    draft,
    results = [],
    replaces,
    saved = false,
    openedResult;
  const definitionOf = (recipe) =>
    Object.fromEntries(
      Object.entries(recipe).filter(
        ([key]) => !['status', 'trials', 'approval', 'replaces'].includes(key),
      ),
    );
  const includePrivate = state.privacy === 'private';
  const read = () => ingestion('split_source_read', {sourceId, includePrivate});
  const value = (name) =>
    root.querySelector(`[data-recipe-value="${name}"]`)?.value;
  function render() {
    const p = catalog.policy;
    root.innerHTML = `<div class="source-recipes">
      <details class="recipe-policy"><summary>采样与匹配设置</summary><div class="dialog-form">
        ${numeric('每种格式取样', 'samplesPerFormat', p.samplesPerFormat, 2, 12)}${numeric('单源扫描上限', 'sampleLimit', p.sampleLimit, 2, 96)}
        ${numeric('模板放行线', 'minimumScore', p.minimumScore, 1, 100)}${numeric('候选最低分差', 'minimumMargin', p.minimumMargin, 1, 100)}
        ${numeric('观察最近篇数', 'reviewWindow', p.reviewWindow, 5, 100)}${numeric('复核问题占比（%）', 'lowScoreRate', Math.round(p.lowScoreRate * 100), 1, 100)}
      </div><div class="panel-footer"><button class="compact-button" data-recipe-action="policy">保存设置</button></div></details>
      ${catalog.feedback
        .filter((f) => f.needsReview)
        .map(
          (f) =>
            `<div class="recipe-warning"><p>${e(templateNames[f.format?.split(':')[0]] || '新格式')} · 最近 ${f.count} 篇，结构异常 ${f.low} 篇，人工标记 ${f.qualityIssues} 篇。</p>${f.recipeId ? `<button class="compact-button" data-recipe-action="revise" data-id="${f.recipeId}" data-format="${e(f.format)}" ${includePrivate ? 'disabled' : ''}>用异常样本生成修订</button>` : `<button class="compact-button" data-recipe-action="revise" data-format="${e(f.format)}" ${includePrivate ? 'disabled' : ''}>校准此格式</button>`}</div>`,
        )
        .join('')}
      <div class="field-heading"><h3>来源模板</h3><button class="compact-button" data-recipe-action="sample">按格式取样</button></div>
      <div class="recipe-list">${
        catalog.recipes
          .filter((r) => r.status !== 'replaced')
          .map(
            (r) =>
              `<button class="compact-button" data-recipe-action="edit" data-id="${r.recipeId}">${e(r.name)} <small>${statusNames[r.status]} · v${r.revision}</small></button>`,
          )
          .join('') || '<p>尚无模板。先接收少量文档，再按格式取样。</p>'
      }</div>
      ${samples ? `<div class="recipe-samples"><p>已扫描 ${samples.scanned} / ${samples.available} 篇；取样上限 ${p.sampleLimit} 篇。</p>${samples.groups.map((g, i) => `<section><div class="field-heading"><strong>${e(templateNames[g.format.split(':')[0]] || g.format)} · ${g.samples.length} 篇</strong><button class="compact-button ai-button" data-recipe-action="suggest" data-index="${i}" ${!g.ready || includePrivate ? 'disabled' : ''}>校准并试读</button></div><ul>${g.samples.map((s) => `<li>${e(s.title)} <small>${e(s.capturedAt.slice(0, 10))}</small></li>`).join('')}</ul>${!g.ready ? '<p>该格式样本不足，继续接收后再取样。</p>' : ''}</section>`).join('')}${samples.skipped.length ? `<p>${samples.skipped.length} 篇超出预览容量，未参与取样。</p>` : ''}</div>` : ''}
      ${
        catalog.recent?.length
          ? `<details><summary>最近匹配与质量反馈</summary>${catalog.recent
              .map(
                (o, i) =>
                  `<div class="recipe-review"><a href="#/reading?doc=${o.snapshotId}">${e(o.title || '查看文档')}</a><small>结构 ${o.score} 分 · ${e(reason(o.reason))}</small><div class="history-toolbar"><select aria-label="拆分质量" data-verdict="${i}">${Object.entries(
                    verdicts,
                  )
                    .map(
                      ([v, label]) =>
                        `<option value="${v}" ${o.quality === v ? 'selected' : ''}>${label}</option>`,
                    )
                    .join(
                      '',
                    )}</select><button class="compact-button" data-recipe-action="feedback" data-index="${i}" ${!o.recipeId ? 'disabled' : ''}>记录评价</button>${o.quality ? `<small>已记 · ${verdicts[o.quality]}</small>` : ''}</div></div>`,
              )
              .join('')}</details>`
          : ''
      }
      ${draft ? editor() : ''}
    </div>`;
  }
  function editor() {
    const s = draft.settings;
    const verifiedFormat = catalog.feedback.find(
      (f) =>
        f.recipeId === draft.recipeId &&
        f.count >= catalog.policy.samplesPerFormat,
    )?.format;
    return `<section class="recipe-editor"><h3>处理方法</h3><div class="dialog-form">
      <label class="setting-field"><span>模板名称</span><input data-recipe-value="name" value="${e(draft.name)}" maxlength="80" required></label>
      <label class="setting-field"><span>执行方式</span><select data-recipe-value="execution"><option value="rule" ${draft.execution !== 'ai' ? 'selected' : ''}>规则拆分</option><option value="ai" ${draft.execution === 'ai' ? 'selected' : ''}>AI 判断切点</option></select></label>
      <label class="setting-field span-all"><span>方法说明</span><textarea data-recipe-value="method" rows="3" maxlength="2000" placeholder="描述切点和上下文的处理方式">${e(draft.method || '')}</textarea></label>
      <label class="setting-field"><span>基础模板</span><select data-recipe-value="template">${Object.entries(
        templateNames,
      )
        .map(
          ([k, n]) =>
            `<option value="${k}" ${s.template === k ? 'selected' : ''}>${n}</option>`,
        )
        .join('')}</select></label>
      ${numeric('标题层级', 'headingLevel', s.headingLevel, 1, 6)}${numeric('最少条目', 'minimumEntries', s.minimumEntries, 1, 64)}${numeric('最多条目', 'maximumEntries', s.maximumEntries, 1, 64)}${numeric('条目最少正文字符', 'minimumBodyCharacters', s.minimumBodyCharacters, 0, 2000)}
      <label class="setting-field"><span>编号重置</span><select data-recipe-value="allowNumberReset"><option value="false">连续编号</option><option value="true" ${s.allowNumberReset ? 'selected' : ''}>允许从 1 重新编号</option></select></label>
      <label class="setting-field"><span>低匹配时</span><select data-recipe-value="onMismatch"><option value="ai" ${s.onMismatch === 'ai' ? 'selected' : ''}>AI 单独评价</option><option value="review" ${s.onMismatch === 'review' ? 'selected' : ''}>留待人工核对</option></select></label>
      <label class="setting-field"><span>附录标题（每行一个）</span><textarea data-recipe-value="appendixHeadings" rows="2">${e(s.appendixHeadings.join('\n'))}</textarea></label>
    </div><details><summary>匹配条件与栏目标题</summary><label class="setting-field"><span>栏目标题条件（每行一个）</span><textarea data-recipe-value="titleIncludes" rows="2">${e(s.titleIncludes.join('\n'))}</textarea></label><label class="setting-field"><span>结构条件与放行线</span><textarea data-recipe-value="match" rows="7" spellcheck="false">${e(JSON.stringify(draft.match || {}, null, 2))}</textarea></label></details>
    <div class="panel-footer"><span>最后一篇用于独立检查。${draft.execution === 'ai' ? '试读检查结构，实际切点在文档任务中生成。' : '核对切点后启用。'}</span><button class="compact-button" data-recipe-action="trial">保存并试读</button><button class="compact-button primary" data-recipe-action="enable" ${!saved ? 'disabled' : ''}>确认启用</button>${draft.status === 'enabled' ? '<button class="compact-button" data-recipe-action="pause">暂停模板</button>' : ''}</div>
    ${draft.status === 'enabled' && draft.execution === 'ai' && verifiedFormat ? `<button class="compact-button" data-recipe-action="verify-rule" data-id="${draft.recipeId}" data-format="${e(verifiedFormat)}">比对已发布切点，提取规则</button>` : ''}
    <div class="recipe-results">${results.map(resultMarkup).join('')}</div></section>`;
  }
  function resultMarkup(r, i) {
    const ai = (r.plan?.reason || r.reason) === 'recipe_ai_required';
    const count = ai
      ? ''
      : ` · ${r.plan?.groups.length ?? r.entryCount ?? 0} 条`;
    const plan = !r.plan
      ? ''
      : ai
        ? '<p>结构检查已通过。文档任务会调用 AI 生成实际切点。</p>'
        : `<p>原文覆盖：${r.plan.completeCoverage ? '完整' : '未通过'}。范围按 Unicode 字符计数。</p><ol>${r.plan.groups.map((g) => `<li><strong>${e(g.title)}</strong><small>${g.start}–${g.end}</small></li>`).join('')}</ol>`;
    return `<details ${openedResult === i ? 'open' : ''}><summary>${r.heldOut ? '独立检查' : `样本 ${i + 1}`} · 结构 ${r.score ?? '—'} 分${count} · ${e(reason(r.plan?.reason || r.reason))}</summary><label class="setting-field"><span>预期结果</span><select data-sample-expected="${r.snapshotId}"><option value="ready" ${r.expected !== 'review' ? 'selected' : ''}>可以按模板处理</option><option value="review" ${r.expected === 'review' ? 'selected' : ''}>应单独评价</option></select></label><button class="text-action" data-recipe-action="preview" data-index="${i}">${draft.execution === 'ai' ? '检查结构' : '查看切点'}</button>${plan}</details>`;
  }
  function collect() {
    if (!draft) return;
    const invalid = [...root.querySelectorAll('.recipe-editor input')].find(
      (i) => !i.checkValidity(),
    );
    if (invalid) {
      invalid.reportValidity();
      throw new Error('请检查模板参数');
    }
    draft.name = value('name').trim();
    draft.method = value('method');
    draft.execution = value('execution');
    draft.settings = {
      ...draft.settings,
      template: value('template'),
      onMismatch: value('onMismatch'),
      allowNumberReset: value('allowNumberReset') === 'true',
      ...Object.fromEntries(
        [
          'headingLevel',
          'minimumEntries',
          'maximumEntries',
          'minimumBodyCharacters',
        ].map((k) => [k, Number(value(k))]),
      ),
      appendixHeadings: value('appendixHeadings')
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
      titleIncludes: value('titleIncludes')
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
    };
    const match = JSON.parse(value('match'));
    if (match.conditions) draft.match = match;
    else delete draft.match;
    results.forEach((r) => {
      r.expected =
        root.querySelector(`[data-sample-expected="${r.snapshotId}"]`)?.value ||
        r.expected ||
        'ready';
    });
  }
  async function action(button) {
    const action = button.dataset.recipeAction;
    if (!action) return false;
    button.disabled = true;
    try {
      if (action === 'policy') {
        const invalid = [...root.querySelectorAll('.recipe-policy input')].find(
          (i) => !i.checkValidity(),
        );
        if (invalid) {
          invalid.reportValidity();
          return true;
        }
        const policy = Object.fromEntries(
          Object.keys(catalog.policy).map((key) => [key, Number(value(key))]),
        );
        policy.lowScoreRate /= 100;
        if (policy.sampleLimit < policy.samplesPerFormat)
          throw new Error('扫描上限应至少覆盖一组样本');
        await saveSettings(policy);
        catalog = await read();
        samples = undefined;
        render();
        notify('匹配设置已保存');
      }
      if (action === 'sample') {
        samples = await ingestion('split_source_sample', {
          sourceId,
          includePrivate,
        });
        render();
      }
      if (action === 'feedback') {
        const index = Number(button.dataset.index),
          observed = catalog.recent[index];
        await ingestion('split_source_feedback', {
          sourceId,
          includePrivate,
          snapshotId: observed.snapshotId,
          recipeId: observed.recipeId,
          recipeRevision: observed.recipeRevision,
          quality: root.querySelector(`[data-verdict="${index}"]`).value,
        });
        catalog = await read();
        render();
        notify('已记录本篇拆分评价');
      }
      if (['suggest', 'revise', 'verify-rule'].includes(action)) {
        const format =
          button.dataset.format ||
          samples.groups[Number(button.dataset.index)].format;
        const out = await ingestion('split_source_calibrate', {
          sourceId,
          format,
          includePrivate,
          expectedRevision: catalog.revision,
          ...(button.dataset.id ? {recipeId: button.dataset.id} : {}),
          ruleOnly: action === 'verify-rule',
        });
        catalog = await read();
        draft = structuredClone(
          catalog.recipes.find((r) => r.recipeId === out.definition.recipeId),
        );
        results = out.results;
        replaces = out.replaces;
        saved = true;
        openedResult = undefined;
        render();
        notify(
          out.replaces
            ? '修订已试读，确认启用后替代旧版'
            : '新模板已试读，请核对后启用',
        );
      }
      if (action === 'edit') {
        const existing = catalog.recipes.find(
          (r) => r.recipeId === button.dataset.id,
        );
        draft = structuredClone(existing);
        results = existing.trials.map((t, i, all) => ({
          ...t,
          heldOut: i === all.length - 1,
        }));
        replaces = existing.replaces || undefined;
        saved = true;
        openedResult = undefined;
        render();
      }
      if (action === 'preview') {
        collect();
        const index = Number(button.dataset.index),
          item = results[index];
        const definition = definitionOf(draft);
        const out = await ingestion('split_recipe_preview', {
          snapshotId: item.snapshotId,
          includePrivate,
          definition,
        });
        results[index] = {...item, score: out.score, plan: out};
        openedResult = index;
        render();
      }
      if (action === 'trial') {
        collect();
        if (!results.length) throw new Error('先按格式取样并生成模板');
        if (draft.status === 'enabled' || draft.status === 'replaced') {
          replaces = draft.recipeId;
          draft.recipeId = crypto.randomUUID();
          draft.revision = 1;
        } else if (catalog.recipes.some((r) => r.recipeId === draft.recipeId))
          draft.revision += 1;
        const definition = definitionOf(draft);
        catalog = {
          ...catalog,
          ...(await ingestion('split_recipe_save', {
            snapshotId: results[0].snapshotId,
            includePrivate,
            expectedRevision: catalog.revision,
            definition,
            ...(replaces ? {replaces} : {}),
          })),
        };
        saved = false;
        draft = catalog.recipes.find((r) => r.recipeId === definition.recipeId);
        const checks = results.map((r, i) => ({
          snapshotId: r.snapshotId,
          sampleKind:
            r.heldOut || i === results.length - 1 ? 'variant' : 'typical',
          expected: r.expected || 'ready',
        }));
        const out = await ingestion('split_recipe_trial', {
          ...checks[0],
          samples: checks.slice(1),
          recipeId: draft.recipeId,
          expectedRevision: catalog.revision,
          includePrivate,
        });
        results = out.results.map((r, i) => ({
          ...r,
          expected: checks[i].expected,
          heldOut: i === checks.length - 1,
        }));
        catalog = await read();
        draft = catalog.recipes.find((r) => r.recipeId === definition.recipeId);
        saved = true;
        render();
        notify('试读已保存，请核对结果');
      }
      if (action === 'enable' || action === 'pause') {
        if (!saved) throw new Error('修改后请重新试读');
        await ingestion('split_recipe_control', {
          snapshotId: results[0].snapshotId,
          includePrivate,
          recipeId: draft.recipeId,
          expectedRevision: catalog.revision,
          action: action === 'enable' ? 'enable' : 'pause',
          note:
            action === 'enable'
              ? draft.execution === 'ai'
                ? '已核对处理方法和结构试读；实际切点由 AI 文档任务生成。'
                : '已核对样本切点、上下文和附录归属。'
              : '',
        });
        catalog = await read();
        draft = catalog.recipes.find((r) => r.recipeId === draft.recipeId);
        render();
        notify(action === 'enable' ? '模板已启用，用于新任务' : '模板已暂停');
      }
    } finally {
      button.disabled = false;
    }
    return true;
  }
  return {
    load: async () => {
      catalog = await read();
      render();
    },
    action,
    changed: (target) => {
      if (target.closest('.recipe-editor')) {
        saved = false;
        const button = root.querySelector('[data-recipe-action="enable"]');
        if (button) button.disabled = true;
      }
    },
  };
}
