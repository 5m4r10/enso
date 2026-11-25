/*
 * Util.js — shared helpers for the Apps Script backend.
 * Business rules live in Domain.js (generated); nothing here decides domain behaviour.
 */

var TZ = 'America/Mexico_City';

var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Local time WITH explicit offset. 'Z' is rejected on purpose: domain.js takes the first
// 10 chars as the local date, and a UTC timestamp shifts evening captures to the next day.
var TS_CLIENT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?[+-]\d{2}:\d{2}$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Error carrying an API code; Router turns it into {ok:false, error:{code, message}}. */
function apiError_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function require_(condition, message) {
  if (!condition) throw apiError_('bad_request', message);
}

function todayLocal_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function nowLocalIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function isIsoDate_(s) {
  return typeof s === 'string' && ISO_DATE_RE.test(s) && toISO(parseISO(s)) === s;
}

function isTsClient_(s) {
  return typeof s === 'string' && TS_CLIENT_RE.test(s) && !isNaN(Date.parse(s)) &&
    isIsoDate_(s.slice(0, 10));
}

function isUuid_(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function isB64_(s, maxLen) {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen && B64_RE.test(s);
}

function isOptionalString_(s, maxLen) {
  return s === null || s === undefined || (typeof s === 'string' && s.length <= maxLen);
}

function has_(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Midnight of an ISO date in the script time zone (what CalendarApp all-day APIs expect). */
function localDate_(iso) {
  var p = iso.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function tsMs_(ts) {
  return Date.parse(ts);
}
