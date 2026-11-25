/*
 * Auth.js — Google Identity Services ID token verification.
 * Verified through Google's tokeninfo endpoint; claims checked against meta.owner_email and
 * meta.client_id. A verified token is cached until shortly before it expires so tokeninfo is
 * not hit on every request.
 */

var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
var GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
var TOKEN_CACHE_MARGIN_S = 60;

/** Returns the owner's email or throws unauthorized/forbidden. */
function verifyIdToken_(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    throw apiError_('unauthorized', 'Missing or malformed token');
  }
  var cache = CacheService.getScriptCache();
  var key = 'idtok_' + sha256Hex_(token);
  var cached = cache.get(key);
  if (cached) return cached;

  var res = UrlFetchApp.fetch(TOKENINFO_URL, {
    method: 'post',
    payload: { id_token: token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw apiError_('unauthorized', 'Invalid or expired token');

  var info = JSON.parse(res.getContentText());
  var nowS = Math.floor(Date.now() / 1000);
  var email = checkTokenClaims_(info, getMeta_(), nowS);

  var ttl = Math.min(Number(info.exp) - nowS - TOKEN_CACHE_MARGIN_S, 21600);
  if (ttl > 0) cache.put(key, email, ttl);
  return email;
}

/** Pure claim check (testable without network). */
function checkTokenClaims_(info, meta, nowS) {
  if (!meta.client_id) throw apiError_('internal', 'meta.client_id is not configured');
  if (!meta.owner_email) throw apiError_('internal', 'meta.owner_email is not configured');
  if (GOOGLE_ISSUERS.indexOf(info.iss) < 0) throw apiError_('unauthorized', 'Bad issuer');
  if (info.aud !== meta.client_id) throw apiError_('unauthorized', 'Bad audience');
  if (!(Number(info.exp) > nowS)) throw apiError_('unauthorized', 'Token expired');
  if (String(info.email_verified) !== 'true') throw apiError_('unauthorized', 'Email not verified');
  var email = String(info.email || '').toLowerCase();
  if (email !== String(meta.owner_email).toLowerCase()) throw apiError_('forbidden', 'Not the owner');
  return email;
}

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
