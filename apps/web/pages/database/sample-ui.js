import {pageContext} from '../../runtime/route.js';
const page = pageContext('database');
import {paintIcons} from '../../data.js';
import {bindDialog} from '../../shared/dialog.js';
export const $ = (selector, root = page.root) => root.querySelector(selector);
export const all = (selector, root = page.root) => [
  ...root.querySelectorAll(selector),
];
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ],
  );
const dialog = $('#sample-dialog');
const bound = bindDialog(dialog, {
  closeButtons: [$('#dialog-close')],
  closeOnBackdrop: true,
  initialFocus: () =>
    $(
      '#sample-dialog-body input:not(:disabled),#sample-dialog-body select:not(:disabled),#dialog-close',
    ),
});
export {notice as toast} from '../../shared/notice.js';
export function openDialog(title, html, setup = () => {}) {
  $('#sample-dialog-title').textContent = title;
  $('#sample-dialog-body').innerHTML = html;
  paintIcons(dialog);
  setup($('#sample-dialog-body'));
  bound.open();
}
export const closeDialog = bound.close;
export function field(label, control, wide = false) {
  return (
    '<label class="sample-field' +
    (wide ? ' wide' : '') +
    '"><span>' +
    label +
    '</span>' +
    control +
    '</label>'
  );
}
export function options(rows) {
  return rows
    .map(
      ([value, label]) =>
        '<option value="' +
        escapeHtml(value) +
        '">' +
        escapeHtml(label) +
        '</option>',
    )
    .join('');
}
