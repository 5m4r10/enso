// Capture queue + sync. Every capture is stored on the device first, then sent; `capture` is
// idempotent by id, so resending after a lost answer is safe.
import { call, ensureToken } from './api.js';
import * as db from './db.js';
import { overlay, wire, settle, byTime } from './overlay.js';
import { state } from './store.js';
import { nowLocalIso, uuid } from './format.js';

const BATCH = 200; // server MAX_BATCH

export const sync = { status: 'idle', error: '' }; // idle | syncing | offline | signin | error

let base = null;
let entries = [];
let seq = 0;
let hooks = { changed() {}, synced() {}, forbidden() {} };
let running = null;
let again = false;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('enso-sync') : null;

export const pendingEntries = () => entries.filter((e) => e.state === 'pending');
export const failedEntries = () => entries.filter((e) => e.state === 'failed');

/** Local date of the last completion the snapshot does not contain yet, or null. */
export function pendingDone(milestoneId) {
  const list = entries.filter((e) => e.type === 'done' && e.milestone_id === milestoneId && e.state !== 'failed').sort(byTime);
  return list.length ? list.at(-1).ts_client.slice(0, 10) : null;
}

function publish() {
  if (base) {
    const r = overlay(base, entries);
    state.snap = r.snap;
    state.pendingLogs = r.pendingLogs;
  }
  state.now = nowLocalIso();
  hooks.changed();
}

async function readLocal() {
  [base, entries] = await Promise.all([db.getSnapshot(), db.getEntries()]);
  base ??= null;
}

export async function initSync(h) {
  hooks = h;
  try { await readLocal(); } catch (_) { /* no IndexedDB: online only, record() will say so */ }
  publish();
  if (channel) channel.onmessage = async () => { try { await readLocal(); publish(); } catch (_) { /* next sync */ } };
}

/** Stores a capture durably; resolves when it is safe on the device. */
export async function record({ type, project_id = null, milestone_id = null, note = null, anchor = null }) {
  const e = {
    id: uuid(), ts_client: nowLocalIso(), type, project_id, milestone_id, note: note || null,
    meta: anchor ? { anchor } : null, state: 'pending', error: null, seq: Date.now() * 1000 + (seq++ % 1000)
  };
  await db.putEntries([e]);
  entries = [...entries.filter((x) => x.id !== e.id), e];
  navigator.storage?.persist?.().catch(() => {});
  publish();
  channel?.postMessage('changed');
  runSync();
}

export async function discard(id) {
  await db.deleteEntry(id);
  entries = entries.filter((e) => e.id !== id);
  publish();
  channel?.postMessage('changed');
}

async function sendQueue() {
  entries = await db.getEntries();
  const todo = pendingEntries().sort(byTime);
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const settled = settle(chunk, await call('capture', { entries: chunk.map(wire) }));
    await db.putEntries(settled);
    const byId = new Map(settled.map((e) => [e.id, e]));
    entries = entries.map((e) => byId.get(e.id) || e);
  }
}

// One tab at a time. The token is obtained first: a tab waiting for sign-in must not hold the lock.
async function locked(fn) {
  await ensureToken();
  return navigator.locks ? navigator.locks.request('enso-sync', fn) : fn();
}

/** Before editing online: queued captures must reach the server first, in order. */
export async function flush() {
  if (pendingEntries().length) await locked(sendQueue);
  if (pendingEntries().length) throw new Error('Hay capturas por enviar');
}

async function once() {
  await locked(async () => {
    await sendQueue();
    // Only entries acknowledged BEFORE the snapshot request are certainly inside it.
    const covered = entries.filter((e) => e.state === 'sent').map((e) => e.id);
    const snap = await call('snapshot');
    base = snap;
    try {
      await db.commitSnapshot(snap, covered);
      entries = await db.getEntries();
    } catch (_) {
      entries = entries.filter((e) => !covered.includes(e.id));
    }
  });
}

/** Never rejects: the outcome is in sync.status. */
export function runSync() {
  if (running) { again = true; return running; }
  running = (async () => {
    sync.status = 'syncing';
    sync.error = '';
    hooks.changed();
    try {
      do { again = false; await once(); } while (again);
      sync.status = 'idle';
    } catch (e) {
      sync.error = e.message;
      sync.status = e.code === 'network' ? 'offline' : e.code === 'signin' ? 'signin' : 'error';
      if (e.code === 'forbidden') hooks.forbidden();
    } finally {
      running = null;
    }
    publish();
    if (sync.status === 'idle') {
      channel?.postMessage('changed');
      hooks.synced();
    }
  })();
  return running;
}

export const isSyncing = () => !!running;
