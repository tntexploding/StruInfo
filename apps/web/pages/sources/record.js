import {pageContext, routeParams} from '../../runtime/route.js';
const page = pageContext('sources');
// Reused from accepted sources.js: sector geometry, critically damped rotation,
// lifted selection, wheel and pointer behavior. Layout-only cards replace example data.
import {sources, kinds} from './store.js';
export function mountRecord() {
  const $ = (selector, root = page.root) => root.querySelector(selector);
  const $$ = (selector, root = page.root) => [
    ...root.querySelectorAll(selector),
  ];
  const escape = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('"', '&quot;');
  const motionAllowed = () =>
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !document.hidden &&
    !document.body.classList.contains('no-motion');
  const root = $('#sources');
  let selected = Math.max(
      0,
      sources.findIndex((s) => s.id === routeParams().get('source')),
    ),
    position = selected,
    target = selected,
    velocity = 0,
    raf = 0,
    lastTime = 0,
    filtered = [...sources];
  let lifts = [],
    liftSpeeds = [],
    geometry = null,
    drag = null,
    suppressClick = false;
  const pitch = 25,
    rad = Math.PI / 180;
  function renderDetail() {
    $('#announcement').textContent = filtered[selected]
      ? `已选中${filtered[selected].name}`
      : '未匹配来源卡片';
    root.dataset.selection = filtered[selected]?.id ?? '';
    document.dispatchEvent(new CustomEvent('source-layout-selection'));
  }
  function cards() {
    $('#record-front').innerHTML = '';
    lifts = filtered.map((_, i) => (i === selected ? 1 : 0));
    liftSpeeds = filtered.map(() => 0);
    $('#source-cards').innerHTML = filtered
      .map(
        (
          s,
          i,
        ) => `<g class="record-sector ${i === selected ? 'selected' : ''}" data-source="${s.id}" data-index="${i}" role="button" aria-pressed="${i === selected}" tabindex="${i === selected ? 0 : -1}" aria-label="${escape(s.name)}">
    <path class="sector-face"/><path class="sector-rim" fill="none"/>
    <g class="sector-label"><rect class="sector-monogram" rx="9" width="34" height="38" y="-19"/><text class="sector-initial" y="6" text-anchor="middle">${escape(s.initial)}</text><text class="sector-name" y="-3">${escape(s.name)}</text><text class="sector-meta" y="16">${escape(kinds[s.kind] || s.kind)}</text>${s.count ? `<rect class="sector-count-bg" width="22" height="23" rx="6" y="-12"/><text class="sector-count" text-anchor="middle" y="4">${s.count}</text>` : ''}</g>
  </g>`,
      )
      .join('');
    $$('.record-sector').forEach((card) => {
      card.onclick = () => {
        if (!suppressClick) choose(+card.dataset.index);
      };
      card.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose(+card.dataset.index);
        }
      };
    });
    geometry = null;
    draw();
  }
  function markSelection() {
    $$('.record-sector').forEach((card) => {
      const i = +card.dataset.index;
      card.classList.toggle(
        'selected',
        i === selected && Math.abs(position - i) < 0.08,
      );
      card.setAttribute('aria-pressed', String(i === selected));
      card.tabIndex = i === target ? 0 : -1;
    });
  }
  function sectorPath(inner, outer, half) {
    const c = Math.cos(half),
      sn = Math.sin(half);
    return `M ${inner * c} ${-inner * sn} L ${outer * c} ${-outer * sn} A ${outer} ${outer} 0 0 1 ${outer * c} ${outer * sn} L ${inner * c} ${inner * sn} A ${inner} ${inner} 0 0 0 ${inner * c} ${-inner * sn} Z`;
  }
  function sizeRecord() {
    const wheel = $('#source-wheel'),
      w = wheel.clientWidth,
      h = wheel.clientHeight;
    if (!w || !h) return;
    if (geometry?.w === w && geometry?.h === h) return;
    const outer = Math.max(260, w + 34),
      inner = Math.max(80, outer - 252),
      cx = -88,
      cy = h / 2;
    geometry = {w, h, outer, inner, cx, cy};
    $('.record-stage').style.setProperty('--record-radius', `${outer}px`);
    $('#record-svg').setAttribute('viewBox', `0 0 ${w} ${h}`);
    $('#record-base').innerHTML =
      `<circle cx="${cx}" cy="${cy}" r="${outer + 5}" fill="url(#record-vinyl)" stroke="#b7b8bc30"/>` +
      Array.from(
        {length: 12},
        (_, i) =>
          `<circle cx="${cx}" cy="${cy}" r="${inner - 6 - i * 5}" class="record-groove"/>`,
      )
        .filter((_, i) => inner - 6 - i * 5 > 10)
        .join('') +
      `<circle cx="${cx}" cy="${cy}" r="${outer - 4}" class="record-groove"/><circle cx="${cx}" cy="${cy}" r="${inner + 3}" class="record-groove"/>`;
    $('#record-ticks').innerHTML = Array.from({length: 72}, (_, i) => {
      const angle = i * 5 * rad,
        r = outer + 5,
        len = i % 3 === 0 ? 8 : 4;
      return `<path d="M ${cx + (r - len) * Math.cos(angle)} ${cy + (r - len) * Math.sin(angle)} L ${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)}"/>`;
    }).join('');
    $('#record-pointer').setAttribute(
      'd',
      `M ${w - 4} ${cy - 7} L ${w - 4} ${cy + 7}`,
    );
    const path = sectorPath(inner, outer, (pitch / 2) * rad);
    $$('.record-sector').forEach((card) => {
      const s = filtered[+card.dataset.index],
        textX = inner + 63,
        countX = outer - 28;
      $('.sector-face', card).setAttribute('d', path);
      $('.sector-rim', card).setAttribute(
        'd',
        `M ${outer * Math.cos((-pitch / 2) * rad)} ${outer * Math.sin((-pitch / 2) * rad)} A ${outer} ${outer} 0 0 1 ${outer * Math.cos((pitch / 2) * rad)} ${outer * Math.sin((pitch / 2) * rad)}`,
      );
      $('.sector-monogram', card).setAttribute('x', inner + 15);
      $('.sector-initial', card).setAttribute('x', inner + 32);
      $('.sector-name', card).setAttribute('x', textX);
      $('.sector-meta', card).setAttribute('x', textX);
      $('.sector-count-bg', card)?.setAttribute('x', countX - 11);
      $('.sector-count', card)?.setAttribute('x', countX);
      const maxWidth = countX - textX - 19;
      for (const [selector, text] of [
        ['.sector-name', s.name],
        ['.sector-meta', kinds[s.kind] || '来源'],
      ]) {
        const el = $(selector, card);
        el.textContent = text;
        let shortened = text;
        while (el.getComputedTextLength() > maxWidth && shortened.length > 2) {
          shortened = shortened.slice(0, -1);
          el.textContent = shortened + '…';
        }
      }
    });
  }
  function draw() {
    sizeRecord();
    if (!geometry) return;
    const {cx, cy} = geometry;
    $$('.record-sector').forEach((card) => {
      const i = +card.dataset.index,
        angle = (i - position) * pitch,
        away = Math.abs(angle),
        lift = lifts[i] || 0;
      card.setAttribute(
        'transform',
        `translate(${cx} ${cy}) rotate(${angle}) translate(${22 * lift} 0) scale(${1 + 0.055 * lift})`,
      );
      card.style.opacity = String(
        away < 55 ? 1 : Math.max(0.25, 1 - (away - 55) / 60),
      );
      card.style.visibility = away > 105 ? 'hidden' : 'visible';
      card.style.pointerEvents = away > 82 ? 'none' : 'auto';
      card.classList.toggle('raised', lift > 0.06);
      const layer = lift > 0.06 ? $('#record-front') : $('#source-cards');
      if (card.parentElement !== layer) layer.append(card);
    });
    $('#record-ticks').setAttribute(
      'transform',
      `rotate(${-position * pitch} ${cx} ${cy})`,
    );
    $('#record-pointer').style.opacity = filtered.length ? 1 : 0;
  }
  function commitSelection() {
    const changed = selected !== target;
    selected = target;
    markSelection();
    $('#source-detail').classList.remove('source-switching');
    $('#source-detail').removeAttribute('aria-busy');
    $('#source-detail').inert = false;
    if (changed) {
      renderDetail();
      $('#source-detail').scrollTop = 0;
    }
  }
  function settle() {
    position = target;
    velocity = 0;
    raf = 0;
    drag = null;
    lifts = filtered.map((_, i) => (i === target ? 1 : 0));
    liftSpeeds = filtered.map(() => 0);
    commitSelection();
    draw();
  }
  function spring(now) {
    if (root.hidden || document.hidden || !motionAllowed()) {
      settle();
      return;
    }
    const dt = Math.min(0.035, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    if (!drag) {
      const omega = 18,
        delta = position - target,
        c = velocity + omega * delta,
        e = Math.exp(-omega * dt);
      position = target + (delta + c * dt) * e;
      velocity = (velocity - omega * c * dt) * e;
    }
    const arrived =
      !drag && Math.abs(position - target) < 0.025 && Math.abs(velocity) < 0.3;
    if (arrived && selected !== target) commitSelection();
    let motion =
      Math.abs(position - target) > 0.001 || Math.abs(velocity) > 0.01;
    lifts.forEach((lift, i) => {
      const goal = arrived && i === target ? 1 : 0,
        k = goal ? 240 : 420,
        damping = goal ? 27 : 35;
      liftSpeeds[i] += ((goal - lift) * k - liftSpeeds[i] * damping) * dt;
      lifts[i] = Math.max(0, Math.min(1.02, lift + liftSpeeds[i] * dt));
      if (Math.abs(lifts[i] - goal) > 0.002 || Math.abs(liftSpeeds[i]) > 0.01)
        motion = true;
    });
    markSelection();
    draw();
    if (motion || drag) raf = requestAnimationFrame(spring);
    else settle();
  }
  function animate() {
    if (!motionAllowed()) {
      cancelAnimationFrame(raf);
      settle();
      return;
    }
    if (!raf) {
      lastTime = performance.now();
      raf = requestAnimationFrame(spring);
    }
  }
  function choose(value) {
    if (!filtered.length) return;
    target = Math.max(0, Math.min(filtered.length - 1, value));
    $('#source-detail').classList.toggle(
      'source-switching',
      selected !== target,
    );
    $('#source-detail').setAttribute('aria-busy', String(selected !== target));
    $('#source-detail').inert = selected !== target;
    animate();
  }

  let wheelDelta = 0,
    wheelTimer,
    lastWheelStep = 0;
  $('#source-wheel').addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || !filtered.length) return;
      e.preventDefault();
      const delta =
          e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 300 : 1),
        now = performance.now();
      if (Math.sign(delta) !== Math.sign(wheelDelta)) wheelDelta = 0;
      wheelDelta = Math.max(-120, Math.min(120, wheelDelta + delta));
      if (Math.abs(wheelDelta) >= 54 && now - lastWheelStep > 135) {
        choose(target + Math.sign(wheelDelta));
        wheelDelta = 0;
        lastWheelStep = now;
      }
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => (wheelDelta = 0), 160);
    },
    {passive: false},
  );
  $('#source-wheel').addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      choose(
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? filtered.length - 1
            : target + (e.key === 'ArrowDown' ? 1 : -1),
      );
    }
  });
  const wheel = $('#source-wheel');
  wheel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !filtered.length) return;
    drag = {y: e.clientY, start: position, id: e.pointerId, moved: false};
  });
  wheel.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 5) {
      drag.moved = true;
      wheel.setPointerCapture(e.pointerId);
    }
    if (!drag.moved) return;
    e.preventDefault();
    position = Math.max(
      0,
      Math.min(filtered.length - 1, drag.start - dy / 130),
    );
    velocity = 0;
    target = Math.round(position);
    wheel.classList.add('dragging');
    animate();
  });
  function finishDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    suppressClick = drag.moved;
    const moved = drag.moved;
    drag = null;
    wheel.classList.remove('dragging');
    if (wheel.hasPointerCapture(e.pointerId))
      wheel.releasePointerCapture(e.pointerId);
    if (moved) choose(Math.round(position));
    setTimeout(() => (suppressClick = false), 0);
  }
  wheel.addEventListener('pointerup', finishDrag);
  wheel.addEventListener('pointercancel', finishDrag);
  page.observe(new ResizeObserver(draw), wheel);
  page.onStop(() => {
    cancelAnimationFrame(raf);
    raf = 0;
  });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
    'change',
    () => {
      if (!motionAllowed()) {
        cancelAnimationFrame(raf);
        settle();
      }
    },
  );

  let selectedKind = 'all',
    sort = 'name';
  function filterSources(preferred) {
    const query = $('#source-search').value.trim();
    cancelAnimationFrame(raf);
    raf = 0;
    filtered = sources
      .filter(
        (source) =>
          source.name.includes(query) &&
          (selectedKind === 'all' || source.kind === selectedKind),
      )
      .sort((a, b) =>
        sort === 'active'
          ? Number(b.enabled) - Number(a.enabled) ||
            a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
      );
    selected =
      position =
      target =
        Math.max(
          0,
          filtered.findIndex((s) => s.id === preferred),
        );
    velocity = 0;
    $('#source-detail').classList.remove('source-switching');
    $('#source-detail').removeAttribute('aria-busy');
    $('#source-detail').inert = false;
    cards();
    markSelection();
    renderDetail();
  }
  $('#source-search').addEventListener('input', () => filterSources());
  page.on(document, 'source-layout-filter', (event) => {
    selectedKind = event.detail.kind;
    sort = event.detail.sort;
    filterSources();
  });
  page.on(document, 'source-layout-update', (event) => {
    const source = sources.find((s) => s.id === event.detail.id);
    if (source) Object.assign(source, event.detail);
    filterSources(event.detail.id);
  });
  page.on(document, 'source-layout-add', (event) => {
    sources.push(event.detail);
    selectedKind = 'all';
    $('#source-search').value = '';
    filterSources(event.detail.id);
  });
  page.on(document, 'source-layout-motion', () => {
    if (!motionAllowed()) {
      cancelAnimationFrame(raf);
      settle();
    }
  });
  page.on(document, 'visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      settle();
    }
  });
  page.on(document, 'source-layout-reload', () =>
    filterSources(root.dataset.selection),
  );
  page.on(document, 'source-layout-focus', (event) =>
    filterSources(event.detail),
  );
  cards();
  renderDetail();
}
