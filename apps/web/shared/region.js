import {escape} from '../data.js';
export function regionState(host, {kind, title, text = '', retry}) {
  host.setAttribute('aria-busy', String(kind === 'loading'));
  host.innerHTML =
    '<div class="region-state" data-state="' +
    kind +
    '" ' +
    (kind === 'error' ? 'role="alert"' : 'role="status"') +
    '><strong>' +
    escape(title) +
    '</strong>' +
    (text ? '<p>' + escape(text) + '</p>' : '') +
    (retry
      ? '<button type="button" class="secondary-action">重新读取</button>'
      : '') +
    '</div>';
  if (retry) host.querySelector('button').onclick = retry;
}
