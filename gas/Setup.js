/*
 * Setup.js — idempotent bootstrap. Run setup() from the Apps Script editor (once, and again
 * after schema changes). Creates the spreadsheet, sheets + headers (plain-text format), meta keys,
 * the "Hitos" calendar and the time triggers. Never overwrites existing meta values.
 */

var META_KEYS = ['owner_email', 'client_id', 'calendar_id', 'kdf_salt', 'kdf_iterations',
  'verifier_ct', 'verifier_iv'];

function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Enso');
  if (!id) props.setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);
  spreadsheetMemo_ = ss;

  Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name, SCHEMA[name]); });
  ss.getSheets().forEach(function (sh) {
    if (!SCHEMA[sh.getName()] && sh.getLastRow() === 0) ss.deleteSheet(sh); // default "Sheet1"/"Hoja 1"
  });

  var meta = getMeta_();
  META_KEYS.forEach(function (k) {
    if (!has_(meta, k)) setMeta_(k, k === 'owner_email' ? Session.getEffectiveUser().getEmail() : '');
  });

  var cal = ensureCalendar_();
  if (getMeta_().calendar_id !== cal.getId()) setMeta_('calendar_id', cal.getId());

  ensureTriggers_();
  SpreadsheetApp.flush();

  meta = getMeta_();
  console.log('Spreadsheet: ' + ss.getUrl());
  console.log('owner_email: ' + meta.owner_email + ' | calendar: ' + CALENDAR_NAME);
  if (!meta.client_id) console.warn('meta.client_id is empty: paste the OAuth client id into the meta sheet.');
}

function ensureSheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getMaxColumns(), cols.length)).setNumberFormat('@');
  var header = headerOf_(sh);
  if (!header.length) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  } else {
    var missing = cols.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
  }
  sh.setFrozenRows(1);
  return sh;
}

function ensureCalendar_() {
  var id = getMeta_().calendar_id;
  var cal = id ? CalendarApp.getCalendarById(id) : null;
  if (cal) return cal;
  var owned = CalendarApp.getOwnedCalendarsByName(CALENDAR_NAME);
  if (owned.length) return owned[0];
  return CalendarApp.createCalendar(CALENDAR_NAME, { timeZone: TZ });
}

function ensureTriggers_() {
  var handlers = ['reconcileCalendar', 'sendWeeklyDigest'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reconcileCalendar').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
  ScriptApp.newTrigger('sendWeeklyDigest').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(10).inTimezone(TZ).create();
}
