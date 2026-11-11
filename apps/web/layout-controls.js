import {preference, savePreference} from './runtime/preferences.js';
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function createLayoutPreferences(key, defaults, ranges) {
  let saved = {};
  try {
    saved = preference(key, {});
  } catch {
    /* Local display preferences are optional. */
  }
  const values = {...defaults};
  function assign(name, value) {
    const n = Number(value),
      r = ranges[name];
    if (r && Number.isFinite(n)) values[name] = clamp(n, r[0], r[1]);
  }
  Object.keys(defaults).forEach((name) =>
    assign(name, saved[name] ?? defaults[name]),
  );
  const persist = () => {
    try {
      savePreference(key, values);
    } catch {
      /* Local display preferences are optional. */
    }
  };
  return {
    values,
    set(name, value, save = true) {
      assign(name, value);
      if (save) persist();
    },
    persist,
    reset() {
      Object.assign(values, defaults);
      persist();
    },
  };
}
export function bindDivider(
  el,
  {
    label,
    getValue,
    getBounds,
    setValue,
    commit = () => {},
    direction = 1,
    axis = 'x',
    reset,
  },
) {
  el.classList.add('column-divider');
  el.tabIndex = 0;
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-orientation', axis === 'y' ? 'horizontal' : 'vertical');
  el.setAttribute('aria-label', label);
  el.title = label + '；拖动或使用方向键，双击恢复';
  let drag = null;
  function refresh() {
    const [min, max] = getBounds();
    el.setAttribute('aria-valuemin', String(Math.round(min)));
    el.setAttribute('aria-valuemax', String(Math.round(max)));
    el.setAttribute('aria-valuenow', String(Math.round(getValue())));
    el.setAttribute('aria-valuetext', Math.round(getValue()) + ' 像素');
  }
  function update(value) {
    const [min, max] = getBounds();
    setValue(clamp(value, min, max));
    refresh();
  }
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = {
      id: e.pointerId,
      x: axis === 'y' ? e.clientY : e.clientX,
      value: getValue(),
    };
    el.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-columns');
    el.classList.add('is-dragging');
    el.focus({preventScroll: true});
  };
  const move = (e) => {
    if (drag && drag.id === e.pointerId)
      update(
        drag.value +
          ((axis === 'y' ? e.clientY : e.clientX) - drag.x) * direction,
      );
  };
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const id = drag.id;
    drag = null;
    if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    document.body.classList.remove('resizing-columns');
    el.classList.remove('is-dragging');
    commit();
  };
  const key = (e) => {
    const arrows =
      axis === 'y' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (![...arrows, 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const [min, max] = getBounds();
    update(
      e.key === 'Home'
        ? min
        : e.key === 'End'
          ? max
          : getValue() +
            (e.key === arrows[1] ? 1 : -1) * direction * (e.shiftKey ? 32 : 16),
    );
    commit();
  };
  const dbl = () => {
    reset?.();
    refresh();
    commit();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('keydown', key);
  el.addEventListener('dblclick', dbl);
  refresh();
  return {
    refresh,
    destroy() {
      if (drag) end({pointerId: drag.id});
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      el.removeEventListener('keydown', key);
      el.removeEventListener('dblclick', dbl);
    },
  };
}
export function rangeField(key, label, value, min, max, step, unit) {
  return `<label class="layout-range"><span>${label}<output data-layout-output="${key}">${value}${unit}</output></span><input type="range" data-layout-setting="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}
export function bindRanges(scope, prefs, apply) {
  scope.querySelectorAll('[data-layout-setting]').forEach((input) =>
    input.addEventListener('input', () => {
      prefs.set(input.dataset.layoutSetting, input.value);
      scope.querySelector(
        `[data-layout-output="${input.dataset.layoutSetting}"]`,
      ).textContent = Number(input.value) + input.dataset.unit;
      apply();
    }),
  );
}
