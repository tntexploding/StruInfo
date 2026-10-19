import {useLayoutEffect, useRef, type RefObject} from 'react';
import {useWorkspaceUi} from '../components/use_workspace_ui.js';
import {
  createApprovedRings,
  type RingState,
} from '../theme/approved_effect_rings.js';
import {makeApprovedRay} from '../theme/approved_effect_ray.js';
import {
  overviewCompletions,
  OVERVIEW_MOTION,
  type OverviewObservation,
  type OverviewCompletion,
} from './overview_motion_state.js';
const numberText = (value: number) => value.toLocaleString('zh-CN');
const smooth = (value: number) => {
  const p = Math.max(0, Math.min(1, value));
  return p * p * (3 - 2 * p);
};

// Production binding only: the reference renderers receive observed completions.
function animateOverview(root: HTMLElement, events: OverviewCompletion[]) {
  const bounds = root.getBoundingClientRect();
  const elements = [...root.querySelectorAll<HTMLElement>('[data-flow-stage]')];
  const rings = createApprovedRings(root);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const width = root.clientWidth,
    height = root.scrollHeight;
  svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
  svg.style.width = `${String(width)}px`;
  svg.style.height = `${String(height)}px`;
  const origin = {x: bounds.x - root.scrollLeft, y: bounds.y - root.scrollTop};
  root.style.setProperty(
    '--stat-count-duration',
    `${String(OVERVIEW_MOTION.count)}ms`,
  );
  root.style.setProperty(
    '--stat-arrival-duration',
    `${String(OVERVIEW_MOTION.delta)}ms`,
  );
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ef-result-transfer');
  if (events.length) root.append(svg);
  const rays: ReturnType<typeof makeApprovedRay>[] = [];
  const handoffs: RingState[] = [];
  const counters: {
    element: HTMLElement;
    card: HTMLElement;
    before: number;
    after: number;
    delta: HTMLElement;
    last: string;
  }[] = [];
  for (const event of events) {
    const source = elements.findIndex(
      (e) => e.dataset.flowStage === event.source,
    );
    const sourceElement = elements[source];
    if (!sourceElement) continue;
    const from = sourceElement.getBoundingClientRect();
    sourceElement.dataset.motionSource = 'true';
    const handoff: RingState = {source, progress: 0};
    const target = elements.findIndex(
      (e) => e.dataset.flowStage === event.target,
    );
    const targetElement = elements[target];
    if (targetElement) {
      const to = targetElement.getBoundingClientRect();
      const forward = to.x > from.x;
      handoff.target = target;
      handoff.sourcePort = forward ? 'right' : 'left';
      handoff.targetPort = forward ? 'left' : 'right';
      targetElement.dataset.motionTarget = 'true';
      rays.push(
        makeApprovedRay(
          svg,
          {
            x: (forward ? from.right : from.left) - origin.x,
            y: from.y + from.height / 2 - origin.y,
          },
          {
            x: (forward ? to.left : to.right) - origin.x,
            y: to.y + to.height / 2 - origin.y,
          },
          `overview-node-wake-${String(source)}`,
          'node',
        ),
      );
    }
    handoffs.push(handoff);
    for (const metric of event.metrics) {
      const card = root.querySelector<HTMLElement>(
        `[data-overview-metric='${metric.id}']`,
      );
      const element = card?.querySelector<HTMLElement>(
        '[data-overview-number]',
      );
      if (!card || !element?.checkVisibility()) continue;
      const to = element.getBoundingClientRect();
      rays.push(
        makeApprovedRay(
          svg,
          {x: from.x + from.width / 2 - origin.x, y: from.y - origin.y},
          {x: to.x + to.width / 2 - origin.x, y: to.bottom - origin.y - 6},
          `overview-stat-wake-${metric.id}`,
          'stat',
        ),
      );
      const delta = document.createElement('span');
      delta.className = 'overview-stat-delta ef-stat-change';
      delta.setAttribute('aria-hidden', 'true');
      delta.textContent = `+${numberText(metric.after - metric.before)}`;
      delta.hidden = true;
      (card.querySelector('.stat-value') ?? card).append(delta);
      element.textContent = numberText(metric.before);
      counters.push({
        element,
        card,
        before: metric.before,
        after: metric.after,
        delta,
        last: numberText(metric.before),
      });
    }
  }
  const started = performance.now();
  let frame = 0,
    disposed = false,
    settled = false;
  let activeHandoffs = handoffs;
  const clear = () => {
    if (settled) return;
    settled = true;
    svg.remove();
    counters.forEach((c) => {
      if (c.element.textContent === c.last)
        c.element.textContent = numberText(c.after);
      c.delta.remove();
      delete c.card.dataset.arriving;
      c.card.classList.remove('ef-stat-arriving');
    });
    elements.forEach((e) => {
      delete e.dataset.motionSource;
      delete e.dataset.motionTarget;
    });
    activeHandoffs = [];
  };
  const tick = (now: number) => {
    if (disposed) return;
    const elapsed = now - started;
    const phase =
      elapsed < OVERVIEW_MOTION.gather
        ? 'gather'
        : elapsed < OVERVIEW_MOTION.arrive
          ? 'flight'
          : 'expand';
    const progress = smooth(
      phase === 'gather'
        ? elapsed / OVERVIEW_MOTION.gather
        : phase === 'flight'
          ? (elapsed - OVERVIEW_MOTION.gather) / OVERVIEW_MOTION.flight
          : (elapsed - OVERVIEW_MOTION.arrive) / OVERVIEW_MOTION.expand,
    );
    const energy =
      elapsed < OVERVIEW_MOTION.charge
        ? smooth(elapsed / OVERVIEW_MOTION.charge)
        : 1 +
          smooth((elapsed - OVERVIEW_MOTION.charge) / OVERVIEW_MOTION.boost);
    svg.dataset.phase = phase;
    svg.dataset.chargePhase =
      elapsed < OVERVIEW_MOTION.charge ? 'charge' : 'boost';
    svg.dataset.energy = energy.toFixed(3);
    if (phase === 'expand') {
      svg.remove();
      elements.forEach((e) => {
        delete e.dataset.motionTarget;
      });
      for (const c of counters) {
        if (settled) continue;
        c.card.dataset.arriving = 'true';
        c.card.classList.add('ef-stat-arriving');
        c.delta.hidden = false;
        c.last = numberText(
          c.before +
            Math.ceil(
              (c.after - c.before) *
                smooth(
                  (elapsed - OVERVIEW_MOTION.arrive) / OVERVIEW_MOTION.count,
                ),
            ),
        );
        c.element.textContent = c.last;
      }
    } else
      rays.forEach((ray) => {
        ray.draw(phase, progress, energy);
      });
    if (elapsed >= OVERVIEW_MOTION.finish) clear();
    rings.draw(
      now,
      activeHandoffs.map((handoff) => ({...handoff, phase, progress})),
    );
    if (
      activeHandoffs.length ||
      elements.some((e) => e.dataset.flowing === 'true')
    )
      frame = requestAnimationFrame(tick);
  };
  if (events.length || elements.some((e) => e.dataset.flowing === 'true'))
    frame = requestAnimationFrame(tick);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    clear();
    rings.detach();
  };
}

export function useOverviewMotion(
  root: RefObject<HTMLDivElement | null>,
  observation: OverviewObservation | undefined,
  stale: boolean,
) {
  const {visual} = useWorkspaceUi();
  const previous = useRef<OverviewObservation | undefined>(undefined);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || (!observation && !stale)) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const canAnimate = () =>
      !document.hidden &&
      !reduced.matches &&
      !stale &&
      visual.motion &&
      visual.flowMotion &&
      visual.glow > 0;
    const events =
      canAnimate() && observation
        ? overviewCompletions(previous.current, observation)
        : [];
    previous.current = stale ? undefined : observation;
    element.setAttribute('data-motion-allowed', String(canAnimate()));
    let stop = canAnimate()
      ? animateOverview(element, events)
      : () => undefined;
    const refresh = () => {
      stop();
      previous.current = undefined;
      element.setAttribute('data-motion-allowed', String(canAnimate()));
      stop = canAnimate() ? animateOverview(element, []) : () => undefined;
    };
    document.addEventListener('visibilitychange', refresh);
    reduced.addEventListener('change', refresh);
    let first = true;
    // ResizeObserver reports its initial dimensions too; don't cancel a new event.
    const resizeObserver = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      refresh();
    });
    resizeObserver.observe(element);
    return () => {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      reduced.removeEventListener('change', refresh);
    };
  }, [root, observation, stale, visual.motion, visual.flowMotion, visual.glow]);
}
