/*
 * Actions.js — API handlers for projects, milestones and the log.
 * All rules come from Domain.js (completeMilestone, dueOf, countsAsActivity…).
 *
 * Idempotency: every client-originated log entry (note | done | review) carries a client uuid.
 * `capture` is the single pipeline that applies them; `complete` and `review` are thin wrappers,
 * so a replayed request (retry now, offline queue later) never applies a completion twice.
 */

var CLIENT_LOG_TYPES = { note: true, done: true, review: true };
var ANCHORS = { fixed: true, rolling: true };
var INTERVAL_UNITS = { day: true, week: true, month: true };
var MAX_NOTE = 2000;
var MAX_BATCH = 200;

/* ---------- snapshot ---------- */

function actionSnapshot_() {
  return {
    today: todayLocal_(),
    projects: readAll_('projects').map(clean_),
    milestones: readAll_('milestones')
      .filter(function (m) { return m.status !== 'archived'; })
      .map(clean_),
    logs: snapshotLogs_(readAll_('log'))
  };
}

/** Full history of one project, newest first. payload: {project_id, limit?} (default 200, max 1000). */
function actionProjectLog_(p) {
  require_(isUuid_(p.project_id), 'project_id must be a uuid');
  var limit = p.limit == null ? 200 : Number(p.limit);
  require_(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'limit must be 1..1000');
  var logs = readAll_('log')
    .filter(function (l) { return l.project_id === p.project_id; })
    .sort(function (a, b) { return tsMs_(b.ts_client) - tsMs_(a.ts_client); });
  return { logs: logs.slice(0, limit).map(clean_), total: logs.length };
}

/* ---------- capture (batch, idempotent) ---------- */

function actionCapture_(payload) {
  var entries = payload.entries;
  require_(Array.isArray(entries) && entries.length > 0 && entries.length <= MAX_BATCH,
    'entries must be a non-empty array (max ' + MAX_BATCH + ')');
  var r = withLock_(function () { return applyEntries_(entries); });
  return {
    accepted: r.accepted,
    duplicates: r.duplicates,
    rejected: r.rejected,
    milestones: r.touched.map(clean_)
  };
}

function validateEntry_(e) {
  if (!e || typeof e !== 'object') return 'entry must be an object';
  if (!isUuid_(e.id)) return 'id must be a uuid';
  if (!isTsClient_(e.ts_client)) return 'ts_client must be local ISO with offset, e.g. 2026-11-23T19:05:00-06:00';
  if (!CLIENT_LOG_TYPES[e.type]) return 'type must be note | done | review';
  if (!isOptionalString_(e.note, MAX_NOTE)) return 'note must be a string up to ' + MAX_NOTE + ' chars';
  if (e.project_id != null && !isUuid_(e.project_id)) return 'project_id must be a uuid';
  if (e.milestone_id != null && !isUuid_(e.milestone_id)) return 'milestone_id must be a uuid';
  if (e.type === 'done' && !e.milestone_id) return 'done requires milestone_id';
  if (e.type === 'note' && !e.project_id) return 'note requires project_id';
  if (e.meta != null && (typeof e.meta !== 'object' || (e.meta.anchor != null && !ANCHORS[e.meta.anchor]))) {
    return 'meta.anchor must be fixed | rolling';
  }
  return null;
}

/** Must run under withLock_. */
function applyEntries_(entries) {
  var seen = {};
  readAll_('log').forEach(function (l) { seen[l.id] = true; });
  var projects = indexBy_(readAll_('projects'));
  var milestones = indexBy_(readAll_('milestones'));

  var accepted = [], duplicates = [], rejected = [], newLogs = [], touched = {};
  var reject = function (e, code, error) { rejected.push({ id: (e && e.id) || null, code: code, error: error }); };

  var valid = [];
  entries.forEach(function (e) {
    var err = validateEntry_(e);
    if (err) reject(e, 'bad_request', err); else valid.push(e);
  });
  // Chronological order so replayed offline completions advance recurring milestones correctly.
  valid.sort(function (a, b) { return tsMs_(a.ts_client) - tsMs_(b.ts_client); });

  valid.forEach(function (e) {
    if (seen[e.id]) { duplicates.push(e.id); return; }
    var projectId = e.project_id || null, meta = null;

    if (e.type === 'done') {
      var m = milestones[e.milestone_id];
      if (!m) return reject(e, 'not_found', 'Unknown milestone');
      if (m.status !== 'open') return reject(e, 'conflict', 'Milestone is not open');
      projectId = m.project_id;
      var anchor = m.kind === 'once' ? null : ((e.meta && e.meta.anchor) || m.anchor);
      var r = completeMilestone(m, e.ts_client.slice(0, 10), anchor);
      m.status = r.status;
      m.next_due = r.next_due;
      m.last_done_at = r.last_done_at;
      meta = { anchor_used: anchor, next_due: r.next_due, skipped_cycles: r.skipped_cycles };
      touched[m.id] = m;
    } else if (projectId) {
      if (!projects[projectId]) return reject(e, 'not_found', 'Unknown project');
      if (e.milestone_id) {
        var mm = milestones[e.milestone_id];
        if (!mm || mm.project_id !== projectId) return reject(e, 'bad_request', 'milestone_id does not belong to project');
      }
    }

    newLogs.push({
      id: e.id, ts_client: e.ts_client, ts_server: nowLocalIso_(), project_id: projectId,
      milestone_id: e.milestone_id || null, type: e.type, note: e.note || null, meta: meta
    });
    seen[e.id] = true;
    accepted.push(e.id);
  });

  appendRows_('log', newLogs);
  var touchedList = Object.keys(touched).map(function (k) { return touched[k]; });
  touchedList.forEach(function (m) {
    writeRow_('milestones', m);
    syncMilestoneEvent_(m, projects[m.project_id]);
  });
  return { accepted: accepted, duplicates: duplicates, rejected: rejected, touched: touchedList };
}

/** Single completion. payload: {id, ts_client, milestone_id, anchor?, note?} */
function actionComplete_(p) {
  var r = actionCapture_({ entries: [{
    id: p.id, ts_client: p.ts_client, type: 'done', milestone_id: p.milestone_id,
    note: p.note || null, meta: p.anchor ? { anchor: p.anchor } : null
  }] });
  if (r.rejected.length) throw apiError_(r.rejected[0].code, r.rejected[0].error);
  var m = findById_(readAll_('milestones'), p.milestone_id);
  return { milestone: clean_(m), duplicate: r.duplicates.length > 0 };
}

/** Weekly review. payload: {id?, ts_client?, note?} — send id/ts_client from the client to be idempotent. */
function actionReview_(p) {
  var entry = {
    id: p.id || Utilities.getUuid(), ts_client: p.ts_client || nowLocalIso_(),
    type: 'review', note: p.note || null
  };
  var r = actionCapture_({ entries: [entry] });
  if (r.rejected.length) throw apiError_(r.rejected[0].code, r.rejected[0].error);
  var log = findById_(readAll_('log'), entry.id);
  return { log: clean_(log), duplicate: r.duplicates.length > 0 };
}

/* ---------- projects ---------- */

/** payload: {project: {id, name?, stale_days?, status?, sort?}} — absent fields are kept. */
function actionUpsertProject_(payload) {
  var input = payload.project;
  require_(input && typeof input === 'object', 'project is required');
  require_(isUuid_(input.id), 'project.id must be a uuid');

  return withLock_(function () {
    var rows = readAll_('projects');
    var existing = findById_(rows, input.id);
    var p = existing ? clean_(existing) : { id: input.id, status: 'active', created_at: nowLocalIso_() };
    if (existing) p._row = existing._row;

    if (has_(input, 'name')) p.name = typeof input.name === 'string' ? input.name.trim() : '';
    if (has_(input, 'stale_days')) p.stale_days = input.stale_days === null || input.stale_days === '' ? null : Number(input.stale_days);
    if (has_(input, 'status')) p.status = input.status;
    if (has_(input, 'sort')) p.sort = input.sort === null ? null : Number(input.sort);
    if (p.sort === undefined || p.sort === null) p.sort = rows.length;

    require_(p.name && p.name.length <= 120, 'project.name is required (max 120 chars)');
    require_(p.stale_days === null || p.stale_days === undefined ||
      (Number.isInteger(p.stale_days) && p.stale_days >= 1 && p.stale_days <= 365), 'stale_days must be 1..365');
    require_(p.status === 'active' || p.status === 'archived', 'status must be active | archived');
    require_(isFinite(p.sort), 'sort must be a number');

    writeRow_('projects', p);
    if (existing && existing.status !== p.status) syncProjectMilestones_(p);
    return clean_(p);
  });
}

/* ---------- milestones ---------- */

var MILESTONE_EDITABLE = ['project_id', 'title', 'kind', 'due_date', 'interval_n', 'interval_unit',
  'anchor', 'next_due', 'status'];

/**
 * payload: {milestone: {id, …}} — absent fields are kept. last_done_at and gcal_event_id are
 * server-owned. 'done' is reachable only through complete/capture (so it is always logged);
 * reopening a done milestone is allowed.
 */
function actionUpsertMilestone_(payload) {
  var input = payload.milestone;
  require_(input && typeof input === 'object', 'milestone is required');
  require_(isUuid_(input.id), 'milestone.id must be a uuid');

  return withLock_(function () {
    var projects = indexBy_(readAll_('projects'));
    var existing = findById_(readAll_('milestones'), input.id);
    var m = existing ? clean_(existing) : {
      id: input.id, status: 'open', last_done_at: null, gcal_event_id: null, next_due: null
    };
    if (existing) m._row = existing._row;

    MILESTONE_EDITABLE.forEach(function (k) {
      if (has_(input, k)) m[k] = input[k] === '' || input[k] === undefined ? null : input[k];
    });
    if (typeof m.title === 'string') m.title = m.title.trim();
    if (m.interval_n !== null && m.interval_n !== undefined) m.interval_n = Number(m.interval_n);

    validateMilestone_(m, existing, projects);

    if (m.kind === 'once') {
      m.interval_n = null; m.interval_unit = null; m.anchor = null; m.next_due = null;
    } else {
      m.anchor = m.anchor || 'fixed';
      if (!m.next_due) m.next_due = m.due_date;
    }

    var before = existing ? dueOf(existing) : null, after = dueOf(m);
    if (existing && before !== after && m.status === 'open') {
      appendRows_('log', [serverLog_('reschedule', m.project_id, m.id, null, { from: before, to: after })]);
    }

    writeRow_('milestones', m);
    syncMilestoneEvent_(m, projects[m.project_id]);
    return clean_(m);
  });
}

function validateMilestone_(m, existing, projects) {
  require_(isUuid_(m.project_id) && projects[m.project_id], 'project_id must reference an existing project');
  require_(typeof m.title === 'string' && m.title.length > 0 && m.title.length <= 200, 'title is required (max 200 chars)');
  require_(m.kind === 'once' || m.kind === 'recurring', 'kind must be once | recurring');
  require_(!existing || existing.kind === m.kind, 'kind cannot change; archive and create a new milestone');
  require_(m.due_date === null || m.due_date === undefined || isIsoDate_(m.due_date), 'due_date must be YYYY-MM-DD');
  require_(m.next_due === null || m.next_due === undefined || isIsoDate_(m.next_due), 'next_due must be YYYY-MM-DD');
  require_(m.status === 'open' || m.status === 'done' || m.status === 'archived', 'status must be open | done | archived');
  require_(m.status !== 'done' || (existing && existing.status === 'done'), 'use complete to mark a milestone done');
  if (m.kind === 'recurring') {
    require_(m.status !== 'done', 'recurring milestones are never done');
    require_(Number.isInteger(m.interval_n) && m.interval_n >= 1 && m.interval_n <= 999, 'interval_n must be 1..999');
    require_(INTERVAL_UNITS[m.interval_unit], 'interval_unit must be day | week | month');
    require_(m.anchor === null || m.anchor === undefined || ANCHORS[m.anchor], 'anchor must be fixed | rolling');
    require_(m.due_date || m.next_due, 'recurring milestones need due_date (first due)');
  }
}
