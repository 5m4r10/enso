// IndexedDB: the capture queue, the last server snapshot and, if enabled, the vault key
// encrypted for this device's authenticator (biometric.js). Vault contents are never stored.
import { MOCK } from '../config.js';

let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(MOCK ? 'enso-mock' : 'enso', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('queue', { keyPath: 'id' });
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); opening = null; };
      resolve(req.result);
    };
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

/** Resolves when the transaction is durable, not merely when the request succeeded. */
async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode, { durability: 'strict' });
    const req = fn(t);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error || new Error('IndexedDB'));
  });
}

export const getSnapshot = () => tx(['kv'], 'readonly', (t) => t.objectStore('kv').get('snapshot'));
export const getDevice = () => tx(['kv'], 'readonly', (t) => t.objectStore('kv').get('device-unlock'));
export const putDevice = (r) => tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').put(r, 'device-unlock'); });
export const deleteDevice = () => tx(['kv'], 'readwrite', (t) => { t.objectStore('kv').delete('device-unlock'); });
export const getEntries = () => tx(['queue'], 'readonly', (t) => t.objectStore('queue').getAll());
export const putEntries = (list) => tx(['queue'], 'readwrite', (t) => { list.forEach((e) => t.objectStore('queue').put(e)); });
export const deleteEntry = (id) => tx(['queue'], 'readwrite', (t) => { t.objectStore('queue').delete(id); });

/** New snapshot and removal of the entries it already contains, in one transaction. */
export const commitSnapshot = (snap, coveredIds) => tx(['kv', 'queue'], 'readwrite', (t) => {
  t.objectStore('kv').put(snap, 'snapshot');
  coveredIds.forEach((id) => t.objectStore('queue').delete(id));
});
