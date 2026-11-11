import {toggle, number, range, select, boundField} from './views.js';
export const settingSources = [];
export const extraDefaults = {
  automation: {
    split: {
      mode: 'one_section',
      minimumGroupCodePoints: 400,
      maximumGroupCodePoints: 4000,
      maximumFragmentsPerGroup: 8,
    },
  },
  vocabulary: {
    localAliases: [],
    exploration: {
      enabled: false,
      resultShare: 20,
      neighborExpansion: true,
      crossDomain: true,
      serendipity: true,
    },
  },
};
export const extraTitles = {
  'manual-split': '手动拆分默认规则',
  'local-aliases': '原有标签别名',
  exploration: '探索推荐',
};
export function extraDialog(id, d) {
  if (id === 'manual-split')
    return (
      '<p class="dialog-description">用于手动执行的本地拆分。来源专属的 AI 拆分方案在源管理中设置。</p>' +
      select(d, 'split.mode', '拆分方式', [
        ['one_section', '每节一条'],
        ['merge_short_adjacent', '合并相邻短段'],
      ]) +
      number(
        d,
        'split.minimumGroupCodePoints',
        '合并目标长度',
        1,
        200000,
        '字符',
      ) +
      number(
        d,
        'split.maximumGroupCodePoints',
        '每组最大长度',
        1,
        200000,
        '字符',
      ) +
      number(d, 'split.maximumFragmentsPerGroup', '每组最大片段数', 1, 64, '段')
    );
  if (id === 'local-aliases')
    return (
      '<p class="dialog-description">用于原有标签的同义查询。结构化标注的别名在“同义词与翻译”中维护。</p>' +
      d.localAliases
        .map(
          (a, i) =>
            '<div class="alias-row">' +
            boundField(
              d,
              'localAliases.' + i + '.source',
              '原有写法',
              'text',
              'required maxlength="120"',
            ) +
            boundField(
              d,
              'localAliases.' + i + '.canonical',
              '统一写法',
              'text',
              'required maxlength="120"',
            ) +
            '<button type="button" class="text-action" data-extra-remove="localAliases:' +
            i +
            '">删除</button></div>',
        )
        .join('') +
      '<button type="button" class="secondary-action" data-extra-add="local-alias">添加别名</button>'
    );
  if (id === 'exploration')
    return (
      '<p class="dialog-description">在搜索结果之外，推荐与当前条目有关的内容。</p>' +
      toggle(d, 'exploration.enabled', '显示探索推荐') +
      range(d, 'exploration.resultShare', '推荐比例', 0, 50, 1, '%') +
      toggle(d, 'exploration.neighborExpansion', '沿已有联系查找') +
      toggle(d, 'exploration.crossDomain', '包含跨领域内容') +
      toggle(d, 'exploration.serendipity', '包含其他相关内容')
    );
  return null;
}
export const normalizeIdentity = (s) =>
  s
    .trim()
    .normalize('NFC')
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .normalize('NFC');
export function extraValidation(id, d) {
  if (
    id === 'manual-split' &&
    d.split.minimumGroupCodePoints > d.split.maximumGroupCodePoints
  )
    return '最大长度不能小于合并目标长度。';

  if (id === 'local-aliases') {
    const ids = new Map();
    for (const a of d.localAliases) {
      a.source = a.source.trim().normalize('NFC');
      a.canonical = a.canonical.trim().normalize('NFC');
      const k = a.source.toLowerCase(),
        v = a.canonical.toLowerCase();
      if (!k || !v || k === v || ids.has(k))
        return '别名不能为空、重复或指向自身。';
      ids.set(k, v);
    }
    for (const k of ids.keys()) {
      const seen = new Set();
      let v = k;
      while (ids.has(v)) {
        if (seen.has(v)) return '别名之间不能循环指向。';
        seen.add(v);
        v = ids.get(v);
      }
    }
  }
  return '';
}
