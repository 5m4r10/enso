// Ensō rings for the mockups, with a brush finish.
//
// Progress ensō:  <svg class="enso" data-progress="0.43" data-size="44"></svg>
//   Always open: the arc spans at most 330°, starts near 10 o'clock and fills clockwise.
//   data-state="ok|overdue" is for recurring-only projects (full arc, sumi or shu).
//
// Temporal ensō (timer): <svg class="timer" data-due="2026-11-25" data-size="20"></svg>
//   Vermilion arc that starts full and empties counterclockwise (its end retreats toward 12 o'clock).
//   Deadline = end of the due day (00:00 of due+1), consistent with isOverdue (due < today).
//   Two scales: remaining > 24 h → 7-day scale (clamped to full); remaining ≤ 24 h → refills on a
//   24-hour scale. The 24-hour scale adds a center dot so the refill is not misread.
//   Outside the 7-day window or past the deadline nothing is drawn.
//
// Brush: the ink is a filled shape, not a stroke. Width follows a pressure profile (press-in,
// body, lift-off taper) and the radius wobbles slightly (deterministic per ring). Rings ≥ 40 px
// also get an SVG turbulence filter for a rough, ink-on-washi edge. Angular extent is exact.
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var SPAN = 330;
  var MOCK_NOW = new Date(2026, 10, 23, 10, 0, 0).getTime(); // lunes 23 nov, 10:00
  var H = 3600000, WEEK = 7 * 24 * H, DAY = 24 * H;
  var uid = 0;

  function rad(deg) { return deg * Math.PI / 180; }
  function pt(cx, cy, r, deg) { return [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))]; }
  function f(n) { return n.toFixed(2); }
  function arc(cx, cy, r, from, sweep) {
    var a = pt(cx, cy, r, from), b = pt(cx, cy, r, from + sweep);
    return 'M' + f(a[0]) + ' ' + f(a[1]) + ' A' + r + ' ' + r + ' 0 ' + (sweep > 180 ? 1 : 0) + ' 1 ' + f(b[0]) + ' ' + f(b[1]);
  }
  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function frame(svg, size) {
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.style.overflow = 'visible';
  }

  /** Pressure along the stroke, t ∈ [0,1]: quick press-in, full body, long lift-off taper. */
  function pressure(t) {
    if (t < 0.08) return 0.7 + 0.3 * (t / 0.08);
    if (t < 0.55) return 1;
    var k = (t - 0.55) / 0.45;
    return 1 - 0.68 * k * k;
  }

  /**
   * Filled brush arc. `seed` makes the wobble stable per ring.
   * Short arcs (small fractions) keep a visible taper by compressing the profile.
   */
  function brushPath(cx, cy, r, from, sweep, wMax, seed) {
    var n = Math.max(12, Math.ceil(sweep / 3));
    var outer = [], inner = [], widths = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var a = from + sweep * t;
      var wob = 1 + 0.025 * Math.sin(seed + rad(a) * 2) + 0.012 * Math.sin(seed * 1.7 + rad(a) * 5);
      var rr = r * wob;
      var w = wMax * pressure(t);
      widths.push(w);
      outer.push(pt(cx, cy, rr + w / 2, a));
      inner.push(pt(cx, cy, rr - w / 2, a));
    }
    var d = 'M' + f(outer[0][0]) + ' ' + f(outer[0][1]);
    for (i = 1; i <= n; i++) d += ' L' + f(outer[i][0]) + ' ' + f(outer[i][1]);
    var we = widths[n] / 2, ws = widths[0] / 2;
    d += ' A' + f(we) + ' ' + f(we) + ' 0 0 1 ' + f(inner[n][0]) + ' ' + f(inner[n][1]);
    for (i = n - 1; i >= 0; i--) d += ' L' + f(inner[i][0]) + ' ' + f(inner[i][1]);
    d += ' A' + f(ws * 0.9) + ' ' + f(ws) + ' 0 0 1 ' + f(outer[0][0]) + ' ' + f(outer[0][1]) + ' Z';
    return d;
  }

  function addTexture(svg, size) {
    if (size < 40) return null;
    var id = 'brush' + (++uid);
    var defs = el('defs', {});
    var filt = el('filter', { id: id, x: '-10%', y: '-10%', width: '120%', height: '120%' });
    filt.appendChild(el('feTurbulence', { type: 'fractalNoise', baseFrequency: (1.7 / Math.sqrt(size)).toFixed(3), numOctaves: 2, seed: uid * 7 }));
    filt.appendChild(el('feDisplacementMap', { 'in': 'SourceGraphic', scale: (size / 52).toFixed(2), xChannelSelector: 'R', yChannelSelector: 'G' }));
    defs.appendChild(filt);
    svg.appendChild(defs);
    return 'url(#' + id + ')';
  }

  function widthFor(size) {
    return size >= 80 ? 7 : size >= 40 ? 4.4 : size >= 20 ? 2.8 : 2.3;
  }

  function hashSeed(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h % 1000) / 100;
  }

  /** {scale:'week'|'day', fraction} or null. Will become a pure domain function (now passed in). */
  function timerOf(dueIso, nowMs) {
    var p = dueIso.split('-');
    var deadline = new Date(+p[0], +p[1] - 1, +p[2] + 1).getTime();
    var left = deadline - nowMs;
    if (left <= 0) return null;
    if (left <= DAY) return { scale: 'day', fraction: left / DAY, hours: left / H };
    if (left > WEEK + DAY) return null; // beyond the upcoming window
    return { scale: 'week', fraction: Math.min(1, left / WEEK), hours: left / H };
  }
  window.timerOf = timerOf;

  function drawRing(svg, size, start, fraction, seed) {
    var w = widthFor(size), c = size / 2, r = c - w / 2 - 1;
    frame(svg, size);
    svg.appendChild(el('path', { 'class': 'trace', d: arc(c, c, r, start, SPAN) }));
    if (fraction <= 0) return;
    var filter = addTexture(svg, size);
    var ink = el('path', { 'class': 'ink', d: brushPath(c, c, r, start, Math.max(6, SPAN * fraction), w, seed) });
    if (filter) ink.setAttribute('filter', filter);
    svg.appendChild(ink);
    return { c: c };
  }

  document.querySelectorAll('svg.enso').forEach(function (svg, i) {
    var size = +(svg.dataset.size || 44);
    var state = svg.dataset.state;
    var p = state ? 1 : Math.max(0, Math.min(1, +svg.dataset.progress || 0));
    if (state === 'overdue') svg.classList.add('is-overdue');
    drawRing(svg, size, -112, p, 1.3 + i * 2.1);
  });

  document.querySelectorAll('svg.timer').forEach(function (svg) {
    var size = +(svg.dataset.size || 20);
    var t = timerOf(svg.dataset.due, MOCK_NOW);
    if (!t) { frame(svg, size); svg.style.visibility = 'hidden'; return; }
    svg.dataset.scale = t.scale;
    svg.dataset.fraction = t.fraction.toFixed(3);
    var g = drawRing(svg, size, -90, t.fraction, hashSeed(svg.dataset.due));
    if (t.scale === 'day') svg.appendChild(el('circle', { 'class': 'dot', cx: g.c, cy: g.c, r: Math.max(1.5, size / 14) }));
  });
})();
