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

async function post(action, payload, token) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, payload }),
      redirect: 'follow'
    });
  } catch (_) {
    throw new ApiError('network', 'Sin conexión con el servidor');
  }
  if (!res.ok) throw new ApiError('http', `HTTP ${res.status}`);
  return res.json();
}

export async function call(action, payload = {}) {
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
