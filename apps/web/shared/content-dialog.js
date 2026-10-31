import './assistant-surfaces.css';
import {icon, paintIcons} from '../data.js';
import {bindDialog} from './dialog.js';
import {bindWindowGeometry} from './window-geometry.js';

let instance;
// One shell-level surface for the assistant's pickers and both report entry points.
export function openContentDialog(
  title,
  content,
  {view = 'default', actions = '', setup = () => {}, trigger} = {},
) {
  if (!instance) {
    const element = document.createElement('dialog');
    element.id = 'content-dialog';
    element.className = 'ef-glass ef-app assistant-ui';
    element.setAttribute('aria-labelledby', 'content-dialog-title');
    element.innerHTML = `<header class="dialog-head"><h2 id="content-dialog-title"></h2><div class="modal-controls"><div id="content-dialog-actions"></div><button class="icon-action" id="close-modal" aria-label="关闭">${icon('close')}</button></div></header><div id="content-dialog-content"></div>`;
    document.body.append(element);
    const bound = bindDialog(element, {
      closeButtons: [element.querySelector('#close-modal')],
      beforeClose: () => geometry.setEnabled(false),
    });
    const geometry = bindWindowGeometry(element, {
      handle: element.querySelector('.dialog-head'),
      controls: element.querySelector('.modal-controls'),
      key: 'report-window',
      minWidth: 640,
    });
    element.addEventListener('close', () => geometry.setEnabled(false));
    instance = {element, geometry, ...bound};
  }
  const {element} = instance;
  instance.geometry.setEnabled(false);
  element.dataset.view = view;
  element.querySelector('#content-dialog-title').textContent = title;
  element.querySelector('#content-dialog-content').innerHTML = content;
  element.querySelector('#content-dialog-actions').innerHTML = actions;
  paintIcons(element);
  setup(element, instance.close);
  instance.open(trigger);
  instance.geometry.setEnabled(view === 'report');
  element.querySelector('#content-dialog-content').scrollTop = 0;
  return instance;
}
