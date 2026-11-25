// Local time + Spanish formatting helpers. Business rules stay in domain.js (global functions).

const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DOW_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MON_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');

/** Local timestamp with offset, e.g. 2026-11-23T19:05:00-06:00 (the server rejects UTC 'Z'). */
export function nowLocalIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export const todayLocal = () => nowLocalIso().slice(0, 10);
export const uuid = () => crypto.randomUUID();

function parts(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** 'lun 30 nov' */
export function fmtShort(iso) {
  if (!iso) return '';
  const p = parts(iso);
  return `${DOW[p.dow]} ${p.d} ${MON[p.m - 1]}`;
}

/** 'sábado 14 de noviembre' */
export function fmtLong(iso) {
  const p = parts(iso);
  return `${DOW_LONG[p.dow]} ${p.d} de ${MON_LONG[p.m - 1]}`;
}

/** Future: 'hoy', 'mañana', 'en 3 días'. */
export function inDays(n) {
  return n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`;
}

/** Past: 'hoy', 'ayer', 'hace 3 días'. */
export function agoDays(n) {
  return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`;
}

export function hoursLeft(h) {
  const n = Math.max(1, Math.round(h));
  return `quedan ${n} h`;
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** HTML-escape for template strings. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Human description of a milestone's kind. */
export function kindLabel(m) {
  if (m.kind === 'once') return 'Una vez';
  const unit = { day: ['día', 'días'], week: ['semana', 'semanas'], month: ['mes', 'meses'] }[m.interval_unit];
  const every = m.interval_n === 1 ? `Cada ${unit[0]}` : `Cada ${m.interval_n} ${unit[1]}`;
  return `${every} · ${m.anchor === 'rolling' ? 'desde el último' : 'fecha fija'}`;
}
