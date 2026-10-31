import {paintIcons} from '../data.js';
export function bindDialog(
  element,
  {closeButtons = [], initialFocus, beforeClose, closeOnBackdrop = false} = {},
) {
  let focus;
  const open = (trigger = document.activeElement) => {
    if (!element.open) {
      focus = trigger;
      element.showModal();
    }
    const target =
      typeof initialFocus === 'function' ? initialFocus() : initialFocus;
    target?.focus({preventScroll: true});
  };
  const close = () => {
    if (!element.open) return true;
    if (beforeClose?.() === false) return false;
    element.close();
    return true;
  };
  element.addEventListener('close', () => {
    const target = typeof focus === 'function' ? focus() : focus;
    if (target?.isConnected) target.focus({preventScroll: true});
  });
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  if (closeOnBackdrop)
    element.addEventListener('click', (event) => {
      if (event.target !== element) return;
      const rect = element.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        close();
    });
  for (const button of closeButtons)
    button.addEventListener('click', (event) => {
      event.preventDefault();
      close();
    });
  return {open, close};
}
export function createDialog(
  root,
  {
    dialogId = 'dialog',
    titleId = 'dialog-title',
    bodyId = 'dialog-body',
    closeId = 'dialog-close',
  } = {},
) {
  const el = root.querySelector('#' + dialogId);
  const bound = bindDialog(el, {
    closeButtons: [root.querySelector('#' + closeId)],
  });
  return {
    closeDialog: bound.close,
    dialog(title, html, setup = () => {}) {
      root.querySelector('#' + titleId).textContent = title;
      const body = root.querySelector('#' + bodyId);
      body.innerHTML = html;
      paintIcons(body);
      setup(body);
      bound.open();
    },
  };
}
