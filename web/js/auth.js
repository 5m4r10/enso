// Google Identity Services. The ID token (1 h) is kept in sessionStorage so a reload does not ask to
// sign in again (FedCM auto re-authentication has a 10 min quiet period); it dies with the tab.
// One Tap with auto_select renews it; if Google suppresses the prompt the app shows the button.
import { CLIENT_ID } from '../config.js';

const STORE_KEY = 'enso.idtoken';
let token = null;
let exp = 0;          // seconds since epoch
let waiters = [];
let onNeedSignIn = () => {};
let onSignedIn = () => {};
let initialized = false;

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

function waitForGis(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (window.google?.accounts?.id) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('No se pudo cargar Google Identity'));
      setTimeout(poll, 50);
    })();
  });
}

export async function initAuth({ needSignIn, signedIn }) {
  onNeedSignIn = needSignIn;
  onSignedIn = signedIn;
  if (initialized) return;
  await waitForGis();
  initialized = true;
  restoreToken();
  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    callback: (resp) => {
      setToken(resp.credential);
      const w = waiters;
      waiters = [];
      onSignedIn({ pending: w.length > 0 });
      w.forEach((resolve) => resolve(token));
    }
  });
}

// FedCM no longer reports whether One Tap was displayed, so fall back to the explicit
// button when no token arrives in time.
const PROMPT_TIMEOUT_MS = 4000;

function prompt() {
  google.accounts.id.prompt();
  setTimeout(() => { if (waiters.length) onNeedSignIn(); }, PROMPT_TIMEOUT_MS);
}

export function renderSignInButton(el) {
  google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', locale: 'es' });
}

export const isSignedIn = () => !!token && exp - Date.now() / 1000 > 60;

/** Valid token (renewed when < 2 min left). */
export function getToken() {
  if (token && exp - Date.now() / 1000 > 120) return Promise.resolve(token);
  return new Promise((resolve) => {
    waiters.push(resolve);
    if (waiters.length === 1) prompt();
  });
}

/** Called when the server rejects the token. */
export function invalidateToken() {
  setToken(null);
}

/** Wrong account: forget it and stop One Tap from silently picking it again. */
export function rejectAccount() {
  invalidateToken();
  google.accounts.id.disableAutoSelect();
}
