/*
 * Router.js — single POST endpoint.
 * Body: {action, token, payload}, sent as Content-Type: text/plain (no CORS preflight).
 * Response: {ok:true, data} | {ok:false, error:{code, message}}. Apps Script cannot set HTTP
 * status codes, so the client must always inspect `ok`.
 */

function getActions_() {
  return {
    snapshot: actionSnapshot_,
    projectLog: actionProjectLog_,
    capture: actionCapture_,
    complete: actionComplete_,
    upsertProject: actionUpsertProject_,
    upsertMilestone: actionUpsertMilestone_,
    review: actionReview_,
    vaultList: actionVaultList_,
    vaultInit: actionVaultInit_,
    vaultUpsert: actionVaultUpsert_,
    vaultDelete: actionVaultDelete_
  };
}

function doPost(e) {
  var out;
  try {
    var req = parseRequest_(e);
    var actions = getActions_();
    if (!has_(actions, req.action)) throw apiError_('bad_request', 'Unknown action: ' + req.action);
    verifyIdToken_(req.token);
    out = { ok: true, data: actions[req.action](req.payload || {}) };
  } catch (err) {
    if (!err.code) console.error(err && err.stack ? err.stack : err);
    out = { ok: false, error: { code: err.code || 'internal', message: String(err.message || err) } };
  }
  return jsonOut_(out);
}

/** Health check only; exposes no data. */
function doGet() {
  return jsonOut_({ ok: true, data: { service: 'enso' } });
}

function parseRequest_(e) {
  var raw = e && e.postData && e.postData.contents;
  if (!raw) throw apiError_('bad_request', 'Empty body');
  var body;
  try {
    body = JSON.parse(raw);
  } catch (_) {
    throw apiError_('bad_request', 'Body must be JSON');
  }
  if (!body || typeof body !== 'object') throw apiError_('bad_request', 'Body must be an object');
  if (typeof body.action !== 'string') throw apiError_('bad_request', 'Missing action');
  if (body.payload !== undefined && body.payload !== null && typeof body.payload !== 'object') {
    throw apiError_('bad_request', 'payload must be an object');
  }
  return body;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
