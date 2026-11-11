import {pageContext} from '../../runtime/route.js';
const page = pageContext('overview');
import {createApprovedRings} from '../../vendor/approved_effect_rings.js';
import {makeApprovedRay} from '../../vendor/approved_effect_ray.js';
import {motionAllowed} from '../../ui.js';
import {changes} from './model.js';
// The accepted renderers are unchanged. Only geometry and live completion events are adapted here.
export function createMotion(root, getState, onComplete, onPlayChange) {
  const svg = root.querySelector('.overview-ray');
  let rings = createApprovedRings(root),
    raf = 0,
    last = 0,
    elapsed = 0,
    phase = 'processing',
    source = 2,
    target = 3,
    statRay = null,
    nodeRay = null,
    serial = 0,
    playing = false;
  const durations = {processing: 3500, gather: 1200, flight: 1200, expand: 700};
  function clearRays() {
    svg.replaceChildren();
    statRay = null;
    nodeRay = null;
  }
  function makeRays() {
    clearRays();
    const frame = root.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
    const node = root.querySelectorAll('.flow-node')[source];
    const stat = root.querySelector(
      `[data-stat="${changes[source]?.key}"] strong`,
    );
    if (!node || !stat) return;
    const a = node.getBoundingClientRect(),
      b = stat.getBoundingClientRect();
    statRay = makeApprovedRay(
      svg,
      {x: a.right - frame.left, y: a.top + a.height / 2 - frame.top},
      {
        x: b.left + b.width / 2 - frame.left,
        y: b.top + b.height / 2 - frame.top,
      },
      `sample-stat-${++serial}`,
      'stat',
    );
    const next = root.querySelectorAll('.flow-node')[target];
    if (next) {
      const n = next.getBoundingClientRect();
      nodeRay = makeApprovedRay(
        svg,
        {x: a.right - frame.left, y: a.top + a.height / 2 - frame.top},
        {x: n.left - frame.left, y: n.top + n.height / 2 - frame.top},
        `sample-node-${serial}`,
        'node',
      );
    }
  }
  function arrive() {
    clearRays();
    onComplete(source);
    phase = 'expand';
    elapsed = 0;
    if (target < 0) {
      playing = false;
      onPlayChange(false);
      phase = 'processing';
    }
  }
  function reset() {
    playing = false;
    last = 0;
    elapsed = 0;
    phase = 'processing';
    source = getState().stage;
    target = source < 4 ? source + 1 : -1;
    clearRays();
    rings.detach();
    rings = createApprovedRings(root);
    root.dataset.phase = 'idle';
  }
  function frame(now) {
    raf = 0;
    const s = getState();
    const dt = last ? Math.min(70, now - last) : 0;
    last = now;
    const animate =
        motionAllowed() && document.body.dataset.flowMotion !== 'off',
      isActive = playing || s.running;
    if (playing && isActive) {
      elapsed += dt;
      if (!animate) {
        clearRays();
        onComplete(source);
        playing = false;
        phase = 'processing';
        elapsed = 0;
        onPlayChange(false);
      } else if (elapsed >= durations[phase]) {
        elapsed = 0;
        if (phase === 'processing') {
          source = s.stage;
          target = source < 4 ? source + 1 : -1;
          phase = 'gather';
          makeRays();
        } else if (phase === 'gather') {
          phase = 'flight';
        } else if (phase === 'flight') {
          arrive();
        } else {
          phase = 'processing';
          playing = false;
          onPlayChange(false);
          source = s.stage;
          target = source < 5 ? source + 1 : -1;
        }
      }
    }
    const progress = Math.min(1, elapsed / durations[phase]);
    root.dataset.phase = playing && isActive ? phase : 'idle';
    if (animate && isActive) {
      const states =
        playing && phase !== 'processing'
          ? [
              phase === 'expand'
                ? {target, phase, progress}
                : {source, target, phase, progress},
            ]
          : [];
      rings.draw(now, states);
      if (playing && (phase === 'gather' || phase === 'flight')) {
        svg.style.visibility = 'visible';
        statRay?.draw(phase, progress, progress * 0.5);
        nodeRay?.draw(phase, progress, progress * 0.5);
      } else svg.style.visibility = 'hidden';
    } else {
      rings.draw(
        now,
        Array.from({length: 6}, (_, i) => ({
          source: i,
          phase: 'flight',
          progress: 1,
        })),
      );
      svg.style.visibility = 'hidden';
    }
    if (page.active && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (!raf && page.active && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  page.on(document, 'visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    } else startLoop();
  });
  page.on(window, 'resize', () => {
    rings.detach();
    rings = createApprovedRings(root);
    if (phase === 'flight' || phase === 'gather') makeRays();
  });
  page.on(window, 'motion-change', () => {
    if (!motionAllowed()) clearRays();
    else if (phase === 'gather' || phase === 'flight') makeRays();
  });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
    'change',
    () => {
      if (!motionAllowed()) clearRays();
      else if (phase === 'gather' || phase === 'flight') makeRays();
    },
  );
  page.onStart(startLoop);
  page.onStop(() => {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    svg.style.visibility = 'hidden';
  });
  return {
    reset,
    play(stage, next) {
      source = stage;
      target = next;
      elapsed = 0;
      phase = 'gather';
      playing = true;
      last = 0;
      makeRays();
      onPlayChange(true);
    },
    pause() {
      playing = false;
      onPlayChange(false);
    },
    isPlaying: () => playing,
  };
}
