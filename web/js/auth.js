// Google Identity Services. The ID token (1 h) is kept in sessionStorage so a reload does not ask to
// sign in again (FedCM auto re-authentication has a 10 min quiet period); it dies with the tab.
// One Tap with auto_select renews it; if Google suppresses the prompt the app shows the button.
import { CLIENT_ID } from '../config.js';

const GIS_URL = 'https://accounts.google.com/gsi/client';
const GIS_TIMEOUT_MS = 10000;
const STORE_KEY = 'enso.idtoken';
let token = null;
let exp = 0;          // seconds since epoch
let waiters = [];
let onNeedSignIn = () => {};
let onSignedIn = () => {};
let ready = null;     // promise: GIS loaded and initialized

function decodeExp(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)).exp || 0;
  } catch (_) {
    return 0;
  }
}

function setToken(jwt) {
  token = jwt;
  exp = jwt ? decodeExp(jwt) : 0;
  try {
    if (jwt) sessionStorage.setItem(STORE_KEY, jwt);
    else sessionStorage.removeItem(STORE_KEY);
  } catch (_) { /* storage blocked: memory only */ }
}

function restoreToken() {
  try {
    const jwt = sessionStorage.getItem(STORE_KEY);
    if (jwt && decodeExp(jwt) - Date.now() / 1000 > 120) setToken(jwt);
  } catch (_) { /* storage blocked */ }
}

const fail = (code, message) => Object.assign(new Error(message), { code });

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    const no = () => { el.remove(); reject(fail('network', 'No se pudo cargar Google Identity')); };
    const timer = setTimeout(no, GIS_TIMEOUT_MS);
    el.src = GIS_URL;
    el.onload = () => { clearTimeout(timer); resolve(); };
    el.onerror = () => { clearTimeout(timer); no(); };
    document.head.append(el);
  });
}

export function initAuth({ needSignIn, signedIn }) {
  onNeedSignIn = needSignIn;
  onSignedIn = signedIn;
  restoreToken();
}

/** Loaded on demand: offline there is nothing to load, and a failure is retried on the next call. */
function ensureGis() {
  ready ??= loadGis().then(() => google.accounts.id.initialize({
    client_id: CLIENT_ID,
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    callback: (resp) => {
      setToken(resp.credential);
      const w = waiters;
      waiters = [];
      onSignedIn({ pending: w.length > 0 });
      w.forEach((x) => x.resolve(token));
    }
  })).catch((e) => { ready = null; throw e; });
  return ready;
}

// FedCM no longer reports whether One Tap was displayed, so fall back to the explicit
// button when no token arrives in time.
const PROMPT_TIMEOUT_MS = 4000;

function prompt() {
  google.accounts.id.prompt();
  setTimeout(() => { if (waiters.length) onNeedSignIn(); }, PROMPT_TIMEOUT_MS);
}

export async function renderSignInButton(el) {
  await ensureGis();
  google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', locale: 'es' });
}

export const isSignedIn = () => !!token && exp - Date.now() / 1000 > 60;

/** Valid token (renewed when < 2 min left). */
export async function getToken() {
  if (token && exp - Date.now() / 1000 > 120) return token;
  await ensureGis();
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject });
    if (waiters.length === 1) prompt();
  });
}

/** The owner postponed signing in: whoever was waiting fails instead of hanging. */
export function cancelSignIn() {
  const w = waiters;
  waiters = [];
  w.forEach((x) => x.reject(fail('signin', 'Falta iniciar sesión')));
}

/** Called when the server rejects the token. */
export function invalidateToken() {
  setToken(null);
}

/** Wrong account: forget it and stop One Tap from silently picking it again. */
export function rejectAccount() {
  invalidateToken();
  window.google?.accounts?.id.disableAutoSelect();
}
