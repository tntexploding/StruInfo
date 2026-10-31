// Motion preference used by the approved canvas animation.
export const motionAllowed = () =>
  !matchMedia('(prefers-reduced-motion: reduce)').matches &&
  !document.body.classList.contains('no-motion');
