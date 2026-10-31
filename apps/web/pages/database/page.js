import {preference, savePreference} from '../../runtime/preferences.js';
import {bindDivider} from '../../layout-controls.js';
import {pageContext} from '../../runtime/route.js';
import {executeSearch} from './results.js';
import {request, ingestion, attempt} from './api.js';

import {paintIcons} from '../../data.js';
import {$, all, toast} from './sample-ui.js';
import {initReports} from './report-options.js';
import {initSavedQueries} from './saved-options.js';
const page = pageContext('database');
export async function mount() {
  const layout = $('#db-layout'),
    input = $('#search-input'),
    results = $('#result-space'),
    clear = $('#clear-query');
  const config = $('#search-config'),
    configToggle = $('#config-toggle'),
    scope = $('#scope-form'),
    options = $('#query-options');
  let appliedOptions = new FormData(options);
  const option = (name) => appliedOptions.get(name) || '';
  const narrow = matchMedia('(max-width:950px)');
  const layoutPrefs = preference('database-layout', {
    left: 208,
    right: 232,
    open: {left: true, right: true},
  });
  const open = narrow.matches
    ? {left: false, right: false}
    : {...layoutPrefs.open};
  function persistLayout() {
    savePreference('database-layout', {...layoutPrefs, open});
  }
  let currentView = 'idle',
    mode = 'search',
    evidence = 'local';
  const value = (form, name) => form.elements.namedItem(name)?.value ?? '';
  function closeConfig() {
    if (config.matches(':popover-open')) config.hidePopover();
  }
  function view(next) {
    closeConfig();
    currentView = next;
    layout.dataset.view = next;
    results.hidden = next !== 'results';

    updateResult();
  }
  function renderSide(side, focus = false) {
    const panel = $(side === 'left' ? '#scope-panel' : '#reports-panel'),
      region = panel.parentElement,
      opener = $('.side-opener', region);
    panel.hidden = !open[side];
    opener.hidden = open[side];
    layout.classList.toggle(side + '-closed', !open[side]);
    all('[data-side]', region).forEach((b) =>
      b.setAttribute('aria-expanded', String(open[side])),
    );
    if (focus)
      (open[side] ? $('button', panel) : opener).focus({preventScroll: true});
  }
  all('[data-side]').forEach((b) =>
    b.addEventListener('click', () => {
      const side = b.dataset.side;
      open[side] = !open[side];
      if (narrow.matches && open[side]) {
        const other = side === 'left' ? 'right' : 'left';
        open[other] = false;
        renderSide(other);
      }
      closeConfig();
      renderSide(side, true);
      persistLayout();
    }),
  );
  function updateResult() {
    $('#result-title').textContent = mode === 'ask' ? '回答与引用' : '查询结果';
    $('#result-scope').textContent = {
      local: '库内资料',
      web: '网页资料',
      mixed: '库内＋网页',
    }[evidence];

    $('#result-tools').hidden = evidence === 'web' || mode === 'ask';
  }
  function sync() {
    evidence = option('evidenceMode');
    const draftEvidence = value(options, 'evidenceMode');
    const privateScope = value(scope, 'privacy') !== 'public';
    $('#search-module').dataset.mode = mode;
    all('[data-mode]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode)),
    );
    const mixed = $('#mixed-option');
    mixed.hidden = mode !== 'ask';
    mixed.disabled = mode !== 'ask';
    $('#local-options').hidden = draftEvidence === 'web';
    $('#matching-details').hidden = mode === 'ask';
    $('#web-query-field').hidden = !(
      mode === 'ask' && draftEvidence !== 'local'
    );
    $('#web-query').required = mode === 'ask' && draftEvidence !== 'local';
    $('#web-note').hidden = draftEvidence === 'local';
    $('#query-submit').textContent = mode === 'ask' ? '提问' : '搜索';
    $('#config-label').textContent = mode === 'ask' ? '提问设置' : '搜索设置';
    $('#config-title').textContent = mode === 'ask' ? '提问设置' : '搜索设置';
    input.placeholder =
      mode === 'ask'
        ? '输入你的问题'
        : evidence === 'web'
          ? '输入公开搜索词'
          : '输入关键词';
    input.maxLength = mode === 'ask' ? 600 : evidence === 'web' ? 128 : 300;
    const blocked = privateScope && (mode === 'ask' || evidence !== 'local');
    $('#query-submit').disabled = blocked;
    const notice = $('#query-notice');
    notice.hidden = !blocked;
    notice.textContent = '当前包含隐私资料。请切回公开范围后再使用 AI 或联网。';
    for (const [selectName, customName] of [
      ['typeKeyword', 'typeCustomName'],
      ['domainKeyword', 'domainCustomName'],
    ]) {
      const custom = scope.elements.namedItem(customName);
      custom.hidden = value(scope, selectName) !== 'other';
      custom.required = !custom.hidden;
    }
    const count =
      [
        'typeKeyword',
        'domainKeyword',
        'contentKeyword',
        'sourceKey',
        'readingState',
      ].filter((n) => value(scope, n)).length +
      Number(Boolean(value(scope, 'timeFrom') || value(scope, 'timeTo'))) +
      Number(privateScope);
    $('#filter-count').textContent = count ? count + ' 项筛选' : '全部公开资料';
    updateResult();
    placeConfig();
  }
  all('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      if (mode === 'search' && option('evidenceMode') === 'mixed') {
        options.elements.namedItem('evidenceMode').value = 'local';
        appliedOptions.set('evidenceMode', 'local');
      }
      sync();
    }),
  );
  function validScope() {
    const from = scope.elements.namedItem('timeFrom'),
      to = scope.elements.namedItem('timeTo');
    to.setCustomValidity(
      from.value && to.value && from.value > to.value
        ? '结束日期应晚于或等于开始日期。'
        : '',
    );
    if (!scope.checkValidity()) {
      open.left = true;
      renderSide('left');
      const invalid = scope.querySelector(':invalid');
      let ancestor = invalid?.parentElement;
      while (ancestor && ancestor !== scope) {
        if (ancestor.tagName === 'DETAILS') ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      return scope.reportValidity();
    }
    return true;
  }
  scope.addEventListener('input', () => {
    scope.elements.namedItem('timeTo').setCustomValidity('');
    sync();
  });
  scope.addEventListener('change', sync);
  scope.addEventListener('submit', (e) => {
    e.preventDefault();
    $('#search-form').requestSubmit();
  });
  $('#clear-filters').addEventListener('click', () => {
    scope.reset();
    scope.elements.namedItem('timeTo').setCustomValidity('');
    sync();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229))
      e.preventDefault();
  });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) {
      input.focus();
      return;
    }
    if (!validScope() || $('#query-submit').disabled) return;
    if (mode === 'ask' && evidence !== 'local' && !option('webQuery').trim()) {
      config.showPopover();
      placeConfig();
      $('#web-query').focus();
      return;
    }
    view('results');
    void executeSearch({
      mode,
      evidence,
      query: readQuery(),
      question: input.value.trim(),
      webQuery: option('webQuery').trim(),
    });
  });
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    if (!input.value.trim() && currentView !== 'idle') view('idle');
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    view('idle');
    input.focus();
  });
  options.addEventListener('change', (e) => {
    if (
      e.target.name === 'textFields' &&
      !all('[name=textFields]:checked', options).length
    ) {
      e.target.checked = true;
      toast('至少选择一个搜索字段。');
    }
    sync();
  });
  options.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!options.reportValidity()) return;
    appliedOptions = new FormData(options);
    sync();
    closeConfig();
    configToggle.focus({preventScroll: true});
  });
  $('#reset-search-options').addEventListener('click', () => {
    options.reset();
    sync();
  });
  function placeConfig() {
    if (!config.matches(':popover-open')) return;
    const trigger = configToggle.getBoundingClientRect(),
      form = $('#search-form').getBoundingClientRect();
    const width = Math.min(420, innerWidth - 32);
    config.style.width = width + 'px';
    const height = config.getBoundingClientRect().height;
    const below = trigger.bottom + 10;
    let top =
      below + height <= innerHeight - 16 ? below : trigger.top - height - 10;
    top = Math.max(16, Math.min(top, innerHeight - height - 16));
    config.style.left =
      Math.max(
        16,
        Math.min(innerWidth - width - 16, form.left + (form.width - width) / 2),
      ) + 'px';
    config.style.top = top + 'px';
  }
  config.addEventListener('toggle', (e) => {
    configToggle.setAttribute('aria-expanded', String(e.newState === 'open'));
    if (e.newState === 'open') {
      placeConfig();
      $('#close-config').focus({preventScroll: true});
    }
  });
  page.observe(new ResizeObserver(placeConfig), config);
  $('#close-config').addEventListener('click', () =>
    configToggle.focus({preventScroll: true}),
  );
  page.on(document, 'keydown', (e) => {
    if (e.key !== 'Escape' || $('#sample-dialog').open) return;
    if (config.matches(':popover-open')) {
      closeConfig();
      configToggle.focus({preventScroll: true});
    } else if (narrow.matches)
      for (const side of ['left', 'right'])
        if (open[side]) {
          open[side] = false;
          renderSide(side, true);
        }
  });
  page.on(narrow, 'change', (e) => {
    open.left = !e.matches;
    open.right = !e.matches;
    renderSide('left');
    renderSide('right');
    closeConfig();
  });
  page.on(window, 'resize', placeConfig);
  for (const side of ['left', 'right']) {
    const region = $('.side-' + side),
      handle = document.createElement('div');
    handle.className = 'db-divider';
    region.append(handle);
    const apply = () => {
      layout.style.setProperty(
        '--' + side + '-width',
        layoutPrefs[side] + 'px',
      );
    };
    bindDivider(handle, {
      label: side === 'left' ? '调整内容范围栏宽度' : '调整报告栏宽度',
      direction: side === 'left' ? 1 : -1,
      getValue: () => layoutPrefs[side],
      getBounds: () => [180, Math.min(360, layout.clientWidth * 0.28)],
      setValue: (v) => {
        layoutPrefs[side] = v;
        apply();
      },
      commit: persistLayout,
      reset: () => {
        layoutPrefs[side] = side === 'left' ? 208 : 232;
        apply();
      },
    });
    apply();
  }
  function readQuery() {
    if (!validScope()) return;
    const query = {
      retrievalMode: option('retrievalMode'),
      includePrivate: value(scope, 'privacy') !== 'public',
      onlyPrivate: value(scope, 'privacy') === 'only',
      domainScope: 'any',
    };
    if (input.value.trim()) {
      query.text = Array.from(input.value.trim()).slice(0, 300).join('');
      query.textMode = option('textMode');
      query.textFields = appliedOptions.getAll('textFields');
    }
    for (const key of [
      'typeKeyword',
      'domainKeyword',
      'contentKeyword',
      'sourceKey',
    ])
      if (value(scope, key)) query[key] = value(scope, key);
    if (query.typeKeyword === 'other')
      query.typeCustomName = value(scope, 'typeCustomName');
    if (query.domainKeyword === 'other')
      query.domainCustomName = value(scope, 'domainCustomName');
    const filter = {
      ...(value(scope, 'readingState')
        ? {readingState: value(scope, 'readingState')}
        : {}),
      ...(value(scope, 'dimensionId')
        ? {dimensionId: value(scope, 'dimensionId')}
        : {}),
      ...(value(scope, 'termId') ? {termIds: [value(scope, 'termId')]} : {}),
    };
    if (Object.keys(filter).length) query.annotationFilter = filter;
    if (value(scope, 'timeFrom') || value(scope, 'timeTo'))
      query.time = {
        field: value(scope, 'timeField'),
        ...(value(scope, 'timeFrom') ? {from: value(scope, 'timeFrom')} : {}),
        ...(value(scope, 'timeTo') ? {to: value(scope, 'timeTo')} : {}),
      };
    return query;
  }
  function applyQuery(query) {
    scope.reset();
    options.reset();
    mode = 'search';
    input.value = query.text ?? '';
    clear.hidden = !input.value;
    for (const key of [
      'typeKeyword',
      'typeCustomName',
      'domainKeyword',
      'domainCustomName',
      'contentKeyword',
      'sourceKey',
    ])
      if (scope.elements.namedItem(key))
        scope.elements.namedItem(key).value = query[key] ?? '';
    scope.elements.namedItem('readingState').value =
      query.annotationFilter?.readingState ?? '';
    if (query.time) {
      scope.elements.namedItem('timeField').value = query.time.field;
      scope.elements.namedItem('timeFrom').value = query.time.from ?? '';
      scope.elements.namedItem('timeTo').value = query.time.to ?? '';
    }
    options.elements.namedItem('textMode').value =
      query.textMode ?? 'substring';
    all('[name=textFields]', options).forEach(
      (el) =>
        (el.checked = (query.textFields ?? ['title', 'body', 'tags']).includes(
          el.value,
        )),
    );
    appliedOptions = new FormData(options);
    sync();
    view('results');
    void executeSearch({
      mode,
      evidence,
      query: readQuery(),
      question: input.value.trim(),
    });
  }
  paintIcons(page.root);
  renderSide('left');
  renderSide('right');
  sync();
  initReports();
  initSavedQueries({read: readQuery, apply: applyQuery});

  function fillOptions(el, items, label) {
    const selected = el.value;
    el.replaceChildren(
      new Option(label, ''),
      ...items.map(([id, name]) => new Option(name, id)),
    );
    el.value = selected;
    el.disabled = false;
  }
  page.onStart(() => {
    void attempt(async () => {
      const {index} = await request('entries/search/index');
      all('[name=retrievalMode] option').forEach((o) => {
        if (o.value !== 'text') o.disabled = !index.semanticSearchAvailable;
      });
    }, toast);
    void attempt(async () => {
      const {vocabulary} = await ingestion('annotation_vocabulary');
      const dimensions = scope.elements.namedItem('dimensionId'),
        terms = scope.elements.namedItem('termId');
      fillOptions(
        dimensions,
        vocabulary.dimensions
          .filter((d) => d.enabled)
          .map((d) => [d.id, d.name]),
        '不限维度',
      );
      const fill = () =>
        fillOptions(
          terms,
          vocabulary.terms
            .filter(
              (t) => !dimensions.value || t.dimensionId === dimensions.value,
            )
            .map((t) => [t.id, t.label]),
          '不限词条',
        );
      dimensions.onchange = fill;
      fill();
    }, toast);
    void attempt(async () => {
      const response = await request(
        'entry-documents?includePrivate=false&limit=1',
      );
      fillOptions(
        scope.elements.namedItem('sourceKey'),
        (response.facets?.sources || []).map((s) => [
          s,
          s.replace(/#sha256:[a-f0-9]+$/, ''),
        ]),
        '全部来源',
      );
    }, toast);
  });
}
