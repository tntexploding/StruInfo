export const icons = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  sources: 'M4 4h16v16H4z M4 14h5l2 3h2l2-3h5 M12 2v9 m-3-3 3 3 3-3',
  layers: 'm3 6 9-4 9 4-9 4-9-4m0 6 9 4 9-4M3 18l9 4 9-4',
  database:
    'M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0',
  settings:
    'm9 3 6 0 1 4 4 1 1 6-4 2-1 4-6 1-2-4-4-1-1-6 4-2z M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  close: 'm5 5 14 14M5 19 19 5',
  plus: 'M12 4v16M4 12h16',
  play: 'm8 4 12 8-12 8z',
  pause: 'M8 5v14M16 5v14',
  file: 'M5 3h10l4 4v14H5z M15 3v5h4 M8 12h8 M8 16h6',
  split: 'M5 3h14v18H5z M8 8h8 M3 12h4m3 0h4m3 0h4 M8 17h8',
  tag: 'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  link: 'm9 15 6-6 M8 6l2-2a5 5 0 0 1 7 7l-2 2M9 11l-2 2a5 5 0 0 0 7 7l2-2',
  report: 'M5 3h14v18H5z M8 7h8M8 11h8 M8 15h4 M8 18h6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v6l4 2',
  alert: 'm12 3 10 18H2z M12 9v5m0 3v.1',
  filter: 'M3 5h18M6 12h12M9 19h6',
  globe:
    'M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  bolt: 'm13 2-8 12h6l-1 8 9-12h-6z',
  edit: 'm14 3 7 7-11 11H3v-7z M12 5l7 7',
  external: 'M14 3h7v7m0-7L10 14M10 5H4v15h15v-6',
  refresh: 'M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
  folder: 'M3 6h7l2 3h9v11H3z',
  upload: 'M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6',
  chevron: 'm9 5 7 7-7 7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7m7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.file}"/></svg>`;
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ],
  );
export function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
