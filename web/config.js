// Public configuration (safe to commit: security is the ID token check on the server).
export const API_URL =
  'https://script.google.com/macros/s/AKfycbzGErQ3An04gK-maJRIMprm7cXCy1EXRo_KwuViNeqtMKIgfynamNtjJVh668hE1jkbfA/exec';

// OAuth client id (Google Cloud → Credentials → Web application). Must match meta.client_id.
export const CLIENT_ID = '260125083416-m65lc07e34bdjv13h9iqcv5qab66elca.apps.googleusercontent.com';

// Mock mode: in-memory fixtures, no network. Only on localhost with ?mock=1.
export const MOCK = ['localhost', '127.0.0.1'].includes(location.hostname) &&
  new URLSearchParams(location.search).has('mock');
