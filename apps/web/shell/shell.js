import {icon, paintIcons} from '../data.js';
import {request, ingestion} from '../runtime/api.js';
import {notice} from '../shared/notice.js';
import {mountAssistant} from './assistant.js';
const links = [
  ['overview', '总览', 'overview'],
  ['sources', '源管理', 'sources'],
  ['reading', '文档阅读', 'file'],
  ['database', '数据库', 'database'],
];
export function mountShell() {
  const rail = document.querySelector('#primary-nav');
  rail.innerHTML =
    '<a class="identity" href="#/overview"><span class="si-mark">SI</span><span>StruInfo<small>个人知识库</small></span></a><nav aria-label="工作区">' +
    links
      .map(
        ([id, label, symbol]) =>
          '<a href="#/' +
          id +
          '" data-page="' +
          id +
          '">' +
          icon(symbol) +
          '<span>' +
          label +
          '</span></a>',
      )
      .join('') +
    '</nav><div class="rail-bottom"><button id="connection-status" class="rail-system"><span class="status-dot"></span><span>正在连接</span></button><button id="system-assistant" class="rail-setting" type="button">' +
    icon('bolt') +
    '<span>系统助手</span></button><a href="#/settings" class="rail-setting" data-page="settings">' +
    icon('settings') +
    '<span>设置</span></a></div>';
  mountAssistant(document.querySelector('#system-assistant'));
  document.querySelector('#page-menu').onclick = () => {
    const open = rail.classList.toggle('expanded');
    document
      .querySelector('#page-menu')
      .setAttribute('aria-expanded', String(open));
  };
  rail.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      rail.classList.remove('expanded');
      document
        .querySelector('#page-menu')
        .setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      rail.classList.remove('expanded');
      document
        .querySelector('#page-menu')
        .setAttribute('aria-expanded', 'false');
    }
  });
  let status,
    checking = false,
    timer;
  const button = document.querySelector('#connection-status');
  const refresh = async () => {
    clearTimeout(timer);
    if (document.hidden || checking) return;
    checking = true;
    const results = await Promise.allSettled([
      request('/health/ready'),
      request('workspace'),
      ingestion('system_status'),
    ]);
    status = results;
    checking = false;
    const ready = results.every((r) => r.status === 'fulfilled');
    button.innerHTML =
      '<span class="status-dot ' +
      (ready ? 'good' : 'bad') +
      '"></span><span>' +
      (ready ? '系统已连接' : '连接异常') +
      '</span>';
    timer = setTimeout(refresh, 30000);
  };
  button.onclick = () => {
    void refresh();
    notice(
      status?.every((r) => r.status === 'fulfilled')
        ? '工作区已连接，服务可用。AI 运行状态在总览查看。'
        : '连接未就绪。正在重新读取。',
      {
        kind: status?.every((r) => r.status === 'fulfilled')
          ? 'success'
          : 'error',
      },
    );
  };
  document.addEventListener('visibilitychange', () =>
    document.hidden ? clearTimeout(timer) : void refresh(),
  );
  void refresh();
  paintIcons(rail);
}
export function selectPage(id, title) {
  document
    .querySelectorAll('[data-page]')
    .forEach((a) =>
      a.dataset.page === id
        ? a.setAttribute('aria-current', 'page')
        : a.removeAttribute('aria-current'),
    );
  document.querySelector('#compact-page-name').textContent = title;
}
