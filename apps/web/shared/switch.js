import {escape} from '../data.js';

export function switchInput({
  checked = false,
  disabled = false,
  id = '',
  data = {},
}) {
  const bindings = Object.entries(data)
    .map(([key, value]) => `data-${escape(key)}="${escape(value)}"`)
    .join(' ');
  return `<input class="switch" type="checkbox" role="switch" ${id ? `id="${escape(id)}"` : ''} ${bindings} ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>`;
}
