import {field, options} from './sample-ui.js';
export const annotationFields = () =>
  field(
    '标注维度',
    '<select name="dimensionId" disabled><option value="">暂无维度</option></select>',
  ) +
  field(
    '词条',
    '<select name="termId" disabled><option value="">暂无词条</option></select>',
  );
export function reportForm() {
  return (
    '<form id="report-form" class="dialog-form">' +
    '<div class="form-grid">' +
    field(
      '报告类型',
      '<select name="kind">' +
        options([
          ['daily', '日报'],
          ['weekly', '周报'],
          ['monthly', '月报'],
          ['topic', '专题'],
        ]) +
        '</select>',
    ) +
    field(
      '生成方式',
      '<select name="composition"><option value="ai">AI 总结</option><option value="collection">原文摘录</option></select>',
    ) +
    field(
      '选材方式',
      '<select name="selection"><option value="conditions">按条件选材</option><option value="selected" disabled>勾选的资料 · 暂未选择</option></select>',
    ) +
    field(
      '报告条目上限',
      '<select name="maxItems">' +
        options([
          [6, '6 条'],
          [12, '12 条'],
          [20, '20 条'],
          [40, '40 条'],
          [80, '80 条'],
          [0, '不限'],
        ]) +
        '</select>',
    ) +
    '<label class="sample-field" id="report-date-field"><span id="report-date-label">报告日期</span><input name="date" type="date" required></label>' +
    field(
      '日期依据',
      '<select name="timeField"><option value="received">接收日期</option><option value="published">发布日期</option></select>',
    ) +
    '</div><p class="field-note" id="report-period-note"></p>' +
    '<details class="nested-options"><summary>选材范围<span data-icon="chevron"></span></summary><div class="filter-fields"><div class="form-grid">' +
    field(
      '关键词',
      '<input name="topics" maxlength="1000" placeholder="多个词用逗号分隔">',
    ) +
    field(
      '来源',
      '<input name="sources" maxlength="1000" placeholder="来源名称或域名">',
    ) +
    field(
      '已有主题',
      '<select name="topicIds" disabled><option value="">暂无主题</option></select>',
    ) +
    field('时区', '<input name="timeZone" maxlength="80" required>') +
    annotationFields() +
    '</div><p class="field-note">报告条目上限控制成稿篇幅，每次最多选取 512 条材料。</p></div></details>' +
    '<p class="form-status" id="report-preview-status" role="status" hidden></p>' +
    '<footer class="form-footer"><button class="secondary-action compact-action" type="submit">预览材料</button><button class="primary-action compact-action" id="report-generate" type="button" disabled>确认生成</button></footer></form>'
  );
}
export function scheduleForm() {
  return (
    '<form id="schedule-form" class="dialog-form"><div class="form-grid">' +
    field(
      '计划名称',
      '<input name="name" maxlength="100" required placeholder="给这项计划命名">',
      true,
    ) +
    field(
      '生成周期',
      '<select name="cadence">' +
        options([
          ['daily', '每天'],
          ['weekly', '每周一'],
          ['monthly', '每月 1 日'],
        ]) +
        '</select>',
    ) +
    field('执行时间', '<input name="localTime" type="time" required>') +
    field('时区', '<input name="timeZone" maxlength="80" required>') +
    field(
      '错过执行时间',
      '<select name="missed"><option value="once">补最近一期</option><option value="skip">超时 1 小时后跳过</option></select>',
    ) +
    '</div><p class="field-note" id="schedule-period-note"></p>' +
    '<details class="nested-options"><summary>报告内容<span data-icon="chevron"></span></summary><div class="filter-fields"><div class="form-grid">' +
    field(
      '生成方式',
      '<select name="composition"><option value="ai">AI 总结</option><option value="collection">原文摘录</option></select>',
    ) +
    field(
      '报告条目上限',
      '<select name="maxItems">' +
        options([
          [6, '6 条'],
          [12, '12 条'],
          [20, '20 条'],
          [40, '40 条'],
          [80, '80 条'],
          [0, '不限'],
        ]) +
        '</select>',
    ) +
    field(
      '关键词',
      '<input name="topics" maxlength="1000" placeholder="可留空">',
    ) +
    field(
      '来源',
      '<input name="sources" maxlength="1000" placeholder="来源名称或域名">',
    ) +
    field(
      '日期依据',
      '<select name="timeField"><option value="received">接收日期</option><option value="published">发布日期</option></select>',
    ) +
    field(
      '已有主题',
      '<select name="topicIds" disabled><option value="">暂无主题</option></select>',
    ) +
    annotationFields() +
    '</div></div></details>' +
    '<div class="inline-checks"><label><input type="checkbox" name="enabled">启用计划</label><label><input type="checkbox" name="publish">生成后发布到站内</label></div>' +
    '<p class="field-note">AI 生成沿用已有预算和价格时段。默认不启用计划。</p>' +
    '<footer class="form-footer"><button class="primary-action compact-action" type="submit">保存计划</button></footer></form>'
  );
}
