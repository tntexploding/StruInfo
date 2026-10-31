import {escape as e} from '../../data.js';
import {roles} from './supported-settings.js';
import {extraTitles, extraDialog, settingSources} from './extra-settings.js';
import {toggle, number, range, boundField, field, textarea} from './views.js';
export const dialogTitles = {
  ...extraTitles,
  preview: '悬浮窗预览',
  price: '低价时段',
  connection: '模型接入',
  scope: '处理范围',
  intake: '内容选择',
  limits: '单篇处理上限',
  dimensions: '标注维度',
  terms: '规范词条',
  aliases: '同义词与翻译',
  'term-relations': '词条间的关系',
  keywords: '快捷标签与关键词',
  weights: '相似联系',
  'notice-scope': '通知范围',
  'notice-time': '通知间隔与免打扰',
  backup: '完整备份',
  restore: '恢复备份',
  agent: '外部 Agent',
};
export const readOnlyDialogs = [
  'preview',
  'price',
  'connection',
  'backup',
  'restore',
  'agent',
];
const option = (v, t, s) =>
  `<option value="${e(v)}" ${s === v ? 'selected' : ''}>${e(t)}</option>`;
const choice = (label, name, options, selected = '') =>
  `<label class="dialog-field"><span>${label}</span><select name="${name}" required>${options.map(([v, t]) => option(v, t, selected)).join('')}</select></label>`;
function vocabularyList(d, kind, locked) {
  const term = (id) => d.terms.find((t) => t.id === id)?.label || '未命名词条';
  const items = d[kind];
  const persisted = (id) => (locked?.[kind] || []).some((x) => x.id === id);
  if (!items.length)
    return (
      '<p class="empty-settings">暂无' +
      {dimensions: '维度', terms: '词条', aliases: '别名', relations: '关系'}[
        kind
      ] +
      '。</p>'
    );
  return (
    '<div class="vocabulary-list">' +
    items
      .map((x, i) => {
        const title =
          kind === 'dimensions'
            ? x.name
            : kind === 'terms'
              ? x.label
              : kind === 'aliases'
                ? x.text
                : term(x.from) + ' → ' + term(x.to);
        const subtitle =
          kind === 'dimensions'
            ? roles[x.role]
            : kind === 'terms'
              ? (d.dimensions.find((q) => q.id === x.dimensionId)?.name || '') +
                (x.meaning ? ' · ' + x.meaning : '')
              : kind === 'aliases'
                ? term(x.termId)
                : {equivalent: '等同', broader: '上位', related: '相关'}[
                    x.kind
                  ];
        return `<div class="vocabulary-item">${kind === 'dimensions' ? '<input type="checkbox" data-dimension-enabled="' + i + '" aria-label="启用' + e(x.name) + '" ' + (x.enabled ? 'checked' : '') + '>' : ''}<div>${kind === 'dimensions' ? '<label class="dialog-field"><span class="sr-only">维度名称</span><input data-bind="dimensions.' + i + '.name" value="' + e(x.name) + '" required maxlength="120"></label>' : '<strong>' + e(title) + '</strong>'}<small>${e(subtitle)}${x.status ? ' · ' + (x.status === 'confirmed' ? '已确认' : '待确认') : ''}</small>${kind === 'dimensions' ? '<label class="dialog-field"><span class="sr-only">维度说明</span><input data-bind="dimensions.' + i + '.description" value="' + e(x.description) + '" placeholder="维度说明（选填）" maxlength="400"></label>' : ''}</div>${x.status === 'pending' ? '<button type="button" class="text-action" data-confirm="' + kind + ':' + i + '">确认</button>' : ''}${['terms', 'dimensions'].includes(kind) && persisted(x.id) ? '<span class="row-description">已保存</span>' : '<button type="button" class="text-action" data-remove="' + kind + ':' + i + '" aria-label="删除' + e(title) + '">删除</button>'}</div>`;
      })
      .join('') +
    '</div>'
  );
}
export function dialogContent(id, d, locked) {
  const extra = extraDialog(id, d);
  if (extra !== null) return extra;
  if (id === 'preview')
    return '<p class="dialog-description">浮窗保留透明背景和柔和边缘。固定内容区保持实色。</p><div class="preview-copy"><h4>阅读与整理</h4><p>标签与联系帮助查找相关资料，原文保留完整上下文。</p></div>';
  if (id === 'price') return '';
  if (id === 'connection')
    return '<p class="dialog-description">模型和密钥在服务器上配置。保存配置后重启服务。</p><ol class="connection-instructions"><li>选择 DeepSeek 或 OpenAI，填写模型名称。<br><code>STRUIINFO_DEEPSEEK_MODEL</code><br><code>STRUIINFO_OPENAI_MODEL</code></li><li>通过外部密钥文件提供凭据。<br><code>DEEPSEEK_API_KEY_FILE</code><br><code>OPENAI_API_KEY_FILE</code></li><li>重启后，页面读取接入状态和可用功能。</li></ol><p class="settings-callout">语义检索的嵌入模型单独配置。密钥不在网页中保存。</p>';
  if (id === 'scope')
    return (
      '<p class="dialog-description">选择自动处理的新增公开资料。</p>' +
      toggle(d, 'manualUploads', '手动导入的文档') +
      '<div class="source-choices">' +
      settingSources
        .map(
          (s) =>
            `<label class="source-choice"><input type="checkbox" data-list="subscriptionIds" value="${s.id}" ${d.subscriptionIds.includes(s.id) ? 'checked' : ''}><span>${e(s.name)}</span><small>${e(s.kind || '')}</small></label>`,
        )
        .join('') +
      '</div>'
    );
  if (id === 'intake')
    return (
      toggle(
        d,
        'intake.fetchFullText',
        '获取网页全文',
        '保留订阅内容和网页原文。',
      ) +
      '<p class="dialog-description" style="margin-top:20px">选择需要拦截的内容类型。</p><div class="check-options">' +
      [
        ['event_notice', '活动预告'],
        ['promotion', '推广信息'],
        ['update_notice', '更新通知'],
        ['article', '文章'],
        ['research', '研究材料'],
        ['reference', '参考资料'],
        ['other', '其他'],
      ]
        .map(
          ([v, l]) =>
            `<label><input type="checkbox" data-list="intake.blockedKinds" value="${v}" ${d.intake.blockedKinds.includes(v) ? 'checked' : ''}>${l}</label>`,
        )
        .join('') +
      '</div><div class="dialog-fields" style="margin-top:24px">' +
      textarea(
        d,
        'intake.preferredTopics',
        '优先话题',
        '每行一个，留空不限定。',
      ) +
      textarea(d, 'intake.excludedTopics', '排除话题', '每行一个。') +
      '</div>'
    );
  if (id === 'limits')
    return (
      number(d, 'maxEntries', '每篇最多条目', 1, 64, '个') +
      number(d, 'maxModelCalls', '每篇模型请求', 1, 64, '次', '包括失败重试。')
    );
  if (id === 'dimensions')
    return (
      vocabularyList(d, 'dimensions', locked) +
      (!d.dimensions.length
        ? '<button type="button" class="secondary-action" data-add-defaults>使用六个起始维度</button>'
        : '') +
      '<div class="vocabulary-add"><h3>添加维度</h3><div class="dialog-fields">' +
      field('名称', 'dimension-name', '', 'text', 'maxlength="120"') +
      choice('用途', 'dimension-role', Object.entries(roles), 'custom') +
      field(
        '说明（选填）',
        'dimension-description',
        '',
        'text',
        'maxlength="400"',
      ) +
      '</div><button type="button" class="secondary-action" data-add="dimension">添加维度</button></div>'
    );
  if (id === 'terms')
    return (
      '<p class="dialog-description">已保存的词条保留名称和含义。新增写法请添加别名。</p>' +
      vocabularyList(d, 'terms', locked) +
      (d.dimensions.length
        ? '<div class="vocabulary-add"><h3>添加词条</h3><div class="dialog-fields">' +
          field('词条', 'term-label', '', 'text', 'maxlength="120"') +
          choice(
            '所属维度',
            'term-dimension',
            d.dimensions.map((x) => [x.id, x.name]),
          ) +
          field('含义', 'term-meaning', '', 'text', 'maxlength="400"') +
          '</div><button type="button" class="secondary-action" data-add="term">添加词条</button></div>'
        : '<p class="dialog-description">先添加标注维度，再建立词条。</p>')
    );
  if (id === 'aliases')
    return (
      vocabularyList(d, 'aliases', locked) +
      (d.terms.length
        ? '<div class="vocabulary-add"><h3>添加别名</h3><div class="dialog-fields">' +
          choice(
            '对应词条',
            'alias-term',
            d.terms.map((t) => [t.id, t.label]),
          ) +
          field('别名或译名', 'alias-text', '', 'text', 'maxlength="120"') +
          '</div><button type="button" class="secondary-action" data-add="alias">添加并确认</button></div>'
        : '<p class="dialog-description">先添加规范词条，再设置别名。</p>')
    );
  if (id === 'term-relations')
    return (
      vocabularyList(d, 'relations', locked) +
      (d.terms.length > 1
        ? '<div class="vocabulary-add"><h3>添加关系</h3><div class="dialog-fields">' +
          choice(
            '词条',
            'relation-from',
            d.terms.map((t) => [t.id, t.label]),
          ) +
          choice('关系类型', 'relation-kind', [
            ['related', '相关'],
            ['broader', '上位'],
            ['equivalent', '等同'],
          ]) +
          choice(
            '关联词条',
            'relation-to',
            d.terms.map((t) => [t.id, t.label]),
            d.terms[1].id,
          ) +
          '</div><button type="button" class="secondary-action" data-add="relation">添加并确认</button></div>'
        : '<p class="dialog-description">至少需要两个词条。</p>')
    );
  if (id === 'keywords')
    return (
      toggle(d, 'automaticKeywords', '生成本地关键词建议') +
      toggle(d, 'includeLinkDomains', '将链接域名作为关键词') +
      '<div class="dialog-fields" style="margin-top:22px">' +
      textarea(d, 'quickTags', '快捷标签', '每行一个，最多 24 个。') +
      textarea(d, 'excludedKeywords', '排除词', '每行一个，最多 64 个。') +
      '</div>'
    );
  if (id === 'weights')
    return (
      '<p class="dialog-description">用于本地相似推荐。前三项合计需为 100%。</p>' +
      range(d, 'weights.content', '内容相似度', 0, 100, 1, '%') +
      range(d, 'weights.type', '类型相似度', 0, 100, 1, '%') +
      range(d, 'weights.domain', '领域相似度', 0, 100, 1, '%') +
      range(d, 'weights.threshold', '最低相似度', 0, 100, 1, '%') +
      '<p id="weight-total" class="row-description"></p>'
    );
  if (id === 'notice-scope')
    return (
      '<div class="dialog-fields">' +
      textarea(
        d,
        'notices.sources',
        '来源筛选词',
        '匹配来源标识，每行一个。留空包括全部来源，最多 32 个。',
      ) +
      textarea(
        d,
        'notices.urgentTerms',
        '紧急关键词',
        '每行一个，最多 16 个。匹配后不受免打扰时段限制。',
      ) +
      '</div>'
    );
  if (id === 'notice-time')
    return (
      '<div class="dialog-fields">' +
      boundField(
        d,
        'notices.timeZone',
        '时区',
        'text',
        'required placeholder="Asia/Shanghai" maxlength="80"',
      ) +
      boundField(
        d,
        'notices.intervalMinutes',
        '通知间隔（分钟）',
        'number',
        'min="1" max="1440" step="1" required',
      ) +
      boundField(d, 'notices.quietFrom', '免打扰开始', 'time', 'required') +
      boundField(d, 'notices.quietTo', '免打扰结束', 'time', 'required') +
      '</div>'
    );
  if (id === 'backup')
    return '<p class="dialog-description">导出当前工作区的个人数据包，文件保存在服务端的数据目录。</p><div class="settings-data-pair"><span>包含内容</span><strong>原文、条目、标签、联系</strong></div><div class="settings-data-pair"><span>个人配置</span><strong>来源、处理规则等</strong></div><div class="settings-data-pair"><span>浏览器外观</span><strong>单独保存</strong></div><p class="settings-callout" style="margin-top:20px">导出后显示服务端文件名。</p>';
  if (id === 'restore')
    return '<p class="dialog-description">填写服务端已有的个人数据包文件名。恢复前会验证文件和工作区。</p><label class="dialog-field"><span>数据包文件名</span><input id="bundle-file" required placeholder="个人数据包文件名" autocomplete="off"></label><p class="settings-callout" style="margin-top:20px">仅支持同一工作区的空数据库。</p>';
  return '<p class="dialog-description">外部 Agent 使用 MCP 接口。身份、权限与令牌在服务器上配置。</p><div class="settings-data-pair"><span>身份</span><code>STRUIINFO_AGENT_ID</code></div><div class="settings-data-pair"><span>权限</span><code>STRUIINFO_AGENT_GRANTS</code></div><div class="settings-data-pair"><span>令牌文件</span><code>STRUIINFO_AGENT_TOKEN_FILE</code></div><p class="settings-callout" style="margin-top:20px">默认只读。写入权限需要在服务器上单独授权。</p>';
}
