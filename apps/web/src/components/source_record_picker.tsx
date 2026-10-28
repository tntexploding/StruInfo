import {useEffect, useId, useRef, type CSSProperties} from 'react';

export interface SourceRecordCard {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly pending: number;
  accent?: string | undefined;
}

// Geometry and spring motion from the accepted content-ui-study/sources.js.
export function SourceRecordPicker({
  cards,
  selected,
  onSelect,
}: {
  readonly cards: readonly SourceRecordCard[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const prefix = useId().replaceAll(':', '');
  const callback = useRef(onSelect);
  useEffect(() => {
    callback.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    const wheel = root.current;
    if (!wheel || !cards.length) return;
    const svg = required(wheel.querySelector('svg'));
    const sectors = [...wheel.querySelectorAll<SVGGElement>('.record-sector')];
    const ticks = required(wheel.querySelector<SVGGElement>('.record-ticks'));
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let target = Math.max(
      0,
      cards.findIndex((c) => c.id === selected),
    );
    let position = target,
      velocity = 0,
      raf = 0,
      last = 0;
    let drag:
      | {y: number; position: number; moved: boolean; index: number | undefined}
      | undefined;
    let suppressClick = false;
    const lifts: number[] = cards.map((_, i) => (i === target ? 1 : 0));
    const speeds = cards.map(() => 0);
    const pitch = 25,
      rad = Math.PI / 180;
    const reduced = () =>
      media.matches ||
      document.body.dataset.motion === 'off' ||
      document.hidden;
    const size = () => {
      const w = wheel.clientWidth,
        h = wheel.clientHeight;
      const outer = Math.max(260, w + 34),
        inner = Math.max(80, outer - 252);
      return {w, h, outer, inner, cx: -88, cy: h / 2};
    };
    const draw = () => {
      const {w, h, outer, inner, cx, cy} = size();
      wheel
        .closest<HTMLElement>('.record-stage')
        ?.style.setProperty('--record-radius', `${String(outer)}px`);
      svg.setAttribute('viewBox', `0 0 ${String(w)} ${String(h)}`);
      const base = required(
        svg.querySelector<SVGCircleElement>('.record-base'),
      );
      base.setAttribute('cx', String(cx));
      base.setAttribute('cy', String(cy));
      base.setAttribute('r', String(outer + 5));
      ticks.setAttribute(
        'transform',
        `rotate(${String(-position * pitch)} ${String(cx)} ${String(cy)})`,
      );
      const c = Math.cos((pitch / 2) * rad),
        s = Math.sin((pitch / 2) * rad);
      const path = `M ${String(inner * c)} ${String(-inner * s)} L ${String(outer * c)} ${String(-outer * s)} A ${String(outer)} ${String(outer)} 0 0 1 ${String(outer * c)} ${String(outer * s)} L ${String(inner * c)} ${String(inner * s)} A ${String(inner)} ${String(inner)} 0 0 0 ${String(inner * c)} ${String(-inner * s)} Z`;
      sectors.forEach((card, i) => {
        const angle = (i - position) * pitch,
          lift = lifts[i] ?? 0;
        card.setAttribute(
          'transform',
          `translate(${String(cx)} ${String(cy)}) rotate(${String(angle)}) translate(${String(22 * lift)} 0) scale(${String(1 + 0.055 * lift)})`,
        );
        card.style.visibility = Math.abs(angle) > 105 ? 'hidden' : 'visible';
        card.style.pointerEvents = Math.abs(angle) > 82 ? 'none' : 'auto';
        card.style.opacity = String(
          Math.abs(angle) < 55
            ? 1
            : Math.max(0.25, 1 - (Math.abs(angle) - 55) / 60),
        );
        card.classList.toggle(
          'selected',
          i === target && Math.abs(position - i) < 0.08,
        );
        card.setAttribute('aria-pressed', String(cards[i]?.id === selected));
        card.setAttribute('tabindex', i === target ? '0' : '-1');
        required(card.querySelector('.sector-face')).setAttribute('d', path);
        const textX = inner + 63,
          countX = outer - 28;
        required(card.querySelector('.sector-rim')).setAttribute(
          'd',
          `M ${String(outer * c)} ${String(-outer * s)} A ${String(outer)} ${String(outer)} 0 0 1 ${String(outer * c)} ${String(outer * s)}`,
        );
        required(card.querySelector('.sector-monogram')).setAttribute(
          'x',
          String(inner + 15),
        );
        required(card.querySelector('.sector-initial')).setAttribute(
          'x',
          String(inner + 32),
        );
        required(card.querySelector('.sector-name')).setAttribute(
          'x',
          String(textX),
        );
        required(card.querySelector('.sector-meta')).setAttribute(
          'x',
          String(textX),
        );
        card
          .querySelector('.sector-count-bg')
          ?.setAttribute('x', String(countX - 11));
        card.querySelector('.sector-count')?.setAttribute('x', String(countX));
        const text = required(
          card.querySelector<SVGTextElement>('.sector-name'),
        );
        let label = cards[i]?.name ?? '';
        text.textContent = label;
        while (
          text.getComputedTextLength() > countX - textX - 19 &&
          label.length > 2
        ) {
          label = label.slice(0, -1);
          text.textContent = label + '…';
        }
        const meta = required(
          card.querySelector<SVGTextElement>('.sector-meta'),
        );
        let detail = cards[i]?.detail ?? '';
        meta.textContent = detail;
        while (
          meta.getComputedTextLength() > countX - textX - 19 &&
          detail.length > 2
        ) {
          detail = detail.slice(0, -1);
          meta.textContent = detail + '…';
        }
        const layer = required(
          svg.querySelector(lift > 0.06 ? '.record-front' : '.record-cards'),
        );
        if (card.parentNode !== layer) layer.appendChild(card);
      });
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      position = target;
      velocity = 0;
      lifts.forEach((_, i) => {
        lifts[i] = i === target ? 1 : 0;
        speeds[i] = 0;
      });
      draw();
      const card = cards[target];
      if (card && card.id !== selected) callback.current(card.id);
    };
    const frame = (now: number) => {
      if (reduced()) {
        finish();
        return;
      }
      const dt = Math.min(0.035, (now - last) / 1000 || 0.016);
      last = now;
      if (!drag) {
        const omega = 18,
          delta = position - target,
          v = velocity + omega * delta,
          e = Math.exp(-omega * dt);
        position = target + (delta + v * dt) * e;
        velocity = (velocity - omega * v * dt) * e;
      }
      const arrived =
        !drag &&
        Math.abs(position - target) < 0.025 &&
        Math.abs(velocity) < 0.3;
      let moving =
        Math.abs(position - target) > 0.001 || Math.abs(velocity) > 0.01;
      lifts.forEach((lift, i) => {
        const goal = arrived && i === target ? 1 : 0;
        const speed =
          (speeds[i] ?? 0) +
          ((goal - lift) * (goal ? 240 : 420) -
            (speeds[i] ?? 0) * (goal ? 27 : 35)) *
            dt;
        speeds[i] = speed;
        lifts[i] = Math.max(0, Math.min(1.02, lift + speed * dt));
        if (Math.abs(lifts[i] - goal) > 0.002 || Math.abs(speed) > 0.01)
          moving = true;
      });
      draw();
      if (moving || drag) raf = requestAnimationFrame(frame);
      else finish();
    };
    const animate = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const choose = (index: number) => {
      target = Math.max(0, Math.min(cards.length - 1, index));
      animate();
    };
    let wheelDelta = 0,
      lastWheelStep = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const wheelMove = (e: WheelEvent) => {
      if (e.ctrlKey) return;
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
      wheelTimer = setTimeout(() => {
        wheelDelta = 0;
      }, 160);
    };
    const key = (e: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        choose(
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? cards.length - 1
              : target + (e.key === 'ArrowDown' ? 1 : -1),
        );
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        finish();
      }
    };
    const click = (e: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const card = (e.target as Element).closest<SVGGElement>(
        '[data-record-index]',
      );
      if (card) choose(Number(card.dataset.recordIndex));
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const sector = (e.target as Element).closest<SVGGElement>(
        '[data-record-index]',
      );
      drag = {
        y: e.clientY,
        position,
        moved: false,
        index: sector ? Number(sector.dataset.recordIndex) : undefined,
      };
      wheel.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const delta = (drag.y - e.clientY) / 85;
      if (Math.abs(delta) > 0.06) drag.moved = true;
      position = Math.max(0, Math.min(cards.length - 1, drag.position + delta));
      target = Math.round(position);
      animate();
    };
    const up = () => {
      if (!drag) return;
      const tapped = drag.moved ? undefined : drag.index;
      suppressClick = true;
      drag = undefined;
      choose(tapped ?? target);
    };
    const visible = () => {
      if (document.hidden) finish();
    };
    const resize = new ResizeObserver(draw);
    resize.observe(wheel);
    draw();
    wheel.addEventListener('wheel', wheelMove, {passive: false});
    wheel.addEventListener('keydown', key);
    wheel.addEventListener('click', click);
    wheel.addEventListener('pointerdown', down);
    wheel.addEventListener('pointermove', move);
    wheel.addEventListener('pointerup', up);
    wheel.addEventListener('pointercancel', up);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      resize.disconnect();
      // Restore React's DOM order before reconciliation.
      const layer = required(svg.querySelector('.record-cards'));
      sectors.forEach((s) => layer.appendChild(s));
      wheel.removeEventListener('wheel', wheelMove);
      wheel.removeEventListener('keydown', key);
      wheel.removeEventListener('click', click);
      wheel.removeEventListener('pointerdown', down);
      wheel.removeEventListener('pointermove', move);
      wheel.removeEventListener('pointerup', up);
      wheel.removeEventListener('pointercancel', up);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [cards, selected]);
  return (
    <div
      ref={root}
      className="source-wheel"
      tabIndex={0}
      aria-label="来源唱片，滚轮或上下方向键选择"
    >
      {!cards.length ? <p className="content-empty">没有匹配的来源。</p> : null}
      <svg className="record-svg" aria-label="来源选择器">
        <defs>
          <radialGradient id={`${prefix}-vinyl`}>
            <stop stopColor="#272728" />
            <stop offset=".5" stopColor="#18181a" />
            <stop offset="1" stopColor="#222224" />
          </radialGradient>
          <linearGradient id={`${prefix}-face`} x2="1" y2="1">
            <stop stopColor="#303033" />
            <stop offset="1" stopColor="#232326" />
          </linearGradient>
          <linearGradient id={`${prefix}-selected`} x2="1" y2="1">
            <stop stopColor="#4c4432" />
            <stop offset=".5" stopColor="#353129" />
            <stop offset="1" stopColor="#2e2b25" />
          </linearGradient>
        </defs>
        <circle className="record-base" fill={`url(#${prefix}-vinyl)`} />
        <g className="record-ticks" />
        <g className="record-cards">
          {cards.map((card, i) => (
            <g
              key={card.id}
              className="record-sector"
              style={
                {'--record-accent': card.accent ?? '#c4b08b'} as CSSProperties
              }
              data-record-index={i}
              role="button"
              tabIndex={card.id === selected ? 0 : -1}
              aria-label={`${card.name}，${String(card.pending)} 篇待审核`}
              aria-pressed={card.id === selected}
            >
              <path
                className="sector-face"
                style={{
                  fill: `url(#${prefix}-${card.id === selected ? 'selected' : 'face'})`,
                }}
              />
              <path className="sector-rim" fill="none" />
              <g className="sector-label">
                <rect
                  className="sector-monogram"
                  rx="9"
                  width="34"
                  height="38"
                  y="-19"
                />
                <text className="sector-initial" y="6" textAnchor="middle">
                  {
                    Array.from(
                      new Intl.Segmenter('zh-CN', {
                        granularity: 'grapheme',
                      }).segment(card.name),
                    )[0]?.segment
                  }
                </text>
                <text className="sector-name" y="-5">
                  {card.name}
                </text>
                <text className="sector-meta" y="18">
                  {card.detail}
                </text>
                {card.pending ? (
                  <>
                    <rect
                      className="sector-count-bg"
                      width="22"
                      height="23"
                      rx="6"
                      y="-12"
                    />
                    <text className="sector-count" textAnchor="middle" y="4">
                      {card.pending}
                    </text>
                  </>
                ) : null}
              </g>
            </g>
          ))}
        </g>
        <g className="record-front" />
      </svg>
    </div>
  );
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('source_record_element_missing');
  return value;
}
