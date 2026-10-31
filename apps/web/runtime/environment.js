import {request} from './api.js';
import {
  preference,
  savePreference,
  setPreferenceWorkspace,
} from './preferences.js';
export let localAppearance = preference('appearance', {});
export function saveAppearance(value) {
  localAppearance = {...value};
  savePreference('appearance', value);
  applyAppearance(value);
}
export function applyAppearance(value) {
  const light =
    (value.theme ?? 'system') === 'light' ||
    ((value.theme ?? 'system') === 'system' &&
      matchMedia('(prefers-color-scheme: light)').matches);
  const attrs = {
    theme: light ? 'light' : 'dark',
    glass: value.glass === false ? 'off' : 'on',
    glow: value.glow === 0 ? 'off' : 'on',
    effects: value.glow === 0 ? 'off' : 'on',
    motion: value.motion === false ? 'off' : 'on',
    flowMotion: value.flowMotion === false ? 'off' : 'on',
  };
  for (const el of [
    document.body,
    ...document.querySelectorAll('.page-root'),
  ]) {
    Object.assign(el.dataset, attrs);
    el.classList.toggle('no-motion', value.motion === false);
  }
  document.body.style.setProperty(
    '--ef-strength',
    String((value.glow ?? 70) / 100),
  );
  document.body.style.setProperty(
    '--reading-font-size',
    (value.readingSize ?? 20) + 'px',
  );
  document.body.style.setProperty(
    '--reading-measure',
    (value.readingMeasure ?? 88) / 2 + 'em',
  );
  window.dispatchEvent(new Event('motion-change'));
}
export function initializeEnvironment() {
  applyAppearance(localAppearance);
  const scheme = matchMedia('(prefers-color-scheme: light)');
  scheme.addEventListener('change', () => applyAppearance(localAppearance));
  return request('workspace')
    .then((result) => {
      setPreferenceWorkspace(result.workspaceId);
      localAppearance = preference('appearance', {});
      applyAppearance(localAppearance);
      return request('preferences/interface');
    })
    .then((result) => {
      localAppearance = {
        ...localAppearance,
        theme: result.preferences?.theme ?? localAppearance.theme,
      };
      applyAppearance(localAppearance);
    })
    .catch(() => {});
}
