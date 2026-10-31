import {createClient} from './api.js';
// Framework §2/7: one attached page; detached views preserve local drafts.
const pages = new Map();
export function pageContext(id) {
  if (pages.has(id)) return pages.get(id);
  const listeners = [],
    starts = [],
    stops = [];
  let controller = new AbortController(),
    scrollPositions = [];
  const page = {
    id,
    root: null,
    active: false,
    initialized: false,
    state: {},
    get signal() {
      return controller.signal;
    },
    $(selector, root = page.root) {
      return root.querySelector(selector);
    },
    $$(selector, root = page.root) {
      return [...root.querySelectorAll(selector)];
    },
    on(target, type, handler, options) {
      listeners.push({target, type, handler, options});
      if (page.active) target.addEventListener(type, handler, options);
    },
    onStart(fn) {
      starts.push(fn);
      if (page.active) fn();
    },
    onStop(fn) {
      stops.push(fn);
    },
    observe(observer, target) {
      page.onStart(() => observer.observe(target));
      page.onStop(() => observer.disconnect());
    },
    poll(fn, delay = () => 30000) {
      let timer,
        running = false;
      const run = async () => {
        clearTimeout(timer);
        if (!page.active || document.hidden || running) return;
        running = true;
        try {
          await fn();
        } finally {
          running = false;
          if (page.active) timer = setTimeout(run, delay());
        }
      };
      page.onStart(run);
      page.onStop(() => clearTimeout(timer));
      page.on(document, 'visibilitychange', () =>
        document.hidden ? clearTimeout(timer) : void run(),
      );
      return run;
    },
    activate() {
      if (page.active) return;
      page.active = true;
      controller = new AbortController();
      for (const l of listeners)
        l.target.addEventListener(l.type, l.handler, l.options);
      for (const start of starts) start();
      requestAnimationFrame(() => {
        if (page.active)
          for (const [element, x, y] of scrollPositions)
            if (element.isConnected) {
              element.scrollTo({left: x, top: y, behavior: 'instant'});
            }
      });
    },
    deactivate() {
      scrollPositions = [page.root, ...page.root.querySelectorAll('*')]
        .filter((el) => el.scrollTop || el.scrollLeft)
        .map((el) => [el, el.scrollLeft, el.scrollTop]);
      page.active = false;
      controller.abort();
      for (const l of listeners)
        l.target.removeEventListener(l.type, l.handler, l.options);
      for (const stop of stops) stop();
      page.root?.querySelectorAll('dialog[open]').forEach((d) => d.close());
      page.root
        ?.querySelectorAll(':popover-open')
        .forEach((p) => p.hidePopover());
      page.root?.remove();
    },
  };
  page.api = createClient(() => ({signal: page.signal}));
  pages.set(id, page);
  return page;
}
export const routeParams = () =>
  new URLSearchParams(location.hash.split('?')[1] || '');
export function navigate(page, values = {}, replace = false) {
  const params = new URLSearchParams(
    Object.entries(values).filter(
      ([, v]) => v !== undefined && v !== null && v !== '',
    ),
  );
  const hash = '#/' + page + (params.size ? '?' + params : '');
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.hash = hash;
}
