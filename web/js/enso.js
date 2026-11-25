// Ensō rings with a brush finish, returned as SVG markup strings.
//   ensoSVG: progress (sumi, fills clockwise from ~10 o'clock, max 330° so it stays open).
//   timerSVG: temporal ensō (vermilion, starts full, its end retreats counterclockwise to 12 o'clock;
//             the 24-hour scale adds a center dot). Input comes from domain timerOf().
// The ink is a filled shape with a pressure profile (press-in, body, lift-off taper) and a slight
// radius wobble. Rings ≥ 40 px get a grainy edge ONLY where the brush lands and lifts; the body is clean.

const SPAN = 330;

const rad = (deg) => deg * Math.PI / 180;
const pt = (c, r, deg) => [c + r * Math.cos(rad(deg)), c + r * Math.sin(rad(deg))];
const f = (n) => n.toFixed(2);

function arc(c, r, from, sweep) {
  const a = pt(c, r, from), b = pt(c, r, from + sweep);
  return `M${f(a[0])} ${f(a[1])} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${f(b[0])} ${f(b[1])}`;
}

function pressure(t) {
  if (t < 0.08) return 0.7 + 0.3 * (t / 0.08);
  if (t < 0.55) return 1;
  const k = (t - 0.55) / 0.45;
  return 1 - 0.68 * k * k;
}

// Deterministic noise in [-1, 1].
const noise = (i, seed) => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

// 1 at the tips, 0 along the body.
function grainAt(t) {
  const k = Math.max(0, 1 - t / 0.09, (t - 0.84) / 0.16);
  return k * k * (3 - 2 * k);
}

function brushPath(c, r, from, sweep, wMax, seed, grain) {
  const len = rad(sweep) * r;
  const n = Math.max(12, Math.ceil(sweep / 3), grain ? Math.ceil(len / 1.3) : 0);
  const at = (i) => {
    const t = i / n, a = from + sweep * t;
    const rr = r * (1 + 0.025 * Math.sin(seed + rad(a) * 2) + 0.012 * Math.sin(seed * 1.7 + rad(a) * 5));
    const w = wMax * pressure(t);
    return { a, rr, w, g: grain ? w * 0.16 * grainAt(t) : 0 };
  };
  const outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const { a, rr, w, g } = at(i);
    outer.push(pt(c, rr + w / 2 + g * noise(i, seed), a));
    inner.push(pt(c, rr - w / 2 + g * noise(i + 900, seed), a));
  }
  // Rounded tips: half circle of k points, roughened when grain is on.
  const cap = (i, dir) => {
    const { a, rr, w, g } = at(i);
    const pts = [], k = 7;
    for (let j = 1; j < k; j++) {
      const phi = Math.PI * j / k, h = w / 2;
      const along = dir * (h * Math.sin(phi) + g * noise(j + 70 + i, seed));
      pts.push(pt(c, rr + dir * h * Math.cos(phi), a + along / rr * 180 / Math.PI));
    }
    return pts;
  };
  const all = [...outer, ...cap(n, 1), ...inner.reverse(), ...cap(0, -1)];
  return `M${all.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L')} Z`;
}

const widthFor = (size) => (size >= 80 ? 7 : size >= 40 ? 4.4 : size >= 20 ? 2.8 : 2.3);

/** Stable seed from any string (ids), so a ring's wobble never changes between renders. */
export function seedOf(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(h) % 1000) / 100;
}

function ring({ size, start, fraction, seed, cls, extra = '', label }) {
  const w = widthFor(size), c = size / 2, r = c - w / 2 - 1;
  const ink = fraction > 0
    ? `<path class="ink" d="${brushPath(c, r, start, Math.max(6, SPAN * fraction), w, seed, size >= 40)}"/>` : '';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}">` +
    `<path class="trace" d="${arc(c, r, start, SPAN)}"/>${ink}${extra}</svg>`;
}

/** progress 0..1, or state 'ok' | 'overdue' for recurring-only projects. */
export function ensoSVG({ size = 44, progress = 0, state = null, seed = 1 }) {
  const fraction = state ? 1 : Math.max(0, Math.min(1, progress));
  const label = state === 'overdue' ? 'Recurrente con vencidos' : state === 'ok' ? 'Recurrente al día' : `Progreso ${Math.round(fraction * 100)} %`;
  return ring({ size, start: -112, fraction, seed, cls: `enso${state === 'overdue' ? ' is-overdue' : ''}`, label });
}

/** timer = domain timerOf() result; returns '' when null. */
export function timerSVG({ size = 20, timer, seed = 1, inline = false }) {
  if (!timer) return '';
  const c = size / 2;
  const dot = timer.scale === 'day' ? `<circle class="dot" cx="${c}" cy="${c}" r="${Math.max(1.5, size / 14)}"/>` : '';
  const label = timer.scale === 'day' ? `Quedan ${Math.round(timer.hours_left)} horas` : `Quedan ${Math.round(timer.hours_left / 24)} días`;
  return ring({ size, start: -90, fraction: timer.fraction, seed, cls: `timer${inline ? ' inline' : ''}`, extra: dot, label });
}
