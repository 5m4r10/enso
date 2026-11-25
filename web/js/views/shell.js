import { esc, fmtLong } from '../format.js';
import { today } from '../store.js';

const LINKS = [['review', 'Revisión'], ['capture', 'Captura'], ['vault', 'Bóveda']];

export function header(current, crumb = '') {
  const nav = LINKS.filter(([k]) => k !== current || current === 'project')
    .map(([k, t]) => `<a href="#${k}"${k === current ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  const sub = crumb || `<span class="date">${esc(fmtLong(today()))}</span>`;
  return `<header class="top"><a class="mark" href="#review">Enso</a>${sub}<nav>${nav}</nav></header>`;
}
