/* Copied from accepted effects-rings.js. Adaptations: typed module, instance
   lifetime, real stage ids and concurrent completion events. Drawing unchanged. */
export interface RingState {
  source?: number;
  target?: number;
  phase?: 'gather' | 'flight' | 'expand';
  progress: number;
  sourcePort?: 'left' | 'right';
  targetPort?: 'left' | 'right';
}
interface RingRecord {
  node: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  index: number;
  w: number;
  h: number;
  dpr: number;
  length: number;
  paths: {left: Path2D; right: Path2D};
}
export function createApprovedRings(app: HTMLElement) {
  const margin = 28;
  const turn = Math.PI * 2;
  let records: RingRecord[] = [];
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  function roundedPath(
    w: number,
    h: number,
    radius: number,
    port: 'left' | 'right',
  ) {
    const path = new Path2D();
    const left = margin + 1,
      top = margin + 1;
    const right = margin + w - 1,
      bottom = margin + h - 1;
    const mid = margin + h / 2;
    if (port === 'left') {
      path.moveTo(left, mid);
      path.lineTo(left, top + radius);
      path.arcTo(left, top, left + radius, top, radius);
      path.lineTo(right - radius, top);
      path.arcTo(right, top, right, top + radius, radius);
      path.lineTo(right, bottom - radius);
      path.arcTo(right, bottom, right - radius, bottom, radius);
      path.lineTo(left + radius, bottom);
      path.arcTo(left, bottom, left, bottom - radius, radius);
    } else {
      path.moveTo(right, mid);
      path.lineTo(right, bottom - radius);
      path.arcTo(right, bottom, right - radius, bottom, radius);
      path.lineTo(left + radius, bottom);
      path.arcTo(left, bottom, left, bottom - radius, radius);
      path.lineTo(left, top + radius);
      path.arcTo(left, top, left + radius, top, radius);
      path.lineTo(right - radius, top);
      path.arcTo(right, top, right, top + radius, radius);
    }
    path.closePath();
    return path;
  }
  function resize() {
    for (const r of records) {
      const box = r.node.getBoundingClientRect();
      r.w = box.width;
      r.h = box.height;
      r.dpr = Math.min(devicePixelRatio || 1, 2);
      r.canvas.width = Math.ceil((r.w + margin * 2) * r.dpr);
      r.canvas.height = Math.ceil((r.h + margin * 2) * r.dpr);
      const radius =
        parseFloat(getComputedStyle(r.node).borderTopLeftRadius) || 14;
      r.length = 2 * (r.w + r.h - 4 - radius * 4) + turn * radius;
      r.paths = {
        right: roundedPath(r.w, r.h, radius, 'right'),
        left: roundedPath(r.w, r.h, radius, 'left'),
      };
    }
  }
  function attach() {
    records = [...app.querySelectorAll<HTMLElement>('.flow-node')].flatMap(
      (node, index) => {
        const canvas = node.querySelector<HTMLCanvasElement>('.ef-node-ring');
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || typeof ctx.createConicGradient !== 'function')
          return [];
        return [
          {
            node,
            canvas,
            ctx,
            index,
            w: 0,
            h: 0,
            dpr: 1,
            length: 0,
            paths: {left: new Path2D(), right: new Path2D()},
          },
        ];
      },
    );
    resize();
  }
  function glowPort(
    r: RingRecord,
    side: 'left' | 'right',
    opacity: number,
    strength: number,
  ) {
    if (opacity <= 0) return;
    const ctx = r.ctx,
      x = side === 'right' ? margin + r.w - 1 : margin + 1,
      y = margin + r.h / 2;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 25);
    glow.addColorStop(0, 'rgba(223,246,255,.95)');
    glow.addColorStop(0.18, 'rgba(158,211,233,.75)');
    glow.addColorStop(0.55, 'rgba(158,211,233,.18)');
    glow.addColorStop(1, 'rgba(158,211,233,0)');
    ctx.globalAlpha = opacity * strength;
    ctx.fillStyle = glow;
    ctx.fillRect(x - 25, y - 25, 50, 50);
  }
  function draw(now: number, states: RingState[] = []) {
    for (const r of records) {
      const {ctx, canvas} = r;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
      const state =
        states.find((s) => s.source === r.index) ??
        states.find((s) => s.target === r.index);
      let mode = 'idle',
        portion = 0,
        port: 'left' | 'right' = 'right',
        portLight = 0;
      {
        if (r.index === state?.source) {
          mode = 'drain';
          port = state.sourcePort ?? 'right';
          portion = state.phase === 'gather' ? 1 - state.progress : 0;
          portLight =
            state.phase === 'gather'
              ? state.progress
              : state.phase === 'flight'
                ? Math.max(0, 1 - state.progress * 4)
                : 0;
        } else if (r.index === state?.target) {
          port = state.targetPort ?? 'left';
          mode = 'unfold';
          portion = state.phase === 'expand' ? state.progress : 0;
          portLight =
            state.phase === 'flight'
              ? clamp((state.progress - 0.88) / 0.12)
              : state.phase === 'expand'
                ? 1 - state.progress
                : 0;
        } else if (r.node.classList.contains('running')) {
          mode = 'orbit';
          portion = 1;
        }
      }
      const strength =
        state?.phase === 'gather' || state?.phase === 'expand' ? 0.65 : 0.36;
      if (portion > 0.00001) {
        ctx.save();
        const angle = (now / 8500) * turn;
        const ink = ctx.createConicGradient(
          angle,
          margin + r.w / 2,
          margin + r.h / 2,
        );
        (
          [
            [0, 0.24],
            [0.12, 0.45],
            [0.28, 1],
            [0.4, 0.68],
            [0.57, 0.18],
            [0.76, 0.28],
            [0.88, 0.34],
            [1, 0.24],
          ] as const
        ).forEach(([stop, alpha]) => {
          ink.addColorStop(stop, `rgba(158,211,233,${String(alpha)})`);
        });
        ctx.strokeStyle = ink;
        ctx.lineCap = 'butt';
        if (portion < 0.99999) {
          ctx.setLineDash([r.length * portion, r.length * 2]);
          ctx.lineDashOffset = mode === 'drain' ? -r.length * (1 - portion) : 0;
        }
        for (const [width, blur, alpha] of [
          [17, 7, 0.7],
          [9, 2.4, 0.7],
          [4.2, 0.45, 1],
        ] as const) {
          ctx.lineWidth = width;
          ctx.filter = `blur(${String(blur)}px)`;
          ctx.globalAlpha = alpha * strength;
          ctx.stroke(r.paths[port]);
        }
        ctx.restore();
      }
      ctx.save();
      glowPort(r, port, portLight, strength);
      ctx.restore();
    }
  }
  attach();
  return {
    draw,
    detach: () => {
      for (const {ctx, canvas} of records) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      records = [];
    },
  };
}
