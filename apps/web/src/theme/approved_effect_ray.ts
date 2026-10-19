/* Direct reuse: accepted overview-motion.js makeRay; TypeScript/DOM string conversions only. */
interface Point {
  x: number;
  y: number;
}
export function makeApprovedRay(
  svg: SVGSVGElement,
  from: Point,
  to: Point,
  id: string,
  kind: 'stat' | 'node',
) {
  const ns = 'http://www.w3.org/2000/svg';
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy);
  const ux = dx / Math.max(1, length),
    uy = dy / Math.max(1, length);
  const point = (p: number) => ({x: from.x + dx * p, y: from.y + dy * p});
  const path = (a: Point, b: Point) =>
    `M ${String(a.x)} ${String(a.y)} L ${String(b.x)} ${String(b.y)}`;
  const defs = document.createElementNS(ns, 'defs');
  const bounds = svg.viewBox.baseVal;
  defs.innerHTML = `<linearGradient id="${id}-fade" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient><linearGradient id="${id}-tip" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9ed3e9" stop-opacity="0"/><stop offset="0.5" stop-color="#9ed3e9" stop-opacity="0.65"/><stop offset="1" stop-color="#e8f8ff"/></linearGradient><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${String(bounds.width)}" height="${String(bounds.height)}" style="mask-type:luminance"><rect width="${String(bounds.width)}" height="${String(bounds.height)}" fill="url(#${id}-fade)"/></mask>`;
  svg.append(defs);
  const group = document.createElementNS(ns, 'g');
  group.classList.add('ef-energy-ray', `ef-energy-${kind}`);
  group.setAttribute('mask', `url(#${id})`);
  group.innerHTML = `<g class="ef-energy-charge"><path class="ef-energy-soft"/><path class="ef-energy-body"/><path class="ef-energy-core"/></g><g class="ef-energy-packet"><path class="ef-energy-soft"/><path class="ef-energy-body"/><path class="ef-energy-core"/><circle class="ef-energy-head"/></g>`;
  svg.append(group);
  const charge = group.querySelector<SVGGElement>('.ef-energy-charge');
  const packet = group.querySelector<SVGGElement>('.ef-energy-packet');
  if (!charge || !packet) throw new Error('Missing approved ray layers');
  charge.querySelectorAll('path').forEach((el) => {
    el.setAttribute('d', path(from, to));
  });
  const scale = Math.min(
    1,
    Math.max(0.6, length / (kind === 'stat' ? 320 : 55)),
  );
  const widths = (kind === 'stat' ? [12, 4.2, 1.5] : [8, 3.6, 1.4]).map(
    (width) => width * scale,
  );
  const fade = defs.querySelector<SVGLinearGradientElement>(`#${id}-fade`),
    tip = defs.querySelector<SVGLinearGradientElement>(`#${id}-tip`);
  const chargePaths = [...charge.querySelectorAll('path')],
    packetPaths = [...packet.querySelectorAll('path')];
  const head = packet.querySelector('circle');
  if (!fade || !tip || !head) throw new Error('Missing approved ray masks');
  packetPaths.forEach((el) => (el.style.stroke = `url(#${id}-tip)`));
  const wake = (p: number) => {
    const start = point(p),
      softness = Math.min(12, length * 0.08);
    fade.setAttribute('x1', String(start.x));
    fade.setAttribute('y1', String(start.y));
    fade.setAttribute('x2', String(start.x + ux * softness));
    fade.setAttribute('y2', String(start.y + uy * softness));
  };
  const draw = (phase: 'gather' | 'flight', p: number, energy = 0) => {
    if (phase === 'gather') {
      wake(-0.2);
      // 100% is the normal thin guide; the final 400 ms doubles its light, not its width.
      charge.style.opacity = String(kind === 'stat' ? 0.38 * energy : 0);
      chargePaths.forEach(
        (el, i) =>
          (el.style.strokeWidth = `${String((widths[i] ?? 0) * 0.6)}px`),
      );
      packet.style.opacity = '0';
      return;
    }
    const span =
      Math.min(kind === 'stat' ? 84 : 32, length * 0.3) / Math.max(1, length);
    const tail = Math.max(0, p - span * Math.sin(Math.PI * p));
    // A tapered packet clears its wake completely; no full-width luminous tube remains.
    wake(tail);
    charge.style.opacity = '0';
    packet.style.opacity = String(
      Math.min(1, p / 0.04) * Math.min(1, (1 - p) / 0.06),
    );
    const start = point(tail),
      end = point(p);
    tip.setAttribute('x1', String(start.x));
    tip.setAttribute('y1', String(start.y));
    tip.setAttribute('x2', String(end.x));
    tip.setAttribute('y2', String(end.y));
    packetPaths.forEach((el, i) => {
      el.setAttribute('d', path(start, end));
      el.style.strokeWidth = `${String(widths[i] ?? 0)}px`;
    });
    head.setAttribute('cx', String(end.x));
    head.setAttribute('cy', String(end.y));
    head.setAttribute('r', String(1.7 * scale));
    group.dataset.head = p.toFixed(4);
    group.dataset.tail = tail.toFixed(4);
  };
  return {draw};
}
