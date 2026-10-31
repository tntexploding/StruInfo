import {notice} from '../../shared/notice.js';
import {bindDialog} from '../../shared/dialog.js';
import {preference, savePreference} from '../../runtime/preferences.js';
import {pageContext, routeParams, navigate} from '../../runtime/route.js';
import {attempt} from './api.js';
import {localAppearance} from '../../runtime/environment.js';
// Keeps the accepted A reader and D evidence comparison layouts.
import {
  createLayoutPreferences,
  bindDivider,
  rangeField,
  bindRanges,
  clamp,
} from '../../layout-controls.js';
import {escape as esc, icon, paintIcons} from '../../data.js';
import {
  articles,
  documentById,
  docLinks,
  topics,
  sectionAnnotations,
  readState,
  setReadState,
  saveChanges,
  publishDocument,
  saveRelations,
  publicationState,
  localContentChanges,
  relationChanges,
  browse,
  discard,
  retryLinks,
  loadDocument,
  loadError,
  draftNote,
  privateScope,
  loadDocuments,
  setPrivateScope,
  anyDraft,
} from './documents.js';
import {openEditor, editorDirty, closeEditor} from './editor.js';
const page = pageContext('reading');
export async function mount() {
  const $ = (q, root = page.root) => root.querySelector(q);
  const pickerDialog = bindDialog($('#document-picker'), {
    closeButtons: [$('[data-close="document-picker"]')],
    initialFocus: $('#document-search'),
    closeOnBackdrop: true,
  });
  const optionsDialog = bindDialog($('#reading-options-dialog'), {
    closeButtons: [$('[data-close="reading-options-dialog"]')],
    closeOnBackdrop: true,
  });
  const prefs = createLayoutPreferences(
    'reading',
    {
      font: localAppearance.readingSize ?? 20,
      leading: 1.85,
      measure: (localAppearance.readingMeasure ?? 88) / 2,
      notes: 360,
      comparison: 50,
      boundaries: 1,
    },
    {
      font: [18, 26],
      leading: [1.6, 2.4],
      measure: [28, 64],
      notes: [260, 560],
      comparison: [30, 70],
      boundaries: [0, 1],
    },
  );
  const params = routeParams();
  const state = {
    mode: 'A',
    id: articles.some((a) => a.id === params.get('doc'))
      ? params.get('doc')
      : articles[0]?.id,
    segment: 0,
    related: null,
    relatedSegment: 0,
  };
  const current = () => documentById(state.id);
  const scrollPositions = new Map(
    Object.entries(preference('reading-position', {})),
  );
  let divider = null,
    pickerPurpose = 'main',
    pickerTopic = null,
    scrollRaf = 0,
    returnAnchor = null,
    selectionSequence = 0,
    currentError = '';
  const reduced = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
  function readingBounds() {
    const w = $('#reading-stage').clientWidth,
      n = Math.max(1, w - 12),
      minimum = Math.min(260, n / 2);
    return state.mode === 'D'
      ? [Math.max(minimum, n * 0.3), Math.min(n - minimum, n * 0.7)]
      : [260, Math.max(260, Math.min(560, w - 420))];
  }
  function sidebarWidth() {
    const w = $('#reading-stage').clientWidth,
      [min, max] = readingBounds();
    return clamp(
      state.mode === 'D'
        ? ((w - 12) * prefs.values.comparison) / 100
        : prefs.values.notes,
      min,
      max,
    );
  }
  function applyLayout() {
    const v = prefs.values;
    document.body.style.setProperty('--reading-font-size', v.font + 'px');
    document.body.style.setProperty('--reading-leading', v.leading);
    document.body.style.setProperty('--reading-measure', v.measure + 'em');
    $('#reading-stage').style.setProperty(
      '--reading-side-width',
      sidebarWidth() + 'px',
    );
    $('.reading-frame').classList.toggle('hide-boundaries', !v.boundaries);
    divider?.refresh();
  }
  function mountDivider() {
    divider?.destroy();
    divider = null;
    const side =
      $('#reading-stage > .annotation-rail') ||
      $('#reading-stage > .secondary-column');
    if (side) {
      const handle = document.createElement('div');
      handle.id = 'reading-divider';
      side.before(handle);
      divider = bindDivider(handle, {
        label:
          state.mode === 'D' ? '调整两篇原文的宽度' : '调整原文与旁注的宽度',
        getValue: sidebarWidth,
        getBounds: readingBounds,
        direction: -1,
        setValue: (value) => {
          prefs.set(
            state.mode === 'D' ? 'comparison' : 'notes',
            state.mode === 'D'
              ? (value / ($('#reading-stage').clientWidth - 12)) * 100
              : value,
            false,
          );
          applyLayout();
        },
        commit: prefs.persist,
        reset: () => {
          prefs.set(
            state.mode === 'D' ? 'comparison' : 'notes',
            state.mode === 'D' ? 50 : 360,
          );
          applyLayout();
        },
      });
    }
    applyLayout();
  }
  const tags = (values) =>
    values.map((t) => '<span class="tag-word">' + esc(t) + '</span>').join('');
  function tagDetails(d, index) {
    const a = sectionAnnotations(d, index);
    return (
      '<dl class="section-tags">' +
      [
        ['domain', '领域'],
        ['subject', '主题'],
        ['purpose', '用途'],
      ]
        .map(
          ([key, label]) =>
            '<dt>' + label + '</dt><dd>' + esc(a[key] || '未填写') + '</dd>',
        )
        .join('') +
      '</dl>'
    );
  }
  function toc(d) {
    return (
      '<nav class="toc-list" aria-label="文档分段">' +
      d.groups
        .map(
          (g, i) =>
            '<button data-jump="' +
            i +
            '" aria-current="' +
            (state.segment === i) +
            '"><span>' +
            String(i + 1).padStart(2, '0') +
            '</span><span>' +
            esc(g.title) +
            '</span></button>',
        )
        .join('') +
      '</nav>'
    );
  }
  function relationList(d) {
    const links = docLinks(d.id);
    if (d.linksStatus === 'loading')
      return '<p class="quiet-empty" role="status">正在读取联系…</p>';
    if (d.linksStatus === 'error')
      return '<p role="alert">联系未能读取。<button class="text-button" data-retry-links>重新读取</button></p>';
    if (!links.length) return '<p class="quiet-empty">暂无已保存的联系。</p>';
    return links
      .map((e) => {
        const target = documentById(e.target);
        return (
          '<button class="related-link" data-related="' +
          e.target +
          '" data-evidence="' +
          e.targetIndex +
          '" data-own="' +
          e.ownIndex +
          '"><strong>' +
          esc(target?.title || e.targetTitle || '相关文档') +
          icon('external') +
          '</strong><p>' +
          esc(e.reason) +
          '</p><small>第 ' +
          (e.ownIndex + 1) +
          ' 段 ↔ 第 ' +
          (e.targetIndex + 1) +
          ' 段 <span>对照阅读 ' +
          icon('arrow') +
          '</span></small></button>'
        );
      })
      .join('');
  }
  function documentSummary(d) {
    const links =
      d.linksStatus === 'ready'
        ? docLinks(d.id).length + ' 个联系'
        : d.linksStatus === 'error'
          ? '联系读取失败'
          : '联系读取中';
    return (
      '<span>' +
      d.groups.length +
      ' 个分段</span><span>' +
      d.tags.length +
      ' 个标签</span><span>' +
      links +
      '</span>'
    );
  }
  function articleHeader(d) {
    const publication = publicationState(d.id);
    const status = publication?.hasDraft
      ? '待发布'
      : publication?.visibility === 'published'
        ? '已发布'
        : '未发布';
    return (
      '<header class="document-heading"><div class="document-meta"><span>' +
      esc(d.source) +
      '</span><span>' +
      esc(d.date) +
      '</span><span class="content-type">' +
      esc(d.type) +
      '</span><span>' +
      status +
      '</span>' +
      (d.summaryRecord.isPrivate ? '<span>私密</span>' : '') +
      '</div><h2>' +
      esc(d.title) +
      '</h2><div class="document-meta document-summary">' +
      documentSummary(d) +
      '</div>' +
      (d.summary ? '<p class="document-deck">' + esc(d.summary) + '</p>' : '') +
      '</header>'
    );
  }
  function articleMarkup(d, {secondary = false} = {}) {
    const pair = docLinks(state.id).find((e) => e.target === state.related);
    return (
      '<article class="reading-paper">' +
      articleHeader(d) +
      d.groups
        .map((g, i) => {
          const evidence =
            state.mode === 'D' &&
            (secondary
              ? !!pair && state.relatedSegment === i
              : pair?.ownIndex === i);
          const marker = secondary
            ? '<span class="section-number">' +
              String(i + 1).padStart(2, '0') +
              '</span>'
            : '<button class="section-number" data-segment="' +
              i +
              '" aria-label="查看第 ' +
              (i + 1) +
              ' 段信息">' +
              String(i + 1).padStart(2, '0') +
              '</button>';
          return (
            '<section class="reading-section ' +
            (!secondary && state.segment === i ? 'is-current ' : '') +
            (evidence ? 'evidence-section' : '') +
            '" data-section="' +
            i +
            '" tabindex="-1"><div class="reader-section-heading">' +
            marker +
            '<h3>' +
            esc(g.title) +
            '</h3></div>' +
            g.blocks
              .map(
                (block, j) =>
                  (j && block[0]
                    ? '<h4 class="retained-heading">' + esc(block[0]) + '</h4>'
                    : '') +
                  block
                    .slice(1)
                    .filter(Boolean)
                    .map(
                      (text, n) =>
                        '<p>' +
                        (evidence && j === 0 && n === 0
                          ? '<mark>' + esc(text) + '</mark>'
                          : esc(text).replaceAll('\n', '<br>')) +
                        '</p>',
                    )
                    .join(''),
              )
              .join('') +
            '</section>'
          );
        })
        .join('') +
      '<footer class="document-end"><span class="end-rule"></span>已到文末<span>原文</span></footer></article>'
    );
  }
  function annotationContent() {
    const d = current(),
      topic = topics.find((t) => t.ids.includes(d.id));
    return (
      '<div class="annotation-title"><h2>旁注</h2><small>' +
      d.groups.length +
      ' 段原文</small></div>' +
      '<section class="info-block"><div class="info-heading"><b>原文结构</b></div>' +
      toc(d) +
      '</section>' +
      '<section class="info-block current-annotation"><div class="info-heading"><b>本段标签</b><span>第 ' +
      String(state.segment + 1).padStart(2, '0') +
      ' 段</span></div><p class="current-section-name">' +
      esc(d.groups[state.segment].title) +
      '</p>' +
      tagDetails(d, state.segment) +
      '</section>' +
      '<section class="info-block"><div class="info-heading"><b>文档标签</b><span>' +
      d.tags.length +
      ' 个</span></div><div class="document-tags">' +
      (d.tags.length
        ? tags(d.tags)
        : '<span class="quiet-empty">暂无标签</span>') +
      '</div></section>' +
      (topic
        ? '<section class="info-block topic-block"><div class="info-heading"><b>所属主题</b></div><button class="topic-link" data-topic="' +
          topic.id +
          '">' +
          icon('layers') +
          '<span>' +
          esc(topic.name) +
          '</span><small>' +
          topic.ids.length +
          ' 篇</small>' +
          icon('chevron') +
          '</button></section>'
        : '') +
      '<section class="info-block"><div class="info-heading"><b>相关文档</b><span>' +
      docLinks(d.id).length +
      ' 篇</span></div>' +
      relationList(d) +
      '</section>'
    );
  }
  function status() {
    const d = current();
    $('#reading-position').textContent =
      '第 ' +
      (state.segment + 1) +
      ' / ' +
      d.groups.length +
      ' 段 · ' +
      d.groups[state.segment].title;
    $('#reading-extent').textContent =
      d.groups.length +
      ' 段原文 · ' +
      d.tags.length +
      ' 个标签 · ' +
      docLinks(d.id).length +
      ' 篇相关';
    $('#read-state').value = readState(state.id);
  }
  function setSegment(index, {announce = false} = {}) {
    state.segment = clamp(index, 0, current().groups.length - 1);
    $('#primary-reader')
      .querySelectorAll('[data-section]')
      .forEach((el) =>
        el.classList.toggle(
          'is-current',
          Number(el.dataset.section) === state.segment,
        ),
      );
    const panel = $('#context-info');
    if (panel) {
      const y = panel.scrollTop;
      panel.innerHTML = annotationContent();
      panel.scrollTop = y;
    }
    status();
    if (announce)
      notice(
        '第 ' +
          (state.segment + 1) +
          ' 段：' +
          current().groups[state.segment].title,
      );
  }
  function scrollToSegment(index, {instant = false, focus = false} = {}) {
    setSegment(index);
    const reader = $('#primary-reader'),
      section = $('[data-section="' + state.segment + '"]', reader);
    if (matchMedia('(max-width:700px)').matches)
      section.scrollIntoView({
        behavior: instant || reduced() ? 'instant' : 'smooth',
        block: 'start',
      });
    else
      reader.scrollTo({
        top:
          reader.scrollTop +
          section.getBoundingClientRect().top -
          reader.getBoundingClientRect().top -
          24,
        behavior: instant || reduced() ? 'instant' : 'smooth',
      });
    if (focus) section.focus({preventScroll: true});
  }
  function render({restore = true} = {}) {
    if (currentError || !current()) {
      $('#draft-bar').hidden = true;
      $('#reading-position').textContent = '';
      $('#reading-extent').textContent = '';
      $('#current-document').textContent =
        currentError || loadError ? '读取失败' : '暂无文档';
      $('#reading-stage').innerHTML =
        '<div class="empty"><h3>' +
        esc(currentError || loadError || '暂无已接受的文档') +
        '</h3><a class="secondary-action" href="#/sources">打开源管理</a></div>';
      ['edit-document', 'read-state', 'reading-options'].forEach(
        (id) => ($('#' + id).disabled = true),
      );
      return;
    }

    const old = $('#primary-reader');
    if (old && restore) scrollPositions.set(state.id, old.scrollTop);
    const d = current();
    state.segment = clamp(state.segment, 0, d.groups.length - 1);
    $('.reading-main').className =
      'reading-main ' + (state.mode === 'D' ? 'mode-parallel' : 'mode-margin');
    $('#current-document').textContent = d.title;
    ['edit-document', 'read-state', 'reading-options'].forEach(
      (id) => ($('#' + id).disabled = false),
    );
    const content = localContentChanges(state.id),
      links = relationChanges(state.id),
      publication = publicationState(state.id);
    $('#draft-bar').hidden = !(content || links || publication?.hasDraft);
    $('#confirm-draft').hidden = !content;
    $('#publish-document').hidden = !publication?.hasDraft;
    $('#publish-document').disabled = content;
    $('#save-relations').hidden = !links;
    $('#save-relations').disabled = content || publication?.hasDraft === true;
    $('#draft-bar>span').textContent = content
      ? '有未保存的修改'
      : publication?.hasDraft
        ? '内容已保存，待发布'
        : links
          ? '有未保存的联系'
          : '已保存';
    let html =
      '<div class="reading-scroll" id="primary-reader" tabindex="0" role="region" aria-label="原文阅读区">' +
      articleMarkup(d) +
      '</div>';
    if (state.mode === 'A')
      html +=
        '<aside class="annotation-rail" id="context-info" aria-label="文档标签、结构与联系">' +
        annotationContent() +
        '</aside>';
    if (state.mode === 'D') {
      const edge = docLinks(d.id).find((e) => e.target === state.related);
      html =
        '<div class="pair-context"><div><span>' +
        icon('link') +
        ' 联系依据</span><p>' +
        esc(edge?.reason || '并排阅读两篇文档。') +
        '</p></div><button id="leave-parallel" class="secondary-action">' +
        icon('close') +
        ' 返回旁注</button></div>' +
        html +
        '<aside class="secondary-column" aria-label="相关原文"><div class="secondary-toolbar"><span>对照文档</span><button data-compare-picker>' +
        icon('folder') +
        ' 更换文档</button></div><div class="reading-scroll" id="secondary-reader" tabindex="0" role="region" aria-label="对照原文阅读区">' +
        articleMarkup(documentById(state.related), {secondary: true}) +
        '</div></aside>';
    }
    $('#reading-stage').innerHTML = html;
    $('#reading-stage').dataset.layout = state.mode;
    mountDivider();
    const reader = $('#primary-reader');
    reader.scrollTop = restore ? scrollPositions.get(state.id) || 0 : 0;
    reader.addEventListener(
      'scroll',
      () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          if (!reader.isConnected) return;
          const edge = reader.getBoundingClientRect().top + 130;
          let i = 0;
          reader.querySelectorAll('[data-section]').forEach((section) => {
            if (section.getBoundingClientRect().top <= edge)
              i = Number(section.dataset.section);
          });
          if (
            reader.scrollTop > 0 &&
            reader.scrollHeight - reader.scrollTop - reader.clientHeight < 3
          )
            i = current().groups.length - 1;
          if (i !== state.segment) setSegment(i);
        });
      },
      {passive: true},
    );
    status();
  }
  async function openRelated(button) {
    await loadDocument(button.dataset.related);
    returnAnchor = {y: $('#primary-reader').scrollTop, segment: state.segment};
    state.related = button.dataset.related;
    state.relatedSegment = Number(button.dataset.evidence);
    state.segment = Number(button.dataset.own);
    state.mode = 'D';
    render();
    requestAnimationFrame(() => {
      scrollToSegment(state.segment, {instant: true});
      const secondary = $('#secondary-reader'),
        section = $('[data-section="' + state.relatedSegment + '"]', secondary);
      if (section)
        secondary.scrollTop +=
          section.getBoundingClientRect().top -
          secondary.getBoundingClientRect().top -
          24;
      $('#leave-parallel').focus({preventScroll: true});
    });
  }
  function leaveParallel() {
    state.mode = 'A';
    state.segment = returnAnchor?.segment || 0;
    render();
    $('#primary-reader').scrollTop = returnAnchor?.y || 0;
    const button = $('[data-related="' + state.related + '"]');
    button?.focus({preventScroll: true});
    returnAnchor = null;
  }
  function pickerRows() {
    const rows = articles
      .filter((d) => browse.ids.includes(d.id))
      .map((d) => documentById(d.id))
      .filter(
        (d) =>
          (pickerPurpose !== 'comparison' || d.id !== state.id) &&
          (!pickerTopic || pickerTopic.ids.includes(d.id)),
      );
    $('#picker-count').textContent =
      '已加载 ' + browse.ids.length + ' / ' + browse.totalCount + ' 篇';
    $('#more-documents').hidden = !browse.nextCursor;
    $('#picker-results').innerHTML = rows.length
      ? rows
          .map(
            (d) =>
              '<button class="picker-row" data-document="' +
              d.id +
              '" aria-current="' +
              (pickerPurpose === 'main' && d.id === state.id) +
              '"><span class="picker-file">' +
              icon('file') +
              '</span><span><strong>' +
              esc(d.title) +
              '</strong><small>' +
              esc(d.source) +
              ' · ' +
              esc(d.type) +
              ' · ' +
              d.date +
              '</small></span><span class="picker-state">' +
              (pickerPurpose === 'main' && d.id === state.id
                ? '当前'
                : {unread: '未读', reading: '正在读', read: '已读'}[
                    readState(d.id)
                  ]) +
              '</span>' +
              icon('chevron') +
              '</button>',
          )
          .join('')
      : '<div class="empty"><h3>没有匹配的文档</h3><p>更换关键词或筛选条件。</p></div>';
  }
  function openPicker(purpose = 'main', topic = null) {
    pickerPurpose = purpose;
    pickerTopic = topic;
    $('#picker-title').textContent = topic
      ? topic.name
      : purpose === 'comparison'
        ? '选择对照文档'
        : '选择文档';
    $('#picker-caption').textContent = topic
      ? topic.description
      : '按标题、来源或标签查找';
    $('#document-search').value = '';
    $('#type-filter').value = '';
    $('#state-filter').value = '';
    void readPicker();
    pickerDialog.open();
  }
  function readingSettings() {
    const v = prefs.values;
    $('#reading-options-content').innerHTML =
      '<div class="layout-settings">' +
      rangeField('font', '正文字号', v.font, 18, 26, 1, ' px') +
      rangeField('leading', '正文行距', v.leading, 1.6, 2.4, 0.05, ' 倍') +
      rangeField('measure', '正文行宽', v.measure, 28, 64, 1, ' 字宽') +
      '<label class="boundary-option"><span><b>显示分段线</b><small>标出分段位置和编号。</small></span><input id="boundary-setting" type="checkbox" ' +
      (v.boundaries ? 'checked' : '') +
      '></label><p class="layout-help">拖动正文与旁注之间的分隔线可调整栏宽。</p><button class="secondary-action" id="reset-reading">恢复默认</button></div>';
    bindRanges($('#reading-options-content'), prefs, applyLayout);
    $('#boundary-setting').onchange = (e) => {
      prefs.set('boundaries', Number(e.target.checked));
      applyLayout();
    };
    $('#reset-reading').onclick = () => {
      prefs.reset();
      applyLayout();
      readingSettings();
      $('#reset-reading').focus();
    };
  }
  function openSettings() {
    readingSettings();
    optionsDialog.open();
  }
  function edit(kind = 'structure') {
    openEditor({
      id: state.id,
      section: current().groups[state.segment].indices[0],
      kind,
      onSave: () => {
        render();
        notice(draftNote(state.id));
      },
    });
  }

  $('#choose-document').onclick = () => openPicker();
  let searchTimer;
  async function readPicker(append = false) {
    const type = $('#type-filter').value,
      readingState = $('#state-filter').value;
    $('#picker-count').textContent = '读取中…';
    $('#more-documents').disabled = true;
    const ok = await attempt(async () => {
      await loadDocuments({
        q: $('#document-search').value.trim(),
        type,
        readingState,
        append,
      });
      return true;
    }, notice);
    if (ok) {
      $('#type-filter').replaceChildren(
        new Option('全部类型', ''),
        ...browse.types.map((t) => new Option(t, t)),
      );
      $('#type-filter').value = type;
      pickerRows();
    } else $('#picker-count').textContent = '读取失败';
    $('#more-documents').disabled = false;
  }
  $('#document-search').oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void readPicker(), 250);
  };
  $('#more-documents').onclick = () => readPicker(true);
  $('#type-filter').onchange = () => readPicker();
  $('#state-filter').onchange = () => readPicker();
  $('#picker-results').onclick = async (e) => {
    const b = e.target.closest('[data-document]');
    if (!b) return;
    const serial = ++selectionSequence;
    const loaded = await attempt(
      () => loadDocument(b.dataset.document),
      notice,
    );
    if (!loaded || serial !== selectionSequence) return;
    currentError = '';
    pickerDialog.close();
    if (pickerPurpose === 'comparison') {
      state.related = b.dataset.document;
      const edge = docLinks(state.id).find((e) => e.target === state.related);
      state.relatedSegment = edge?.targetIndex ?? 0;
      render();
      $('#leave-parallel').focus({preventScroll: true});
    } else {
      scrollPositions.set(state.id, $('#primary-reader')?.scrollTop || 0);
      state.id = b.dataset.document;
      navigate('reading', {doc: state.id});
      state.segment = 0;
      state.mode = 'A';
      state.related = null;
      returnAnchor = null;
      render({restore: false});
      $('#choose-document').focus({preventScroll: true});
    }
  };
  $('#reading-stage').onclick = (e) => {
    if (e.target.closest('[data-retry-links]')) {
      void attempt(() => retryLinks(state.id), notice);
      return;
    }
    const related = e.target.closest('[data-related]');
    if (related) {
      void attempt(() => openRelated(related), notice);
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      scrollToSegment(Number(jump.dataset.jump), {focus: true});
      return;
    }
    const marker = e.target.closest('[data-segment]');
    if (marker) {
      setSegment(Number(marker.dataset.segment));
      return;
    }
    const topic = e.target.closest('[data-topic]');
    if (topic) {
      openPicker(
        'main',
        topics.find((t) => t.id === topic.dataset.topic),
      );
      return;
    }
    if (e.target.closest('[data-compare-picker]')) openPicker('comparison');
    if (e.target.closest('#leave-parallel')) leaveParallel();
  };
  $('#reading-options').onclick = openSettings;
  $('#edit-document').onclick = () => edit();
  $('#read-state').onchange = () =>
    attempt(async () => {
      await setReadState(state.id, $('#read-state').value);
      render();
      notice('阅读状态待确认');
    }, notice);
  $('#confirm-draft').onclick = () =>
    attempt(async () => {
      $('#confirm-draft').disabled = true;
      try {
        await saveChanges(state.id);
        render();
        notice('修改已保存，确认后发布到数据库');
      } finally {
        $('#confirm-draft').disabled = false;
      }
    }, notice);
  $('#publish-document').onclick = () =>
    attempt(async () => {
      const button = $('#publish-document');
      button.disabled = true;
      try {
        await publishDocument(state.id);
        render();
        notice('已发布到数据库');
      } finally {
        button.disabled = false;
      }
    }, notice);
  $('#save-relations').onclick = () =>
    attempt(async () => {
      const button = $('#save-relations');
      button.disabled = true;
      try {
        await saveRelations(state.id);
        render();
        notice('联系已保存');
      } finally {
        button.disabled = false;
      }
    }, notice);
  $('#discard-draft').onclick = () => {
    discard(state.id);
    render();
    notice('已撤销未确认的修改。');
    $('#edit-document').focus();
  };
  paintIcons(page.root);
  ['edit-document', 'choose-document', 'read-state'].forEach(
    (id) => ($('#' + id).disabled = true),
  );

  let initialReading = true,
    entering = false;
  async function enterReading() {
    if (entering || (!initialReading && current()?.ranges && !currentError))
      return;
    entering = true;
    initialReading = false;
    currentError = '';
    await attempt(() => loadDocuments(), notice);
    const id = routeParams().get('doc') || state.id || browse.ids[0];
    state.id = id;
    if (id)
      try {
        await loadDocument(id);
      } catch (error) {
        if (error.name !== 'AbortError') currentError = error.message;
      }
    $('#choose-document').disabled = false;
    entering = false;
    if (!page.active) return;
    const requested = routeParams().get('doc');
    if (requested && requested !== id) {
      void page.onRoute?.(routeParams());
      return;
    }
    if (id && !currentError) navigate('reading', {doc: id}, true);
    render({restore: true});
  }
  page.onStart(() => {
    const saved = preference('reading', {});
    for (const [key, value] of Object.entries(saved))
      prefs.set(key, value, false);
    applyLayout();
    void enterReading();
  });
  page.on(window, 'workspace-ready', () => {
    const saved = preference('reading', {});
    for (const [key, value] of Object.entries(saved))
      prefs.set(key, value, false);
    applyLayout();
  });
  page.observe(new ResizeObserver(applyLayout), $('#reading-stage'));

  page.isDirty = () => anyDraft() || editorDirty();
  page.canLeave = () => !editorDirty() || closeEditor();
  page.onRoute = async (params) => {
    if (entering) return;
    if (
      page.state.includePrivate !== undefined &&
      page.state.includePrivate !== privateScope
    ) {
      if (anyDraft()) {
        notice('先保存或撤销修改，再切换查看范围。');
        page.state.includePrivate = privateScope;
        return;
      }
      setPrivateScope(page.state.includePrivate);
      $('#private-scope').checked = privateScope;
      await attempt(() => loadDocuments(), notice);
    }
    const id = params.get('doc');
    if (!id || (id === state.id && !currentError && current()?.ranges)) return;
    const serial = ++selectionSequence;
    try {
      await loadDocument(id);
      if (serial !== selectionSequence || !page.active) return;
      state.id = id;
      state.segment = 0;
      state.mode = 'A';
      currentError = '';
      render({restore: true});
    } catch (error) {
      if (error.name !== 'AbortError') {
        currentError = error.message;
        render();
      }
    }
  };
  page.root.addEventListener('document-links', (event) => {
    if (event.detail === state.id) {
      const summary = $('#primary-reader .document-summary');
      if (summary) summary.innerHTML = documentSummary(current());
      status();
      const panel = $('#context-info');
      if (panel) {
        const y = panel.scrollTop;
        panel.innerHTML = annotationContent();
        panel.scrollTop = y;
      }
    }
  });
  page.onStop(() => {
    const el = $('#primary-reader');
    if (el && state.id) {
      scrollPositions.set(state.id, el.scrollTop);
      if (!privateScope)
        savePreference(
          'reading-position',
          Object.fromEntries([...scrollPositions].slice(-40)),
        );
    }
    clearTimeout(searchTimer);
    cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  });

  $('#private-scope').checked = privateScope;
  $('#private-scope').onchange = () => {
    if (anyDraft() || editorDirty()) {
      notice('先保存或撤销当前修改，再切换查看范围。');
      $('#private-scope').checked = privateScope;
      return;
    }
    setPrivateScope($('#private-scope').checked);
    page.state.includePrivate = privateScope;
    void attempt(async () => {
      await loadDocuments();
      state.id = browse.ids[0];
      if (state.id) await loadDocument(state.id);
      render({restore: false});
    }, notice);
  };
}
