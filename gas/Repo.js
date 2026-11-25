/*
 * Repo.js — Sheets access with header-based row mapping.
 * Every sheet is formatted as plain text (setup) so Sheets never coerces '2026-11-23' into a Date;
 * values are read back as strings and typed here.
 */

var SCHEMA = {
  projects: ['id', 'name', 'stale_days', 'status', 'sort', 'created_at'],
  milestones: ['id', 'project_id', 'title', 'kind', 'due_date', 'interval_n', 'interval_unit',
    'anchor', 'next_due', 'last_done_at', 'status', 'gcal_event_id'],
  log: ['id', 'ts_client', 'ts_server', 'project_id', 'milestone_id', 'type', 'note', 'meta'],
  vault: ['id', 'project_id', 'ciphertext', 'iv', 'updated_at'],
  meta: ['key', 'value']
};
var NUMBER_FIELDS = { stale_days: true, sort: true, interval_n: true };
var JSON_FIELDS = { meta: true }; // log.meta

var spreadsheetMemo_ = null;

function spreadsheet_() {
  if (!spreadsheetMemo_) {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw apiError_('internal', 'SPREADSHEET_ID not set; run setup()');
    spreadsheetMemo_ = SpreadsheetApp.openById(id);
  }
  return spreadsheetMemo_;
}

function sheet_(name) {
  var sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw apiError_('internal', 'Missing sheet "' + name + '"; run setup()');
  return sh;
}

function headerOf_(sh) {
  var n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

function assertHeader_(name, header) {
  var missing = SCHEMA[name].filter(function (c) { return header.indexOf(c) < 0; });
  if (missing.length) {
    throw apiError_('internal', 'Sheet "' + name + '" lacks columns ' + missing.join(', ') + '; run setup()');
  }
}

function fromCell_(field, v) {
  if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (v === '' || v === null || v === undefined) return null;
  if (NUMBER_FIELDS[field]) {
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  if (JSON_FIELDS[field]) {
    try { return JSON.parse(v); } catch (_) { return null; }
  }
  return String(v);
}

function toCell_(field, v) {
  if (v === null || v === undefined) return '';
  if (JSON_FIELDS[field]) return JSON.stringify(v);
  return String(v);
}

/** All rows of a sheet as objects keyed by header; `_row` is the 1-based sheet row. */
function readAll_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var header = values[0].map(String);
  if (values.length === 1 && header.length === 1 && header[0] === '') header = [];
  assertHeader_(name, header);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {}, empty = true;
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      obj[header[c]] = fromCell_(header[c], values[r][c]);
      if (obj[header[c]] !== null) empty = false;
    }
    if (empty) continue;
    obj._row = r + 1;
    rows.push(obj);
  }
  return rows;
}

function rowValues_(header, obj) {
  return header.map(function (h) { return h ? toCell_(h, obj[h]) : ''; });
}

/** Overwrites obj's row if it has `_row`, otherwise appends it. */
function writeRow_(name, obj) {
  if (!obj._row) {
    appendRows_(name, [obj]);
    return obj;
  }
  var sh = sheet_(name), header = headerOf_(sh);
  assertHeader_(name, header);
  sh.getRange(obj._row, 1, 1, header.length).setValues([rowValues_(header, obj)]);
  return obj;
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name), header = headerOf_(sh);
  assertHeader_(name, header);
  var start = sh.getLastRow() + 1, end = start + objs.length - 1;
  if (end > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), end - sh.getMaxRows());
  var range = sh.getRange(start, 1, objs.length, header.length);
  range.setNumberFormat('@');
  range.setValues(objs.map(function (o) { return rowValues_(header, o); }));
  objs.forEach(function (o, i) { o._row = start + i; });
}

function deleteRow_(name, row) {
  sheet_(name).deleteRow(row);
}

function indexBy_(rows) {
  var out = {};
  rows.forEach(function (r) { out[r.id] = r; });
  return out;
}

function findById_(rows, id) {
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

/** Public copy of a row (drops `_row`). */
function clean_(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { if (k !== '_row') out[k] = obj[k]; });
  return out;
}

/* ---------- meta ---------- */

function getMeta_() {
  var out = {};
  readAll_('meta').forEach(function (r) { if (r.key) out[r.key] = r.value; });
  return out;
}

function setMeta_(key, value) {
  var rows = readAll_('meta');
  var row = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) row = rows[i];
  row = row || { key: key };
  row.value = value;
  writeRow_('meta', row);
}

/* ---------- logs ---------- */

/**
 * Logs the clients need: latest activity log per project (enough for lastActivity / isStale and
 * "last progress") plus the latest review (lastReviewDays). Uses domain countsAsActivity.
 */
function snapshotLogs_(logs) {
  var perProject = {}, review = null;
  logs.forEach(function (l) {
    var t = tsMs_(l.ts_client);
    if (l.type === 'review' && (!review || t > tsMs_(review.ts_client))) review = l;
    if (l.project_id && countsAsActivity(l)) {
      var cur = perProject[l.project_id];
      if (!cur || t > tsMs_(cur.ts_client)) perProject[l.project_id] = l;
    }
  });
  var out = Object.keys(perProject).map(function (k) { return perProject[k]; });
  if (review && out.indexOf(review) < 0) out.push(review);
  return out.map(clean_);
}

function serverLog_(type, projectId, milestoneId, note, meta) {
  var now = nowLocalIso_();
  return {
    id: Utilities.getUuid(), ts_client: now, ts_server: now, project_id: projectId || null,
    milestone_id: milestoneId || null, type: type, note: note || null, meta: meta || null
  };
}

/* ---------- locking ---------- */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw apiError_('busy', 'Server busy, retry');
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}
