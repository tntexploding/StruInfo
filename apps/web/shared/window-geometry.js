import './window-geometry.css';
import {icon} from '../data.js';
import {preference, savePreference} from '../runtime/preferences.js';

// Opt-in geometry for reading surfaces. Ordinary dialogs keep their own layout.
export function bindWindowGeometry(
  element,
  {handle, controls, key, minWidth = 560, minHeight = 420},
) {
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'icon-action window-reset';
  resetButton.title = '恢复默认位置和大小';
  resetButton.setAttribute('aria-label', resetButton.title);
  resetButton.innerHTML = icon('refresh');
  controls.prepend(resetButton);
  const resize = document.createElement('button');
  resize.type = 'button';
  resize.className = 'window-resize';
  resize.title = '拖动调整大小；方向键调整';
  resize.setAttribute('aria-label', '调整窗口大小');
  resize.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m7 19 12-12m-6 12 6-6"/></svg>';
  element.append(resize);
  let requested = false,
    enabled = false,
    drag = null;
  let saved = preference(key, null);
  if (
    !saved ||
    !['x', 'y', 'width', 'height'].every((p) => Number.isFinite(saved[p]))
  )
    saved = null;
  const styleKeys = [
    'inset',
    'left',
    'top',
    'width',
    'height',
    'margin',
    'max-width',
    'max-height',
  ];
  const clearStyle = () =>
    styleKeys.forEach((p) => element.style.removeProperty(p));
  const measure = () => {
    const {x, y, width, height} = element.getBoundingClientRect();
    return {x, y, width, height};
  };
  function fit(rect) {
    const gap = 12;
    const width = Math.max(
      Math.min(minWidth, innerWidth - gap * 2),
      Math.min(rect.width, innerWidth - gap * 2),
    );
    const height = Math.max(
      Math.min(minHeight, innerHeight - gap * 2),
      Math.min(rect.height, innerHeight - gap * 2),
    );
    return {
      width,
      height,
      x: Math.max(gap, Math.min(rect.x, innerWidth - gap - width)),
      y: Math.max(gap, Math.min(rect.y, innerHeight - gap - height)),
    };
  }
  function apply(rect) {
    const value = fit(rect);
    Object.assign(element.style, {
      inset: 'auto',
      margin: '0',
      maxWidth: 'none',
      maxHeight: 'none',
      left: value.x + 'px',
      top: value.y + 'px',
      width: value.width + 'px',
      height: value.height + 'px',
    });
    resize.setAttribute(
      'aria-label',
      `调整窗口大小，当前 ${Math.round(value.width)} × ${Math.round(value.height)} 像素`,
    );
    return value;
  }
  function finish() {
    if (!drag) return;
    const {target, id} = drag;
    drag = null;
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    element.classList.remove('window-moving');
    saved = measure();
    savePreference(key, saved);
  }
  function reset() {
    finish();
    saved = null;
    savePreference(key, null);
    clearStyle();
    resize.setAttribute('aria-label', '调整窗口大小');
  }
  function sync() {
    enabled = requested && innerWidth >= 700 && innerHeight >= 480;
    resetButton.hidden = !enabled;
    resize.hidden = !enabled;
    handle.classList.toggle('window-drag-handle', enabled);
    if (enabled) {
      handle.tabIndex = 0;
      handle.setAttribute('aria-label', '窗口标题，拖动或使用方向键移动');
      if (saved) apply(saved);
    } else {
      finish();
      clearStyle();
      handle.removeAttribute('tabindex');
      handle.removeAttribute('aria-label');
    }
  }
  function down(event) {
    if (!enabled || event.button !== 0) return;
    if (
      event.currentTarget === handle &&
      event.target.closest('button,a,input,select,textarea')
    )
      return;
    event.preventDefault();
    drag = {
      id: event.pointerId,
      target: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      rect: measure(),
      resizing: event.currentTarget === resize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({preventScroll: true});
    element.classList.add('window-moving');
  }
  function move(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    const rect = {...drag.rect};
    if (drag.resizing) {
      rect.width = Math.min(rect.width + dx, innerWidth - 12 - rect.x);
      rect.height = Math.min(rect.height + dy, innerHeight - 12 - rect.y);
    } else {
      rect.x += dx;
      rect.y += dy;
    }
    apply(rect);
  }
  function keydown(event) {
    if (
      !enabled ||
      event.target !== event.currentTarget ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    const rect = measure(),
      amount =
        (event.shiftKey ? 40 : 10) *
        (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
    const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
    rect[
      event.currentTarget === resize
        ? horizontal
          ? 'width'
          : 'height'
        : horizontal
          ? 'x'
          : 'y'
    ] += amount;
    saved = apply(rect);
    savePreference(key, saved);
  }
  for (const target of [handle, resize]) {
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
    target.addEventListener('lostpointercapture', finish);
    target.addEventListener('keydown', keydown);
  }
  resetButton.onclick = reset;
  window.addEventListener('resize', sync);
  window.addEventListener('workspace-ready', () => {
    saved = preference(key, null);
    if (requested) {
      clearStyle();
      sync();
    }
  });
  sync();
  return {
    setEnabled(value) {
      finish();
      requested = value;
      sync();
    },
  };
}
