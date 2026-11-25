// Backend smoke tests: loads gas/*.js into a VM context with in-memory fakes of the Google services.
process.env.TZ = 'America/Mexico_City';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const GAS_FILES = ['Util.js', 'Repo.js', 'Auth.js', 'Actions.js', 'Vault.js', 'Calendar.js',
  'Digest.js', 'Setup.js', 'Router.js'];
const uuid = () => crypto.randomUUID();

/* ---------- fakes ---------- */

function formatDate(date, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === 'yyyy-MM-dd') return ymd;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const off = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const a = Math.abs(off), pad = n => String(n).padStart(2, '0');
  return `${ymd}T${parts.hour}:${parts.minute}:${parts.second}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) if ((this.data[r] || []).some(v => v !== '' && v != null)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let c = 0;
    this.data.forEach(row => (row || []).forEach((v, i) => { if (v !== '' && v != null) c = Math.max(c, i + 1); }));
    return c;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  deleteRow(r) { this.data.splice(r - 1, 1); this.maxRows--; }
  setFrozenRows() {}
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(row, col, nr, nc) {
    if (row + nr - 1 > this.maxRows) throw new Error('Range outside sheet');
    const sheet = this;
    return {
      setNumberFormat() { return this; },
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) {
          const src = sheet.data[row - 1 + r] || [];
          out.push(Array.from({ length: nc }, (_, c) => src[col - 1 + c] ?? ''));
        }
        return out;
      },
      setValues(vals) {
        assert.equal(vals.length, nr);
        vals.forEach((line, r) => {
          assert.equal(line.length, nc);
          const idx = row - 1 + r;
          sheet.data[idx] = sheet.data[idx] || [];
          line.forEach((v, c) => {
            assert.equal(typeof v, 'string', 'cells must be written as strings');
            sheet.data[idx][col - 1 + c] = v;
          });
        });
        return this;
      }
    };
  }
}

class FakeSpreadsheet {
  constructor(id) { this.id = id; this.sheets = [new FakeSheet('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://sheets/' + this.id; }
  setSpreadsheetTimeZone() {}
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets.splice(this.sheets.indexOf(s), 1); }
}

let eventSeq = 0;
class FakeEvent {
  constructor(cal, title, date) {
    Object.assign(this, { cal, title, date, id: `ev${++eventSeq}@google.com`, reminders: [], tags: {} });
  }
  getId() { return this.id; }
  getTitle() { return this.title; }
  setTitle(t) { this.title = t; }
  getAllDayStartDate() { return this.date; }
  setAllDayDate(d) { this.date = d; }
  removeAllReminders() { this.reminders = []; }
  addPopupReminder(m) { this.reminders.push(m); }
  setTag(k, v) { this.tags[k] = v; }
  deleteEvent() { this.cal.events.delete(this.id); }
}

class FakeCalendar {
  constructor(id, name) { this.id = id; this.name = name; this.events = new Map(); }
  getId() { return this.id; }
  createAllDayEvent(title, date) { const ev = new FakeEvent(this, title, date); this.events.set(ev.id, ev); return ev; }
  getEventById(id) { return this.events.get(id) || null; }
  getEvents(from, to) { return [...this.events.values()].filter(e => e.date >= from && e.date < to); }
}

function makeEnv() {
  const state = { props: {}, cache: {}, spreadsheets: {}, calendars: {}, mail: [], triggers: [], fetches: 0, tokenInfo: null };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => state.props[k] ?? null, setProperty: (k, v) => { state.props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => state.cache[k] ?? null, put: (k, v) => { state.cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: {
      create() { const ss = new FakeSpreadsheet('ss1'); state.spreadsheets.ss1 = ss; return ss; },
      openById: id => state.spreadsheets[id], flush() {}
    },
    Utilities: {
      formatDate, getUuid: uuid,
      computeDigest: (_a, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
    },
    UrlFetchApp: { fetch: (url, opts) => {
      state.fetches++;
      assert.equal(opts.method, 'post');
      const info = state.tokenInfo;
      return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || {}) };
    } },
    CalendarApp: {
      getCalendarById: id => state.calendars[id] || null,
      getOwnedCalendarsByName: n => Object.values(state.calendars).filter(c => c.name === n),
      createCalendar: n => { const c = new FakeCalendar('cal1', n); state.calendars.cal1 = c; return c; }
    },
    ScriptApp: {
      WeekDay: { SATURDAY: 'SATURDAY' },
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: t => state.triggers.splice(state.triggers.indexOf(t), 1),
      newTrigger(h) {
        const spec = [];
        const b = {
          timeBased: () => b, everyDays: n => (spec.push('every' + n), b), atHour: x => (spec.push('h' + x), b),
          onWeekDay: d => (spec.push(d), b), inTimezone: z => (spec.push(z), b),
          create: () => { const t = { getHandlerFunction: () => h, spec }; state.triggers.push(t); return t; }
        };
        return b;
      }
    },
    MailApp: { sendEmail: m => state.mail.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'domain.js'), 'utf8'), ctx, { filename: 'domain.js' });
  GAS_FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8'), ctx, { filename: f }));
  return { ctx, state };
}

function boot() {
  const env = makeEnv();
  env.ctx.setup();
  env.ctx.setMeta_('client_id', 'cid.apps.googleusercontent.com');
  env.state.tokenInfo = {
    iss: 'https://accounts.google.com', aud: 'cid.apps.googleusercontent.com',
    exp: String(Math.floor(Date.now() / 1000) + 3600), email: 'Owner@example.com', email_verified: 'true'
  };
  env.post = (action, payload, token = 't'.repeat(40)) =>
    JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ action, token, payload }) } }).content);
  env.ok = (action, payload) => {
    const r = env.post(action, payload);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.data;
  };
  env.cal = () => env.state.calendars.cal1;
  env.sheet = n => env.state.spreadsheets.ss1.getSheetByName(n);
  return env;
}

function seedProject(env, extra = {}) {
  return env.ok('upsertProject', { project: { id: uuid(), name: 'Casa', ...extra } });
}

const dateOf = ev => formatDate(ev.date, 'America/Mexico_City', 'yyyy-MM-dd');

/* ---------- tests ---------- */

test('gas/Domain.js is in sync with web/domain.js', () => {
  const gen = fs.readFileSync(path.join(ROOT, 'gas', 'Domain.js'), 'utf8').replace(/^﻿/, '');
  const src = fs.readFileSync(path.join(ROOT, 'web', 'domain.js'), 'utf8');
  assert.equal(gen.replace(/^[^\n]*\n/, ''), src, 'run scripts/sync-domain.ps1');
});

test('setup is idempotent: sheets, headers, meta, calendar, triggers', () => {
  const { ctx, state } = makeEnv();
  ctx.setup();
  ctx.setup();
  const ss = state.spreadsheets.ss1;
  assert.deepEqual(ss.getSheets().map(s => s.name).sort(), ['log', 'meta', 'milestones', 'projects', 'vault']);
  assert.deepEqual(ss.getSheetByName('milestones').data[0], [...ctx.SCHEMA.milestones]);
  const meta = ctx.getMeta_();
  assert.equal(meta.owner_email, 'owner@example.com');
  assert.equal(meta.calendar_id, 'cal1');
  assert.equal(ss.getSheetByName('meta').getLastRow(), 1 + ctx.META_KEYS.length);
  assert.equal(Object.keys(state.calendars).length, 1);
  assert.deepEqual(state.triggers.map(t => t.getHandlerFunction()).sort(), ['reconcileCalendar', 'sendWeeklyDigest']);
  assert.ok(state.triggers.find(t => t.getHandlerFunction() === 'sendWeeklyDigest').spec.includes('SATURDAY'));
});

test('auth: claims checked, verified token cached', () => {
  const env = boot();
  env.ok('snapshot', {});
  env.ok('snapshot', {});
  assert.equal(env.state.fetches, 1);

  env.state.tokenInfo = { ...env.state.tokenInfo, aud: 'other' };
  assert.equal(env.post('snapshot', {}, 'u'.repeat(40)).error.code, 'unauthorized');
  env.state.tokenInfo = { ...env.state.tokenInfo, aud: 'cid.apps.googleusercontent.com', email: 'x@example.com' };
  assert.equal(env.post('snapshot', {}, 'v'.repeat(40)).error.code, 'forbidden');
  assert.equal(env.post('snapshot', {}, '').error.code, 'unauthorized');
});

test('router: bad body and unknown action', () => {
  const env = boot();
  assert.equal(JSON.parse(env.ctx.doPost({ postData: { contents: '{nope' } }).content).error.code, 'bad_request');
  assert.equal(env.post('dropTables', {}).error.code, 'bad_request');
  assert.equal(env.post('toString', {}).error.code, 'bad_request');
});

test('recurring fixed: create → event, late completion, idempotent replay', () => {
  const env = boot();
  const p = seedProject(env);
  const mid = uuid();
  const m = env.ok('upsertMilestone', { milestone: {
    id: mid, project_id: p.id, title: 'Pagar predial', kind: 'recurring',
    interval_n: 1, interval_unit: 'month', due_date: '2026-11-30' } });
  assert.equal(m.next_due, '2026-11-30');
  assert.equal(m.anchor, 'fixed');
  const ev = env.cal().getEventById(m.gcal_event_id);
  assert.equal(dateOf(ev), '2026-11-30');
  assert.deepEqual(ev.reminders, [900]);
  assert.equal(ev.title, 'Casa · Pagar predial');

  const done = { id: uuid(), ts_client: '2026-12-02T20:30:00-06:00', milestone_id: mid };
  const r1 = env.ok('complete', done);
  assert.equal(r1.milestone.next_due, '2026-12-30');
  assert.equal(r1.milestone.last_done_at, '2026-12-02');
  assert.equal(r1.duplicate, false);
  assert.equal(dateOf(env.cal().getEventById(m.gcal_event_id)), '2026-12-30');

  const r2 = env.ok('complete', done);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.milestone.next_due, '2026-12-30');
  assert.equal(env.sheet('log').getLastRow(), 2);

  const logRow = env.ctx.readAll_('log')[0];
  assert.deepEqual({ ...logRow.meta }, { anchor_used: 'fixed', next_due: '2026-12-30', skipped_cycles: 0 });

  const utc = env.post('complete', { id: uuid(), ts_client: '2026-12-03T02:30:00Z', milestone_id: mid });
  assert.equal(utc.error.code, 'bad_request');
});

test('once: completion closes it and removes the event; second completion conflicts', () => {
  const env = boot();
  const p = seedProject(env);
  const mid = uuid();
  const m = env.ok('upsertMilestone', { milestone: { id: mid, project_id: p.id, title: 'Firmar', kind: 'once', due_date: '2026-12-10' } });
  assert.equal(env.cal().events.size, 1);
  const r = env.ok('complete', { id: uuid(), ts_client: '2026-12-01T10:00:00-06:00', milestone_id: mid });
  assert.equal(r.milestone.status, 'done');
  assert.equal(r.milestone.gcal_event_id, null);
  assert.equal(env.cal().getEventById(m.gcal_event_id), null);
  assert.equal(env.post('complete', { id: uuid(), ts_client: '2026-12-02T10:00:00-06:00', milestone_id: mid }).error.code, 'conflict');
  assert.equal(env.post('upsertMilestone', { milestone: { id: uuid(), project_id: p.id, title: 'x', kind: 'once', status: 'done' } }).error.code, 'bad_request');
});

test('capture: batch applied chronologically, duplicates and invalid entries reported', () => {
  const env = boot();
  const p = seedProject(env);
  const mid = uuid();
  env.ok('upsertMilestone', { milestone: { id: mid, project_id: p.id, title: 'Regar', kind: 'recurring',
    interval_n: 1, interval_unit: 'week', anchor: 'rolling', due_date: '2026-11-20' } });
  const a = { id: uuid(), type: 'done', milestone_id: mid, ts_client: '2026-11-21T09:00:00-06:00' };
  const b = { id: uuid(), type: 'done', milestone_id: mid, ts_client: '2026-11-28T09:00:00-06:00' };
  const n = { id: uuid(), type: 'note', project_id: p.id, note: 'compré tierra', ts_client: '2026-11-28T10:00:00-06:00' };
  const r = env.ok('capture', { entries: [n, b, a, { id: 'bad' }] });
  assert.deepEqual([...r.accepted], [a.id, b.id, n.id]);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.milestones[0].next_due, '2026-12-05');

  const again = env.ok('capture', { entries: [a, b] });
  assert.deepEqual([...again.duplicates], [a.id, b.id]);
  assert.equal(env.ctx.readAll_('milestones')[0].next_due, '2026-12-05');

  const snap = env.ok('snapshot', {});
  assert.equal(snap.logs.length, 1);
  assert.equal(snap.logs[0].id, n.id);
});

test('reschedule logs are written but do not count as activity', () => {
  const env = boot();
  const p = seedProject(env);
  const mid = uuid();
  env.ok('upsertMilestone', { milestone: { id: mid, project_id: p.id, title: 'ITV', kind: 'once', due_date: '2026-12-10' } });
  const m = env.ok('upsertMilestone', { milestone: { id: mid, due_date: '2026-12-20' } });
  assert.equal(dateOf(env.cal().getEventById(m.gcal_event_id)), '2026-12-20');
  const logs = env.ctx.readAll_('log');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].type, 'reschedule');
  assert.deepEqual({ ...logs[0].meta }, { from: '2026-12-10', to: '2026-12-20' });
  assert.equal(env.ok('snapshot', {}).logs.length, 0);
  assert.equal(env.post('upsertMilestone', { milestone: { id: mid, kind: 'recurring' } }).error.code, 'bad_request');
});

test('archiving a project removes its events; review is idempotent', () => {
  const env = boot();
  const p = seedProject(env);
  env.ok('upsertMilestone', { milestone: { id: uuid(), project_id: p.id, title: 'A', kind: 'once', due_date: '2026-12-10' } });
  assert.equal(env.cal().events.size, 1);
  env.ok('upsertProject', { project: { id: p.id, status: 'archived' } });
  assert.equal(env.cal().events.size, 0);
  assert.equal(env.ctx.readAll_('projects')[0].name, 'Casa');

  const rev = { id: uuid(), ts_client: '2026-11-21T10:00:00-06:00', note: 'ok' };
  assert.equal(env.ok('review', rev).duplicate, false);
  assert.equal(env.ok('review', rev).duplicate, true);
  const snap = env.ok('snapshot', {});
  assert.equal(snap.logs.filter(l => l.type === 'review').length, 1);
});

test('reconcile: recreates missing events and deletes orphans', () => {
  const env = boot();
  const p = seedProject(env);
  const m = env.ok('upsertMilestone', { milestone: { id: uuid(), project_id: p.id, title: 'A', kind: 'once', due_date: '2026-12-10' } });
  env.cal().getEventById(m.gcal_event_id).deleteEvent();
  env.cal().createAllDayEvent('stray', new Date(2026, 11, 15));
  env.ctx.reconcileCalendar();
  const events = [...env.cal().events.values()];
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Casa · A');
  assert.equal(env.ctx.readAll_('milestones')[0].gcal_event_id, events[0].id);
});

test('vault: init once, opaque upsert logged as vault, delete', () => {
  const env = boot();
  const p = seedProject(env);
  const item = { id: uuid(), project_id: p.id, ciphertext: 'QUJD', iv: 'aXZpdml2aXZpdg==' };
  assert.equal(env.post('vaultUpsert', { item }).error.code, 'conflict');
  const init = { kdf_salt: 'c2FsdA==', kdf_iterations: 600000, verifier_ct: 'dmVy', verifier_iv: 'aXY=' };
  env.ok('vaultInit', init);
  assert.equal(env.post('vaultInit', init).error.code, 'conflict');
  env.ok('vaultUpsert', { item });
  const list = env.ok('vaultList', {});
  assert.deepEqual({ ...list.kdf }, { salt: 'c2FsdA==', iterations: 600000 });
  assert.equal(list.items.length, 1);
  const logs = env.ctx.readAll_('log');
  assert.equal(logs[0].type, 'vault');
  assert.equal(logs[0].note, 'vault updated');
  assert.equal(env.ok('snapshot', {}).logs.length, 0);
  assert.equal(env.ok('vaultDelete', { id: item.id }).deleted, true);
  assert.equal(env.ok('vaultList', {}).items.length, 0);
});

test('digest: mails the owner with computeAlerts sections', () => {
  const env = boot();
  const p = seedProject(env);
  env.ok('upsertMilestone', { milestone: { id: uuid(), project_id: p.id, title: '<Vencido>', kind: 'once', due_date: '2020-01-01' } });
  env.ctx.sendWeeklyDigest();
  const mail = env.state.mail[0];
  assert.equal(mail.to, 'owner@example.com');
  assert.match(mail.subject, /^Enso · 1 vencidos/);
  assert.match(mail.body, /Casa · <Vencido>/);
  assert.match(mail.htmlBody, /&lt;Vencido&gt;/);
  assert.match(mail.body, /Aún no hay revisiones/);
});

test('projectLog: full history of one project, newest first, vault content never exposed', () => {
  const env = boot();
  const p = seedProject(env);
  const other = seedProject(env, { name: 'Otro' });
  const mk = (pid, ts, note) => ({ id: uuid(), type: 'note', project_id: pid, note, ts_client: ts });
  env.ok('capture', { entries: [
    mk(p.id, '2026-11-01T09:00:00-06:00', 'a'),
    mk(p.id, '2026-11-18T09:00:00-06:00', 'c'),
    mk(other.id, '2026-11-19T09:00:00-06:00', 'x'),
    mk(p.id, '2026-11-10T09:00:00-06:00', 'b')
  ] });
  const r = env.ok('projectLog', { project_id: p.id });
  assert.equal(r.total, 3);
  assert.deepEqual(r.logs.map(l => l.note), ['c', 'b', 'a']);
  assert.equal(env.ok('projectLog', { project_id: p.id, limit: 1 }).logs.length, 1);
  assert.equal(env.post('projectLog', { project_id: 'nope' }).error.code, 'bad_request');
});
