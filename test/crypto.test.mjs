import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../web/js/crypto.js', import.meta.url), 'utf8');
const c = await import('data:text/javascript,' + encodeURIComponent(src));
const PASS = 'frase de prueba ñandú 42';
const { key, init } = await c.createVault(PASS);
const kdf = { salt: init.kdf_salt, iterations: init.kdf_iterations };
const verifier = { ct: init.verifier_ct, iv: init.verifier_iv };
const ID = '11111111-1111-4111-8111-111111111111';
const item = { kind: 'secret', label: 'Wi-Fi ñ 日本', value: 'a"b\\c' };
const flip = (b64) => { const b = c.fromB64(b64); b[0] ^= 1; return c.toB64(b); };

test('unlock: right passphrase, wrong passphrase, unicode normalization', async () => {
  assert.ok(await c.unlockVault(PASS, kdf, verifier));
  assert.equal(await c.unlockVault(PASS + ' ', kdf, verifier), null);
  assert.ok(await c.unlockVault(PASS.normalize('NFD'), kdf, verifier));
});

test('round trip with a re-derived key; nothing readable in the blob', async () => {
  const row = { id: ID, ...(await c.encryptItem(key, ID, item)) };
  assert.deepEqual(await c.decryptItem(await c.unlockVault(PASS, kdf, verifier), row), item);
  const raw = Buffer.from(row.ciphertext, 'base64').toString('utf8');
  for (const s of ['Wi-Fi', 'secret', 'label']) assert.ok(!raw.includes(s));
});

test('tampered, swapped or foreign blobs are rejected', async () => {
  const row = { id: ID, ...(await c.encryptItem(key, ID, item)) };
  await assert.rejects(c.decryptItem(key, { ...row, ciphertext: flip(row.ciphertext) }));
  await assert.rejects(c.decryptItem(key, { ...row, iv: flip(row.iv) }));
  await assert.rejects(c.decryptItem(key, { ...row, id: ID.replace(/1$/, '2') }));
  await assert.rejects(c.decryptItem((await c.createVault('otra frase distinta')).key, row));
});

test('fresh iv every time; key not extractable; weak KDF refused', async () => {
  const a = await c.encryptItem(key, ID, item), b = await c.encryptItem(key, ID, item);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  await assert.rejects(crypto.subtle.exportKey('raw', key));
  await assert.rejects(c.unlockVault(PASS, { ...kdf, iterations: 1000 }, verifier));
});

test('device unlock: wrap and unwrap the key; wrong secret, id or blob rejected', async () => {
  const r = await c.unlockWithRaw(PASS, kdf, verifier);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const rec = { id: 'Y3JlZA==', ...(await c.wrapRaw(secret, r.raw, 'Y3JlZA==')) };
  const raw = await c.unwrapRaw(secret, rec);
  assert.deepEqual(raw, r.raw);
  const row = { id: ID, ...(await c.encryptItem(key, ID, item)) };
  assert.deepEqual(await c.decryptItem(await c.keyFromRaw(raw, verifier), row), item);
  await assert.rejects(c.unwrapRaw(crypto.getRandomValues(new Uint8Array(32)), rec));
  await assert.rejects(c.unwrapRaw(secret, { ...rec, id: 'b3Rybw==' }));
  await assert.rejects(c.unwrapRaw(secret, { ...rec, ct: flip(rec.ct) }));
  assert.equal(await c.keyFromRaw(new Uint8Array(32), verifier), null);
});

test('init payload satisfies the server validation', () => {
  const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
  for (const k of ['kdf_salt', 'verifier_ct', 'verifier_iv']) assert.match(init[k], B64);
  assert.ok(init.verifier_iv.length <= 64 && init.kdf_salt.length <= 128 && init.kdf_iterations === 600000);
});
