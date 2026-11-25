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

// Brush ribbon along samples {x, y, nx, ny, t} (unit normal, t 0..1): pressure profile, rough tips.
function ribbon(samples, wMax, seed, grain) {
  const n = samples.length - 1;
  const at = (i) => {
    const s = samples[i], w = wMax * pressure(s.t);
    return { ...s, w, g: grain ? w * 0.16 * grainAt(s.t) : 0 };
  };
  const outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const { x, y, nx, ny, w, g } = at(i);
    const a = w / 2 + g * noise(i, seed), b = -w / 2 + g * noise(i + 900, seed);
    outer.push([x + nx * a, y + ny * a]);
    inner.push([x + nx * b, y + ny * b]);
  }
  // Rounded tips: half circle of k points, roughened when grain is on.
  const cap = (i, dir) => {
    const { x, y, nx, ny, w, g } = at(i);
    const pts = [], k = 7;
    for (let j = 1; j < k; j++) {
      const phi = Math.PI * j / k, across = dir * w / 2 * Math.cos(phi);
      const along = dir * (w / 2 * Math.sin(phi) + g * noise(j + 70 + i, seed));
      pts.push([x + nx * across - ny * along, y + ny * across + nx * along]);
    }
    return pts;
  };
  const all = [...outer, ...cap(n, 1), ...inner.reverse(), ...cap(0, -1)];
  return `M${all.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L')} Z`;
}

function brushPath(c, r, from, sweep, wMax, seed, grain) {
  const n = Math.max(12, Math.ceil(sweep / 3), grain ? Math.ceil(rad(sweep) * r / 1.3) : 0);
  const samples = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = from + sweep * t;
    const rr = r * (1 + 0.025 * Math.sin(seed + rad(a) * 2) + 0.012 * Math.sin(seed * 1.7 + rad(a) * 5));
    const [x, y] = pt(c, rr, a);
    samples.push({ x, y, nx: Math.cos(rad(a)), ny: Math.sin(rad(a)), t });
  }
  return ribbon(samples, wMax, seed, grain);
}

/** Any stroke with the ensō brush. points: polyline whose corners are rounded by `round`. */
function brushStroke(points, { width, seed, round = 1.6, wobble = 0.09 }) {
  const path = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [p, q, s] = [points[i - 1], points[i], points[i + 1]];
    const toward = (o) => {
      const d = Math.hypot(o[0] - q[0], o[1] - q[1]), k = Math.min(round, d / 2) / d;
      return [q[0] + (o[0] - q[0]) * k, q[1] + (o[1] - q[1]) * k];
    };
    const a = toward(p), b = toward(s);
    for (let j = 0; j <= 8; j++) {
      const u = j / 8, v = 1 - u;
      path.push([v * v * a[0] + 2 * v * u * q[0] + u * u * b[0], v * v * a[1] + 2 * v * u * q[1] + u * u * b[1]]);
    }
  }
  path.push(points.at(-1));
  const len = [0];
  for (let i = 1; i < path.length; i++) len.push(len[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = len.at(-1), n = Math.max(12, Math.ceil(total / 0.5));
  const pos = (d) => {
    let i = 1;
    while (i < path.length - 1 && len[i] < d) i++;
    const k = (d - len[i - 1]) / (len[i] - len[i - 1] || 1);
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k];
  };
  const samples = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, d = total * t;
    const [x, y] = pos(d), a = pos(Math.max(0, d - 0.4)), b = pos(Math.min(total, d + 0.4));
    const h = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / h, ny = -(b[0] - a[0]) / h;
    const o = wobble * (Math.sin(seed + d * 0.35) + 0.5 * Math.sin(seed * 1.7 + d * 0.8));
    samples.push({ x: x + nx * o, y: y + ny * o, nx, ny, t });
  }
  return ribbon(samples, width, seed, false);
}

/* Icons, 16 × 16 units, drawn with the same brush: [width, points]. */
const ICONS = {
  // Sheet with a cut corner, left open like the ensō, and two written lines.
  note: [
    [1.35, [[9.2, 13.6], [13.4, 9.4], [13.4, 2.4], [2.6, 2.4], [2.6, 13.6], [7.4, 13.6]]],
    [1.2, [[5.4, 6.1], [10.6, 6.0]]],
    [1.2, [[5.4, 9.1], [8.6, 9.0]]]
  ],
  // One stroke, left open before it closes.
  shield: [[1.4, [[5.6, 2.7], [8, 1.5], [13.3, 3.3], [13.1, 8.2], [11.3, 11.9], [8, 14.5], [4.7, 11.9], [2.9, 8.2], [2.7, 4.6]]]]
};

export function brushIcon(name, size = 20) {
  const d = ICONS[name].map(([width, points], i) => brushStroke(points, { width, seed: 2.3 + i * 1.9 })).join(' ');
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
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
