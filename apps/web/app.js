import './styles/fonts.css';
import './styles/base.css';
import './styles/tokens.css';
import './styles/material.css';
import './styles/controls.css';
import './shell/shell.css';
import './pages/overview/page.css';
import './pages/sources/page.css';
import './pages/reading/page.css';
import './pages/database/page.css';
import './pages/settings/page.css';
import {mountShell, selectPage} from './shell/shell.js';
import {pageContext, routeParams} from './runtime/route.js';
import {
  initializeEnvironment,
  applyAppearance,
  localAppearance,
} from './runtime/environment.js';
import {regionState} from './shared/region.js';
import {notice} from './shared/notice.js';
import {paintIcons} from './data.js';
import overview from './pages/overview/view.html?raw';
import sources from './pages/sources/view.html?raw';
import reading from './pages/reading/view.html?raw';
import database from './pages/database/view.html?raw';
import settings from './pages/settings/view.html?raw';
const routes = {
  overview: {
    title: '总览',
    className: 'overview-sample',
    html: overview,
    load: () => import('./pages/overview/page.js'),
  },
  sources: {
    title: '源管理',
    className: 'source-map',
    html: sources,
    load: () => import('./pages/sources/page.js'),
  },
  reading: {
    title: '文档阅读',
    className: 'reader-study reading-sample',
    html: reading,
    load: () => import('./pages/reading/page.js'),
  },
  database: {
    title: '数据库',
    className: 'reading-sample database-blank database-options',
    html: database,
    load: () => import('./pages/database/page.js'),
  },
  settings: {
    title: '设置',
    className: 'reading-sample settings-sample',
    html: settings,
    load: () => import('./pages/settings/page.js'),
  },
};
void initializeEnvironment();
mountShell();
const host = document.querySelector('#page-host');
let active,
  sequence = 0,
  activeHash = location.hash;
async function renderRoute() {
  const serial = ++sequence;
  const id = location.hash.slice(2).split('?')[0] || 'overview';
  const route = routes[id];
  if (!route) {
    active?.deactivate();
    active = null;
    regionState(host, {
      kind: 'empty',
      title: '找不到页面',
      text: '从左侧选择页面，或返回总览。',
    });
    return;
  }
  if (active && active.id !== id && active.canLeave?.() === false) {
    history.replaceState(null, '', activeHash);
    return;
  }
  activeHash = location.hash;
  document.title = route.title + ' · StruInfo';
  selectPage(id, route.title);
  if (active?.id === id) {
    active.onRoute?.(routeParams());
    return;
  }
  active?.deactivate();
  const page = pageContext(id);
  active = page;
  if (!page.root) {
    page.root = document.createElement('div');
    page.root.className =
      'page-root preview page--' + id + ' ef-app ' + route.className;
    page.root.innerHTML = route.html;
    paintIcons(page.root);
  }
  host.replaceChildren(page.root);
  applyAppearance(localAppearance);
  page.activate();
  host.focus({preventScroll: true});
  try {
    if (!page.initialized) {
      const module = await route.load();
      if (serial !== sequence) return;
      page.initialized = true;
      await module.mount(page);
    }
    if (serial === sequence) page.onRoute?.(routeParams());
  } catch (error) {
    if (error.name !== 'AbortError') notice(error.message, {kind: 'error'});
  }
}
window.addEventListener('hashchange', renderRoute);
window.addEventListener('beforeunload', (e) => {
  if (Object.keys(routes).some((id) => pageContext(id).isDirty?.())) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') {
    e.preventDefault();
    return;
  }
  notice(e.reason?.message || '操作未完成', {kind: 'error'});
});
void renderRoute();
