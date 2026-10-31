import {connectionMarkup, recipeMarkup, historyMarkup} from './forms.js';
export const panels = {
  connection: {
    title: '接收参数',
    parent: '接收设置',
    content: connectionMarkup,
  },
  recipe: {title: '完整拆分方案', parent: 'AI 设置', content: recipeMarkup},
  history: {title: '往期补收', parent: '特殊设置', content: historyMarkup},
  selector: {
    title: '筛选与排序',
    parent: '来源选择',
    content: () =>
      `<div class="dialog-form"><label class="setting-field"><span>接入类型</span><select id="filter-kind"><option value="all">全部类型</option><option value="rss">RSS / Atom</option><option value="web">网页</option><option value="git">Git 文件</option><option value="json">JSON API</option><option value="plugin">连接插件</option></select></label><label class="setting-field"><span>排序</span><select id="filter-sort"><option value="name">名称</option><option value="active">启用优先</option></select></label></div><footer class="panel-footer"><button class="compact-button primary" data-action="filter">应用</button></footer>`,
  },
};
