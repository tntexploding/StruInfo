const key = 'struinfo.ui.v2';
let workspace = 'local';
let cache = {};
try {
  cache = JSON.parse(localStorage.getItem(key) || '{}');
} catch {
  // Malformed or unavailable storage uses the in-memory defaults.
}
export function setPreferenceWorkspace(id) {
  workspace = id || 'local';
  cache.currentWorkspace = workspace;
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // The current page keeps working when browser storage is unavailable.
  }
  window.dispatchEvent(new Event('workspace-ready'));
}
workspace = cache.currentWorkspace || 'local';
export function preference(name, fallback = {}) {
  return structuredClone(cache.workspaces?.[workspace]?.[name] ?? fallback);
}
export function savePreference(name, value) {
  cache.version = 2;
  cache.workspaces ??= {};
  cache.workspaces[workspace] ??= {};
  cache.workspaces[workspace][name] = structuredClone(value);
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Keep this session's preference even if it cannot persist across reloads.
  }
}
