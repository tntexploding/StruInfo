import {escape} from '../data.js';
let activeDialog;
const host = document.querySelector('#notice-host');
function returnToPage() {
  activeDialog?.removeEventListener('close', returnToPage);
  activeDialog = undefined;
  const visible = !host.hidden;
  host.hidePopover();
  document.body.append(host);
  if (visible) host.showPopover();
}
export function notice(text, {kind = 'success'} = {}) {
  host.hidePopover();
  activeDialog?.removeEventListener('close', returnToPage);
  activeDialog = document.querySelector('dialog:modal');
  (activeDialog || document.body).append(host);
  activeDialog?.addEventListener('close', returnToPage, {once: true});
  clearTimeout(notice.timer);
  host.hidden = false;
  host.dataset.kind = kind;
  host.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  host.innerHTML =
    '<span>' +
    escape(text) +
    '</span><button type="button" aria-label="关闭通知">×</button>';
  host.querySelector('button').onclick = () => {
    host.hidePopover();
    host.hidden = true;
  };
  host.showPopover();
  if (kind !== 'error')
    notice.timer = setTimeout(() => {
      host.hidePopover();
      host.hidden = true;
    }, 4000);
}
