import {escape as e, icon} from '../../data.js';
import {switchInput} from '../../shared/switch.js';
export const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const ident = (k) => 'setting-' + k.replaceAll('.', '-');
export function row(title, control, note = '', key = '') {
  return `<div class="setting-row"><div class="setting-row-title"><label ${key ? 'for="' + ident(key) + '"' : ''}>${title}</label>${note ? '<small>' + note + '</small>' : ''}</div><div class="setting-control">${control}</div></div>`;
}
export function toggle(d, key, title, note = '', disabled = false) {
  return row(
    title,
    switchInput({
      id: ident(key),
      data: {bind: key},
      checked: get(d, key),
      disabled,
    }),
    note,
    key,
  );
}
export function number(d, key, title, min, max, unit = '', note = '') {
  return row(
    title,
    `<input type="number" required id="${ident(key)}" data-bind="${key}" value="${get(d, key)}" min="${min}" max="${max}" step="1">${unit ? '<span class="control-unit">' + unit + '</span>' : ''}`,
    note,
    key,
  );
}
export function select(d, key, title, options, note = '') {
  return row(
    title,
    `<select id="${ident(key)}" data-bind="${key}">${options.map(([v, t]) => '<option value="' + v + '" ' + (String(get(d, key)) === String(v) ? 'selected' : '') + '>' + t + '</option>').join('')}</select>`,
    note,
    key,
  );
}
export function range(d, key, title, min, max, step, unit = '', note = '') {
  return `<div class="setting-row"><div class="setting-row-title"><label for="${ident(key)}">${title}</label>${note ? '<small>' + note + '</small>' : ''}</div><div class="setting-control range-control"><input id="${ident(key)}" type="range" data-bind="${key}" min="${min}" max="${max}" step="${step}" value="${get(d, key)}"><output for="${ident(key)}" data-output="${key}" data-unit="${unit}">${get(d, key)}${unit}</output></div></div>`;
}
export function openRow(title, id, button, detail = '') {
  return row(
    title,
    `<button type="button" class="secondary-action" data-open="${id}" aria-haspopup="dialog">${button} ${icon('chevron')}</button>`,
    detail,
  );
}
export function card(title, body, cls = '', aside = '') {
  return `<section class="setting-card ${cls}"><header><h3>${title}</h3>${aside ? '<span>' + aside + '</span>' : ''}</header>${body}</section>`;
}
export function field(title, name, value, type = 'text', extra = '') {
  return `<label class="dialog-field"><span>${title}</span><input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
}
export function boundField(d, key, title, type = 'text', extra = '') {
  return `<label class="dialog-field"><span>${title}</span><input data-bind="${key}" type="${type}" value="${e(get(d, key))}" ${extra}></label>`;
}
export function textarea(d, key, title, note = '') {
  return `<label class="dialog-field wide"><span>${title}</span><textarea data-bind="${key}" rows="3" maxlength="1600">${e(get(d, key))}</textarea>${note ? '<small>' + note + '</small>' : ''}</label>`;
}
export function page(id, d) {
  if (id === 'appearance')
    return [
      card(
        '页面外观',
        select(d, 'theme', '配色', [
          ['dark', '深色'],
          ['light', '浅色'],
          ['system', '跟随系统'],
        ]) +
          range(d, 'glow', '发光强度', 0, 100, 5, '%', '用于按钮和处理流程。') +
          toggle(d, 'glass', '悬浮窗透明效果'),
        'appearance-card',
      ),
      card(
        '动画',
        toggle(d, 'motion', '界面动画') +
          toggle(d, 'flowMotion', '工作流光束', '随阶段完成播放。', !d.motion),
        'effects-card',
      ),
      card(
        '正文',
        range(d, 'readingSize', '字号', 18, 26, 1, ' px') +
          range(d, 'readingMeasure', '行宽', 48, 110, 2, ' 字符'),
        'reading-card',
      ),
      `<section class="setting-card settings-preview" aria-label="显示效果预览"><div class="preview-copy"><small>显示预览</small><h4>阅读与整理</h4><p>保留原文，查看段落和标签。调整字号与行宽，找到合适的阅读方式。</p></div><div class="preview-controls ef-glass"><button type="button" class="primary-action" data-preview>查看效果</button><button type="button" class="icon-action" data-open="preview" aria-label="预览悬浮窗" aria-haspopup="dialog">${icon('settings')}</button></div></section>`,
    ].join('');
  if (id === 'ai')
    return [
      card(
        '运行控制',
        toggle(
          d,
          'operationsAllowed',
          '允许 AI 运行',
          '关闭后不再发起新请求，在途请求继续完成。',
        ) +
          toggle(
            d,
            'backgroundPaused',
            '暂停后台队列',
            '文档、主题和报告等待执行。系统助手仍可响应。',
          ) +
          number(d, 'maxConcurrentRequests', '模型并发', 1, 4, '个') +
          number(
            d,
            'automaticRetryLimit',
            '失败后自动重试',
            0,
            2,
            '次',
            '新任务使用此次数，从已保存的进度继续。',
          ),
        'ai-card',
      ),
      card(
        '调用时段',
        toggle(
          d,
          'priceEnabled',
          '仅在低价时段调用',
          'DeepSeek 任务等待服务端配置的可用时段。',
        ) +
          toggle(
            d,
            'assistantPriceRestricted',
            '助手也遵守低价时段',
            '关闭后可随时理解指令。助手启动的整理和报告仍遵守各自的时段与额度。',
          ) +
          openRow('当前时间规则', 'price', '查看规则'),
        'ai-card',
      ),
      card(
        '模型接入',
        `<div class="connection-summary"><span class="connection-glyph">${icon('bolt')}</span><div><strong>${e(d.connection || '读取中')}</strong><small>配置保存在服务端。</small></div><button type="button" class="secondary-action" data-open="connection" aria-haspopup="dialog">接入说明 ${icon('chevron')}</button></div><div class="connections-list"><span><i></i>拆分</span><span><i></i>标签</span><span><i></i>联系</span><span><i></i>翻译</span><span><i></i>问答</span></div>`,
        'full-width',
      ),
    ].join('');
  if (id === 'automation')
    return [
      card(
        '新资料',
        toggle(d, 'enabled', '自动处理新资料') +
          toggle(d, 'paused', '暂停处理，继续收件') +
          openRow(
            '处理范围',
            'scope',
            '选择来源',
            `已选 ${d.subscriptionIds.length} 个来源${d.manualUploads ? ' · 包含手动导入' : ''}。`,
          ),
        'ai-card',
      ),
      card(
        '审核与用量',
        toggle(
          d,
          'review',
          '接收前检查内容',
          '检查完整性和内容类型，待定资料交给人工审核。',
        ) +
          openRow(
            '内容选择',
            'intake',
            '编辑条件',
            '获取全文，选择拦截类型和关注话题。',
          ) +
          number(
            d,
            'maxDocumentsPerDay',
            '每日新文档上限',
            1,
            100,
            '篇',
            '按 UTC 日期计数。',
          ) +
          openRow(
            '单篇处理上限',
            'limits',
            '调整上限',
            `最多 ${d.maxEntries} 个条目 · ${d.maxModelCalls} 次请求。`,
          ),
        'ai-card',
      ),
      card(
        '本地处理规则',
        openRow('手动拆分', 'manual-split', '设置规则'),
        'full-width',
      ),
      `<p class="settings-section-note full-width">来源的接收时间、拆分方案和附加提示词在 <a class="section-link" href="..#/sources">源管理 ${icon('arrow')}</a> 中调整。</p>`,
    ].join('');
  if (id === 'vocabulary')
    return [
      card(
        '结构化词表',
        openRow(
          '标注维度',
          'dimensions',
          '管理维度',
          `${d.dimensions.length} 个维度。`,
        ) +
          openRow(
            '规范词条',
            'terms',
            '管理词条',
            `${d.terms.length} 个词条。`,
          ),
      ),
      card(
        '别名与关系',
        openRow(
          '同义词与翻译',
          'aliases',
          '管理别名',
          `${d.aliases.length} 条别名，确认后用于查询。`,
        ) +
          openRow(
            '词条间的关系',
            'term-relations',
            '编辑关系',
            '记录等同、上位和相关关系。',
          ),
      ),
      card(
        '本地建议',
        openRow(
          '快捷标签与关键词',
          'keywords',
          '编辑规则',
          '控制本地标签建议使用的词。',
        ) +
          openRow('原有标签的别名', 'local-aliases', '编辑对应词') +
          openRow(
            '相似联系',
            'weights',
            '调整权重',
            '按内容、类型和领域生成本地推荐。',
          ) +
          openRow('探索推荐', 'exploration', '调整推荐'),
        'full-width',
      ),
    ].join('');
  if (id === 'network')
    return [
      card(
        '联网搜索',
        toggle(
          d,
          'enabled',
          '允许联网搜索',
          '问答和报告可以使用 DeepSeek 搜索。',
        ) +
          number(d, 'dailyRequests', '每日请求上限', 1, 200, '次') +
          number(d, 'resultLimit', '每次搜索结果', 1, 8, '条') +
          toggle(d, 'fetchMissing', '获取缺少的网页正文'),
      ),
      card(
        '站内通知',
        toggle(d, 'notices.enabled', '生成站内消息') +
          openRow(
            '通知范围',
            'notice-scope',
            '编辑条件',
            `${d.notices.sources.trim() ? '已设置来源范围' : '全部来源'} · ${d.notices.urgentTerms.trim() ? '已设置紧急关键词' : '未设置紧急关键词'}。`,
          ) +
          openRow(
            '通知间隔与免打扰',
            'notice-time',
            '调整时间',
            `通知至少间隔 ${d.notices.intervalMinutes} 分钟 · ${e(d.notices.quietFrom)}—${e(d.notices.quietTo)} 免打扰。`,
          ),
      ),
      `<p class="settings-section-note full-width">报告时间和发布方式在 <a class="section-link" href="..#/database">数据库 ${icon('arrow')}</a> 中设置。外部推送尚未接入。</p>`,
    ].join('');
  return [
    card(
      '个人数据',
      openRow(
        '完整备份',
        'backup',
        '导出数据',
        '包含原文、条目、标签、联系和个人设置。',
      ) +
        openRow(
          '恢复备份',
          'restore',
          '恢复数据',
          '恢复到同一工作区的空数据库。',
        ),
      'full-width',
    ),
    card(
      '当前工作区',
      `<div class="settings-data-pair"><span>服务连接</span><strong>${e(d.connected ? '已连接' : '未连接')}</strong></div><div class="settings-data-pair"><span>工作区</span><strong>${e(d.workspaceId || '—')}</strong></div><div class="settings-data-pair"><span>数据位置</span><strong>由服务器配置</strong></div>`,
    ),
    card(
      '外部 Agent',
      `<p>外部 Agent 通过 MCP 访问项目。权限和令牌由服务器配置。</p><div class="setting-row"><span class="settings-inline-status">${d.agentEnabled ? '已启用' : '未启用'}</span><button type="button" class="secondary-action" data-open="agent" aria-haspopup="dialog">接入说明 ${icon('chevron')}</button></div>`,
    ),
    `<p class="settings-section-note full-width">浏览器中的字号与光效单独保存。</p>`,
  ].join('');
}
