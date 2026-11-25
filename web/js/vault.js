// Vault session: key and plaintext live only in this module's memory, dropped on lock.
import { call } from './api.js';
import { createVault, unlockVault, encryptItem, decryptItem } from './crypto.js';

export const IDLE_MS = 5 * 60000;
export const CLIP_MS = 30000;
const LIST_FRESH_MS = 60000;

let key = null;
let kdf = null;
let verifier = null;
let rows = [];          // opaque blobs as stored by the server
let loadedAt = 0;
let idleAt = 0;         // timestamp when the vault locks itself
let onLock = () => {};

export const vault = {
  status: 'unloaded',   // unloaded | loading | failed | uninit | locked | open
  working: false,       // deriving the key
  error: '',
  items: [],            // decrypted {id, project_id, kind, label, value} | {id, project_id, broken: true}
  revealed: new Set(),
  filter: 'all',        // all | none | project id
  query: '',
  copied: null          // {id, until}
};

export function initVault(cb) {
  onLock = cb;
  const touch = () => { if (key && Date.now() < idleAt) idleAt = Date.now() + IDLE_MS; };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchmove']) window.addEventListener(ev, touch, { passive: true });
  // Background timers are throttled or frozen: the deadline is a timestamp, re-checked on return.
  setInterval(checkIdle, 1000);
  document.addEventListener('visibilitychange', checkIdle);
  window.addEventListener('focus', () => { checkIdle(); clearClipboardIfDue(); });
  window.addEventListener('pagehide', () => lock('page'));
}

export const idleLeftMs = () => Math.max(0, idleAt - Date.now());

function checkIdle() {
  if (key && Date.now() >= idleAt) lock('idle');
  clearClipboardIfDue();
}

export function lock(reason = 'user') {
  if (!key) return;
  key = null;
  vault.items = [];
  vault.revealed.clear();
  vault.query = '';
  vault.filter = 'all';
  vault.error = '';
  vault.status = 'locked';
  onLock(reason);
}

async function fetchList() {
  const r = await call('vaultList');
  kdf = r.kdf;
  verifier = r.verifier;
  rows = r.items;
  loadedAt = Date.now();
}

export async function loadVault() {
  if (['open', 'loading'].includes(vault.status)) return;
  vault.status = 'loading';
  vault.error = '';
  try {
    await fetchList();
    vault.status = verifier ? 'locked' : 'uninit';
  } catch (e) {
    vault.status = 'failed';
    vault.error = e.message;
  }
}

async function decryptRow(k, row) {
  try {
    return { id: row.id, project_id: row.project_id || null, ...(await decryptItem(k, row)) };
  } catch (_) {
    return { id: row.id, project_id: row.project_id || null, broken: true };
  }
}

async function openWith(k) {
  if (Date.now() - loadedAt > LIST_FRESH_MS) await fetchList();
  vault.items = await Promise.all(rows.map((r) => decryptRow(k, r)));
  key = k;
  idleAt = Date.now() + IDLE_MS;
  vault.status = 'open';
}

export async function unlock(passphrase) {
  vault.working = true;
  vault.error = '';
  try {
    const k = await unlockVault(passphrase, kdf, verifier);
    if (k) await openWith(k);
    else vault.error = 'La frase no es correcta.';
  } catch (e) {
    vault.error = e.message;
  } finally {
    vault.working = false;
  }
}

/** First use. The stored verifier is read back and opened, so a bad write is noticed while empty. */
export async function create(passphrase) {
  vault.working = true;
  vault.error = '';
  try {
    const { init } = await createVault(passphrase);
    try {
      await call('vaultInit', init);
    } catch (e) {
      if (e.code !== 'conflict') throw e; // conflict: an earlier attempt or another device got there first
    }
    await fetchList();
    const k = await unlockVault(passphrase, kdf, verifier);
    if (k) await openWith(k);
    else {
      vault.status = 'locked';
      vault.error = 'La bóveda ya existía con otra frase.';
    }
  } catch (e) {
    vault.error = e.message;
  } finally {
    vault.working = false;
  }
}

export async function saveItem({ id, project_id, kind, label, value }) {
  if (!key) throw new Error('La bóveda está cerrada');
  const k = key;
  const blob = await encryptItem(k, id, { kind, label, value });
  const row = await call('vaultUpsert', { item: { id, project_id: project_id || null, ...blob } });
  rows = [...rows.filter((r) => r.id !== id), row];
  if (key !== k) return; // locked while saving: the blob is stored, plaintext stays dropped
  const item = await decryptRow(k, row);
  if (key === k) vault.items = [...vault.items.filter((x) => x.id !== id), item];
}

export async function deleteItem(id) {
  await call('vaultDelete', { id });
  rows = rows.filter((r) => r.id !== id);
  vault.items = vault.items.filter((x) => x.id !== id);
  vault.revealed.delete(id);
}

export const itemById = (id) => vault.items.find((x) => x.id === id) || null;

export async function copyItem(id) {
  const item = itemById(id);
  if (!item || item.broken) return;
  await navigator.clipboard.writeText(item.value);
  vault.copied = { id, until: Date.now() + CLIP_MS };
}

// The browser only allows clipboard writes while focused; otherwise it is retried on return.
let clearing = false;
async function clearClipboardIfDue() {
  if (clearing || !vault.copied || Date.now() < vault.copied.until || !document.hasFocus()) return;
  clearing = true;
  const due = vault.copied;
  try {
    await navigator.clipboard.writeText('');
    if (vault.copied === due) vault.copied = null;
    onLock('clipboard');
  } catch (_) { /* retried on the next tick */ } finally {
    clearing = false;
  }
}
