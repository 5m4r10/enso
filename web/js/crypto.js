// Vault cryptography (WebCrypto only, no DOM, no storage; also runs in Node for the tests).
// Passphrase → PBKDF2-SHA256 → non-extractable AES-256-GCM key. Kind, label and value travel inside
// the ciphertext. The item id is bound as additional data, so blobs cannot be swapped between rows.

export const KDF_ITERATIONS = 600000;
export const MIN_PASSPHRASE = 12;
// The KDF parameters come back from the server: never accept weaker ones than we would create.
const MIN_ITERATIONS = 600000;
const MAX_ITERATIONS = 10000000;
const VERIFIER_TEXT = 'enso-vault-verifier';
const VERIFIER_AAD = 'enso:v1:verifier';
const itemAad = (id) => `enso:v1:item:${id}`;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  // NFKC: the same phrase typed on Windows and Android must give the same bytes.
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(key, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh for every encryption
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(text));
  return { ct: toB64(ct), iv: toB64(iv) };
}

async function open(key, ct, iv, aad) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(aad) }, key, fromB64(ct));
  return dec.decode(pt);
}

/** New vault: {key, init} where init is the vaultInit payload. */
export async function createVault(passphrase, iterations = KDF_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, iterations);
  const v = await seal(key, VERIFIER_TEXT, VERIFIER_AAD);
  return { key, init: { kdf_salt: toB64(salt), kdf_iterations: iterations, verifier_ct: v.ct, verifier_iv: v.iv } };
}

/** Key, or null when the passphrase is wrong. Throws on unacceptable KDF parameters. */
export async function unlockVault(passphrase, kdf, verifier) {
  const n = Number(kdf.iterations);
  if (!Number.isInteger(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS) throw new Error('Parámetros de cifrado no válidos en el servidor');
  const key = await deriveKey(passphrase, fromB64(kdf.salt), n);
  try {
    return (await open(key, verifier.ct, verifier.iv, VERIFIER_AAD)) === VERIFIER_TEXT ? key : null;
  } catch (_) {
    return null;
  }
}

export async function encryptItem(key, id, { kind, label, value }) {
  const r = await seal(key, JSON.stringify({ kind, label, value }), itemAad(id));
  return { ciphertext: r.ct, iv: r.iv };
}

/** Throws if the blob was altered, belongs to another id or was made with another key. */
export async function decryptItem(key, row) {
  const { kind, label, value } = JSON.parse(await open(key, row.ciphertext, row.iv, itemAad(row.id)));
  return { kind, label, value };
}
