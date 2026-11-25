/*
 * domain.js — pure domain rules, shared by the PWA and Apps Script.
 *
 * Constraints (so the same file runs in browser, Node and Apps Script):
 *   - No import/export, no DOM, no Date.now(): `today` is always passed in.
 *   - Dates are ISO strings 'YYYY-MM-DD'; arithmetic is done in UTC to avoid TZ drift.
 *   - The Node export at the bottom is guarded, Apps Script ignores it.
 */

var UPCOMING_WINDOW_DAYS = 7;
var DEFAULT_STALE_DAYS = 14;
/** Log types that are bookkeeping, not progress: they never reset staleness. */
var NON_ACTIVITY_LOG_TYPES = { vault: true, reschedule: true };

function countsAsActivity(log) {
  return !NON_ACTIVITY_LOG_TYPES[log.type];
}

/* ---------- date helpers ---------- */

function parseISO(iso) {
  var p = String(iso).slice(0, 10).split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((parseISO(toIso) - parseISO(fromIso)) / 86400000);
}

/** Adds n units to a date. Months clamp to end of month (Jan 31 + 1m = Feb 28/29). */
function addInterval(iso, n, unit) {
  var d = new Date(parseISO(iso));
  if (unit === 'day') return toISO(d.getTime() + n * 86400000);
  if (unit === 'week') return toISO(d.getTime() + n * 7 * 86400000);
  if (unit === 'month') {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return toISO(Date.UTC(y, m, Math.min(day, lastDay)));
  }
  throw new Error('Unknown interval unit: ' + unit);
}

/* ---------- milestone rules ---------- */

/**
 * Computes the state change when a milestone is completed.
 * @param m        milestone {kind, next_due, due_date, interval_n, interval_unit, anchor}
 * @param doneDate ISO date of completion
 * @param anchor   'fixed' | 'rolling' (override; defaults to m.anchor)
 * @returns {status, next_due, last_done_at, skipped_cycles}
 *
 * Fixed anchor, late completion: advance cycles until the first date AFTER doneDate
 * (decision A). Missed cycles are counted, not demanded.
 */
function completeMilestone(m, doneDate, anchor) {
  if (m.kind === 'once') {
    return { status: 'done', next_due: null, last_done_at: doneDate, skipped_cycles: 0 };
  }
  var a = anchor || m.anchor;
  if (a === 'rolling') {
    return {
      status: 'open',
      next_due: addInterval(doneDate, m.interval_n, m.interval_unit),
      last_done_at: doneDate,
      skipped_cycles: 0
    };
  }
  if (a !== 'fixed') throw new Error('Unknown anchor: ' + a);

  var base = m.next_due || m.due_date || doneDate;
  var next = addInterval(base, m.interval_n, m.interval_unit);
  var advances = 1;
  while (parseISO(next) <= parseISO(doneDate)) {
    next = addInterval(next, m.interval_n, m.interval_unit);
    advances++;
  }
  return { status: 'open', next_due: next, last_done_at: doneDate, skipped_cycles: advances - 1 };
}

/** Both outcomes, for the dual-button UI ("✓ Hecho · próximo X" / "reprogramar → Y"). */
function previewCompletion(m, doneDate) {
  if (m.kind === 'once') return null;
  return {
    fixed: completeMilestone(m, doneDate, 'fixed'),
    rolling: completeMilestone(m, doneDate, 'rolling')
  };
}

function dueOf(m) {
  return m.kind === 'once' ? (m.due_date || null) : (m.next_due || null);
}

function isOverdue(m, today) {
  var due = dueOf(m);
  return m.status === 'open' && !!due && parseISO(due) < parseISO(today);
}

/* ---------- project rules ---------- */

/** Address of one Google Keep note or list, as copied from keep.google.com. */
function isKeepNoteUrl(s) {
  return typeof s === 'string' && /^https:\/\/keep\.google\.com\/(u\/\d{1,2}\/)?#(NOTE|LIST)\/[A-Za-z0-9._-]{1,200}$/.test(s);
}

/**
 * Last activity = latest activity-log ts for the project (vault/reschedule excluded),
 * falling back to its creation date.
 */
function lastActivity(project, logs) {
  var last = project.created_at ? String(project.created_at).slice(0, 10) : null;
  for (var i = 0; i < logs.length; i++) {
    var l = logs[i];
    if (l.project_id !== project.id || !countsAsActivity(l)) continue;
    var d = String(l.ts_client).slice(0, 10);
    if (!last || parseISO(d) > parseISO(last)) last = d;
  }
  return last;
}

function isStale(project, logs, today) {
  var last = lastActivity(project, logs);
  if (!last) return false;
  return daysBetween(last, today) > (project.stale_days || DEFAULT_STALE_DAYS);
}

/**
 * Ensō value 0..1.
 *   once milestones: done / total
 *   recurring milestones: count as 1 when not overdue
 * Archived milestones are ignored.
 */
function progress(projectId, milestones, today) {
  var total = 0, score = 0;
  for (var i = 0; i < milestones.length; i++) {
    var m = milestones[i];
    if (m.project_id !== projectId || m.status === 'archived') continue;
    total++;
    if (m.kind === 'once') { if (m.status === 'done') score++; }
    else if (!isOverdue(m, today)) score++;
  }
  return total === 0 ? 0 : score / total;
}

/* ---------- aggregate views ---------- */

function lastReviewDays(logs, today) {
  var last = null;
  for (var i = 0; i < logs.length; i++) {
    if (logs[i].type !== 'review') continue;
    var d = String(logs[i].ts_client).slice(0, 10);
    if (!last || parseISO(d) > parseISO(last)) last = d;
  }
  return last ? daysBetween(last, today) : null;
}

/** Next upcoming due date (today or later) among open milestones of active projects. */
function nextAlert(snapshot, today) {
  var active = activeProjectIds(snapshot.projects);
  var best = null;
  snapshot.milestones.forEach(function (m) {
    var due = dueOf(m);
    if (m.status !== 'open' || !due || !active[m.project_id]) return;
    if (parseISO(due) < parseISO(today)) return;
    if (!best || parseISO(due) < parseISO(best.due)) best = { milestone: m, due: due };
  });
  return best;
}

/**
 * Everything the review view and the weekly digest need.
 * snapshot = {projects, milestones, logs}
 */
function computeAlerts(snapshot, today) {
  var active = activeProjectIds(snapshot.projects);
  var overdue = [], upcoming = [], stale = [];

  snapshot.milestones.forEach(function (m) {
    if (!active[m.project_id] || m.status !== 'open') return;
    var due = dueOf(m);
    if (!due) return;
    var delta = daysBetween(today, due);
    if (delta < 0) overdue.push({ milestone: m, days_overdue: -delta });
    else if (delta <= UPCOMING_WINDOW_DAYS) upcoming.push({ milestone: m, days_left: delta });
  });

  snapshot.projects.forEach(function (p) {
    if (p.status !== 'active') return;
    if (isStale(p, snapshot.logs, today)) {
      stale.push({ project: p, days_idle: daysBetween(lastActivity(p, snapshot.logs), today) });
    }
  });

  overdue.sort(function (a, b) { return b.days_overdue - a.days_overdue; });
  upcoming.sort(function (a, b) { return a.days_left - b.days_left; });
  stale.sort(function (a, b) { return b.days_idle - a.days_idle; });

  return {
    overdue: overdue,
    upcoming: upcoming,
    stale: stale,
    last_review_days: lastReviewDays(snapshot.logs, today),
    next_alert: nextAlert(snapshot, today)
  };
}

function activeProjectIds(projects) {
  var ids = {};
  projects.forEach(function (p) { if (p.status === 'active') ids[p.id] = true; });
  return ids;
}

/* ---------- temporal ensō ---------- */

var HOUR_MS = 3600000;
var DAY_MS = 24 * HOUR_MS;
var WEEK_MS = 7 * DAY_MS;

/**
 * Timer for a due date. Deadline = end of the due day (00:00 of due+1 in the caller's local time),
 * consistent with isOverdue (due < today).
 * @param dueIso      'YYYY-MM-DD'
 * @param nowLocalIso local timestamp WITH offset, e.g. '2026-11-23T10:00:00-06:00' (TZ explicit, so pure)
 * @returns null when past the deadline or outside the upcoming window, else
 *          {scale: 'week'|'day', fraction: 0..1, hours_left}
 *   remaining > 24 h → 7-day scale (clamped to 1); remaining ≤ 24 h → 24-hour scale (refills).
 */
function timerOf(dueIso, nowLocalIso) {
  if (!dueIso) return null;
  var now = String(nowLocalIso);
  var offset = now.slice(19).replace(/^\.\d+/, '') || 'Z';
  var deadline = Date.parse(addInterval(dueIso, 1, 'day') + 'T00:00:00' + offset);
  var left = deadline - Date.parse(now);
  if (!(left > 0)) return null;
  if (left <= DAY_MS) return { scale: 'day', fraction: left / DAY_MS, hours_left: left / HOUR_MS };
  if (daysBetween(now.slice(0, 10), dueIso) > UPCOMING_WINDOW_DAYS) return null;
  return { scale: 'week', fraction: Math.min(1, left / WEEK_MS), hours_left: left / HOUR_MS };
}

/* ---------- Node export (ignored by browser <script> and Apps Script) ---------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isKeepNoteUrl: isKeepNoteUrl, parseISO: parseISO, toISO: toISO, daysBetween: daysBetween, addInterval: addInterval,
    completeMilestone: completeMilestone, previewCompletion: previewCompletion,
    dueOf: dueOf, isOverdue: isOverdue, countsAsActivity: countsAsActivity,
    lastActivity: lastActivity, isStale: isStale,
    progress: progress, lastReviewDays: lastReviewDays, nextAlert: nextAlert,
    computeAlerts: computeAlerts, timerOf: timerOf
  };
}
