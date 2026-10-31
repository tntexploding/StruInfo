import {escape as e, kinds, field, select, toggle, sources} from './store.js';

export function settingsMarkup(s) {
  return `
  <div class="common-settings">
    <section class="category basic-settings" aria-labelledby="basic-title">
      <header><h3 id="basic-title">基础设置</h3><span class="section-index">01</span></header>
      <div class="basic-grid">
        ${field('来源名称', 'name', s.name, 'maxlength="80"', 'name-field')}
        <label class="setting-field color-field"><span>来源颜色</span><input aria-label="来源颜色" type="color" data-field="accent" value="${s.accent}"></label>
        ${select('接入类型', 'kind', kinds, s.kind)}
        ${select('文档隐私', 'privacy', {public: '公开', private: '私密'}, s.privacy)}
        ${field('来源优先级', 'priority', s.priority, 'type="number" min="0" max="100" step="1"')}
        <div class="description-field"><div class="field-heading"><label for="source-description">来源简介</label><button class="text-action" data-action="description">AI 生成</button></div><textarea id="source-description" data-field="description" rows="2" maxlength="500" placeholder="内容范围和文章形式">${e(s.description)}</textarea></div>
      </div>
    </section>
    <section class="category receiving-settings" aria-labelledby="receiving-title">
      <header><h3 id="receiving-title">接收设置</h3>${toggle('自动检查', 'enabled', s.enabled)}</header>
      <div class="receiving-grid">
        ${select('检查方式', 'mode', {once: '收取一次', interval: '按间隔', window: '按日期与时段'}, s.mode)}
        <label class="setting-field interval-field"><span>检查间隔</span><span class="unit-input"><input aria-label="检查间隔" type="number" min="15" max="10080" data-field="interval" value="${s.interval}"><span>分钟</span></span></label>
        <div class="schedule-field" ${s.mode === 'window' ? '' : 'hidden'}><span class="field-label">检查日期</span><div class="weekdays" role="group" aria-label="每周检查日期">${['日', '一', '二', '三', '四', '五', '六'].map((day, i) => `<button type="button" aria-label="星期${day}" aria-pressed="${s.weekdays.includes(i)}" data-weekday="${i}">${day}</button>`).join('')}</div><div class="time-window"><label>从 <input aria-label="检查开始时间" type="time" data-field="start" value="${s.start}"></label><label>至 <input aria-label="检查结束时间" type="time" data-field="end" value="${s.end}"></label></div></div>
        ${field('失败重试次数', 'retries', s.retries, 'type="number" min="0" max="5" step="1"', 'retry-field')}
        <div class="parameter-field"><div class="field-heading"><span>接收参数</span><button class="text-action" data-panel="connection" aria-haspopup="dialog">编辑参数 <span data-icon="arrow"></span></button></div><div class="connection-summary"><span id="connection-kind">${kinds[s.kind]}</span><span id="connection-address">${e(s.connection.url || '地址待填写')}</span></div></div>
      </div>
    </section>
  </div>
  <section class="category ai-settings" aria-labelledby="ai-title">
    <header><div class="ai-heading"><span data-icon="spark"></span><h3 id="ai-title">AI 设置</h3></div>${toggle('AI 自动处理', 'ai', s.ai)}</header>
    <div class="ai-fields">
      <div class="prompt-field split-field"><div class="field-heading"><label for="split-text">拆分方案</label><div class="inline-actions"><button class="text-action" data-action="generate-plan">AI 生成</button><button class="text-action" data-panel="recipe" aria-haspopup="dialog">完整方案 <span data-icon="expand"></span></button></div></div><textarea id="split-text" data-field="split" rows="3" placeholder="AI 生成后可直接修改">${e(s.split)}</textarea></div>
      <label class="setting-field prompt-field"><span>标签要求</span><textarea data-field="tags" rows="3" placeholder="补充标签要求">${e(s.tags)}</textarea></label>
      <label class="setting-field prompt-field"><span>联系要求</span><textarea data-field="relations" rows="3" placeholder="补充联系要求">${e(s.relations)}</textarea></label>
    </div>
  </section>
  <section class="special-settings" aria-labelledby="special-title"><h3 id="special-title">特殊设置</h3><button class="compact-button" data-panel="history" aria-haspopup="dialog"><span data-icon="history"></span>往期补收 <span data-icon="arrow"></span></button></section>`;
}

const input = (label, key, value = '', attrs = '') =>
  `<label class="setting-field"><span>${label}</span><input data-connection="${key}" value="${e(value)}" ${attrs}></label>`;
export function connectionMarkup(s) {
  const c = s.connection;
  let fields = '';
  if (s.kind === 'rss')
    fields = input(
      '订阅地址',
      'url',
      c.url,
      'type="url" placeholder="https://example.invalid/feed"',
    );
  if (s.kind === 'git')
    fields =
      input(
        '仓库地址',
        'url',
        c.url,
        'type="url" placeholder="https://github.com/…"',
      ) +
      input('分支', 'ref', c.ref || 'main') +
      input('文件路径', 'path', c.path, 'placeholder="docs/article.md"');
  if (s.kind === 'web')
    fields =
      input(
        '页面地址',
        'url',
        c.url,
        'type="url" placeholder="https://example.invalid/articles"',
      ) +
      `<label class="setting-field span-all"><span>补充页面地址</span><textarea data-connection="paths" rows="3" placeholder="每行一个地址">${e(c.paths)}</textarea></label>`;
  if (s.kind === 'plugin')
    fields =
      input(
        '连接组件',
        'component',
        c.component,
        'placeholder="已安装的组件"',
      ) + input('组件配置', 'profile', c.profile, 'placeholder="配置名称"');
  if (s.kind === 'json')
    fields =
      input(
        '接口地址',
        'url',
        c.url,
        'type="url" placeholder="https://example.invalid/api"',
      ) +
      ['记录列表', '文章标识', '标题', '正文', '原文链接', '发布时间', '版本']
        .map((label, i) =>
          input(
            label,
            [
              'records',
              'id',
              'title',
              'body',
              'canonical',
              'published',
              'version',
            ][i],
            c[
              [
                'records',
                'id',
                'title',
                'body',
                'canonical',
                'published',
                'version',
              ][i]
            ],
          ),
        )
        .join('') +
      `<h3 class="form-separator">分页与增量</h3>` +
      ['分页请求参数', '分页响应字段', '增量请求参数', '增量响应字段']
        .map((label, i) =>
          input(
            label,
            ['pageParam', 'pagePath', 'sinceParam', 'sincePath'][i],
            c[['pageParam', 'pagePath', 'sinceParam', 'sincePath'][i]],
          ),
        )
        .join('') +
      `<h3 class="form-separator">鉴权</h3><label class="setting-field"><span>方式</span><select data-connection="auth"><option value="none">无</option><option value="bearer" ${c.auth === 'bearer' ? 'selected' : ''}>Bearer</option></select></label>` +
      input(
        '密钥环境变量名',
        'credential',
        c.credential,
        'placeholder="使用外部密钥配置"',
      );
  return `<p class="panel-context">${kinds[s.kind]}</p><div class="dialog-form">${fields}</div><footer class="panel-footer"><button class="compact-button" data-close>取消</button><button class="compact-button primary" data-action="save-connection">保存参数</button></footer>`;
}
export function recipeMarkup(s) {
  return `<div class="recipe-editor"><label class="setting-field"><span>方案说明</span><textarea id="recipe-text" rows="5" placeholder="描述这个来源的拆分方式">${e(s.split)}</textarea></label><label class="setting-field"><span>具体规则</span><textarea id="recipe-rules" rows="6" placeholder="由 AI 生成，可直接修改">${e(s.rules)}</textarea></label></div><footer class="panel-footer"><span>保存后用于新任务</span><button class="compact-button" data-close>取消</button><button class="compact-button ai-button" data-action="save-recipe">保存方案</button></footer>`;
}
export function historyMarkup() {
  return `<div class="history-form"><fieldset class="source-checks"><legend>来源范围</legend>${sources.map((s) => `<label><input type="checkbox" name="history-source" value="${s.id}">${e(s.name)}</label>`).join('')}</fieldset><div class="dialog-form"><label class="setting-field"><span>开始日期</span><input type="date" id="history-from"></label><label class="setting-field"><span>结束日期</span><input type="date" id="history-to"></label><label class="setting-field"><span>关键词</span><input type="search" id="history-query" placeholder="可留空"></label><label class="setting-field"><span>每个来源的数量上限</span><input type="number" min="1" max="5000" value="100" id="history-limit"></label><label class="setting-field span-all"><span>补充目录地址</span><input type="url" data-archive placeholder="当前来源的历史目录地址"></label></div><div id="history-results" class="history-results" hidden></div><footer class="history-steps"><button class="compact-button" data-action="history-search">查询选定时间段</button><span data-icon="arrow"></span><button class="compact-button primary" id="history-add" data-action="history-add" disabled>加入待审核队列</button></footer></div>`;
}
export function manualMarkup() {
  return `<section class="category manual-editor"><header><h3>手动放入</h3><button class="text-action" data-mode="source">返回来源设置</button></header><div class="manual-tabs glass-group ef-glass"><button data-manual="text" aria-pressed="true">粘贴文本</button><button data-manual="file" aria-pressed="false">上传文件</button></div><div class="dialog-form">${field('文档名称', 'manualTitle', '', 'placeholder="文档名称"')}${select('文档隐私', 'manualPrivacy', {public: '公开', private: '私密'}, 'public')}</div><label class="setting-field" id="paste-field"><span>正文</span><textarea rows="10" placeholder="粘贴需要接收的内容"></textarea></label><label class="file-drop" id="upload-field" hidden><span data-icon="file"></span><span>选择文档</span><small>Markdown · TXT · HTML · PDF</small><input type="file" multiple accept=".md,.txt,.html,.htm,.pdf"></label><footer class="panel-footer"><span id="manual-feedback"></span><button class="compact-button primary" data-action="manual-import">加入待审核队列</button></footer></section>`;
}
