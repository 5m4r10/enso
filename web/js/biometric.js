// Device unlock: a passkey (fingerprint, face or device PIN) yields a secret through the WebAuthn PRF
// extension; that secret decrypts the vault key stored on this device. Without the authenticator the
// stored blob is useless. The passphrase keeps working and is the only recovery.
import * as db from './db.js';
import { wrapRaw, unwrapRaw, toB64, fromB64 } from './crypto.js';

const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const fail = (code, message) => Object.assign(new Error(message), { code });

export async function supported() {
  try {
    if (!window.PublicKeyCredential || !await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) return false;
    const caps = await PublicKeyCredential.getClientCapabilities?.();
    return caps?.['extension:prf'] !== false;
  } catch (_) {
    return false;
  }
}

export const enrolled = () => db.getDevice().then((r) => !!r, () => false);

async function askPrf(id, salt) {
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: random(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
    allowCredentials: [{ type: 'public-key', id }], extensions: { prf: { eval: { first: salt } } }
  } });
  const first = cred.getClientExtensionResults().prf?.results?.first;
  if (!first) throw fail('unsupported', 'Este dispositivo no ofrece el desbloqueo necesario (PRF)');
  return new Uint8Array(first);
}

// Best effort: tells the password manager that the passkey is no longer used.
function forgetPasskey(id) {
  PublicKeyCredential.signalUnknownCredential?.({
    rpId: location.hostname, credentialId: toB64(id).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  }).catch(() => {});
}

/** raw: vault key bytes; the caller wipes them. */
export async function enroll(raw) {
  const salt = random(32);
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: random(32), rp: { name: 'Ensō', id: location.hostname },
    // Random user id: synced passkeys from another device must not be overwritten.
    user: { id: random(16), name: 'Bóveda de Ensō', displayName: 'Bóveda de Ensō' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    timeout: 60000, extensions: { prf: { eval: { first: salt } } }
  } });
  const id = new Uint8Array(cred.rawId);
  let secret = null;
  try {
    const prf = cred.getClientExtensionResults().prf;
    if (prf?.enabled === false) throw fail('unsupported', 'Este dispositivo no ofrece el desbloqueo necesario (PRF)');
    secret = prf?.results?.first ? new Uint8Array(prf.results.first) : await askPrf(id, salt);
    await db.putDevice({ id: toB64(id), salt: toB64(salt), ...(await wrapRaw(secret, raw, toB64(id))) });
  } catch (e) {
    forgetPasskey(id);
    throw e;
  } finally {
    secret?.fill(0);
  }
}

/** Vault key bytes after a successful check; the caller wipes them. */
export async function unlockRaw() {
  const r = await db.getDevice();
  if (!r) throw fail('gone', 'La huella no está activada en este dispositivo');
  const secret = await askPrf(fromB64(r.id), fromB64(r.salt));
  try {
    return await unwrapRaw(secret, r);
  } catch (_) {
    throw fail('gone', 'La huella ya no abre esta bóveda; usa la frase');
  } finally {
    secret.fill(0);
  }
}

export async function remove() {
  const r = await db.getDevice();
  await db.deleteDevice();
  if (r) forgetPasskey(fromB64(r.id));
}

export function explain(e) {
  return e.name === 'NotAllowedError' || e.name === 'AbortError' ? 'No se completó la verificación.' : e.message;
}
