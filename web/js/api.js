// Single POST endpoint. text/plain avoids the CORS preflight Apps Script cannot answer.
import { API_URL, MOCK } from '../config.js';
import { getToken, invalidateToken } from './auth.js';
import { mockCall } from './mock.js';

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TIMEOUT_MS = 60000;
const OFFLINE = 'Sin conexión con el servidor';

/** Offline fails at once; otherwise resolves when there is a token. */
export async function ensureToken() {
  if (navigator.onLine === false) throw new ApiError('network', OFFLINE);
  if (!MOCK) await getToken();
}

async function post(action, payload, token) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload }),
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (_) {
    throw new ApiError('network', OFFLINE);
  }
  if (!res.ok) throw new ApiError('http', `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (_) {
    throw new ApiError('network', 'Respuesta no válida del servidor'); // captive portal or Apps Script error page
  }
}

export async function call(action, payload = {}) {
  if (navigator.onLine === false) throw new ApiError('network', OFFLINE);
  if (MOCK) return mockCall(action, structuredClone(payload));
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await post(action, payload, await getToken());
    if (json.ok) return json.data;
    if (json.error.code === 'unauthorized' && attempt === 0) {
      invalidateToken();
      continue;
    }
    throw new ApiError(json.error.code, json.error.message);
  }
  throw new ApiError('unauthorized', 'Sesión expirada');
}
