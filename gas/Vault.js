/*
 * Vault.js — opaque blob storage. The server never sees plaintext: label, value and kind are
 * inside the AES-GCM ciphertext produced by the client. Edits are logged only as "vault updated"
 * with type 'vault' (not activity, see domain countsAsActivity).
 */

var MAX_CIPHERTEXT = 45000; // Sheets cell limit is 50k chars
var MAX_IV = 64;
var MAX_SALT = 128;
var MIN_KDF_ITERATIONS = 100000;
var MAX_KDF_ITERATIONS = 10000000;

function actionVaultList_() {
  var meta = getMeta_();
  return {
    kdf: meta.kdf_salt ? { salt: meta.kdf_salt, iterations: Number(meta.kdf_iterations) } : null,
    verifier: meta.verifier_ct ? { ct: meta.verifier_ct, iv: meta.verifier_iv } : null,
    items: readAll_('vault').map(clean_)
  };
}

/**
 * One-time initialization of KDF params + verifier. Refuses if a verifier exists, so a client
 * bug cannot overwrite it and lock the owner out of existing blobs.
 * payload: {kdf_salt, kdf_iterations, verifier_ct, verifier_iv}
 */
function actionVaultInit_(p) {
  require_(isB64_(p.kdf_salt, MAX_SALT), 'kdf_salt must be base64');
  require_(Number.isInteger(p.kdf_iterations) && p.kdf_iterations >= MIN_KDF_ITERATIONS &&
    p.kdf_iterations <= MAX_KDF_ITERATIONS, 'kdf_iterations out of range');
  require_(isB64_(p.verifier_ct, MAX_IV * 8), 'verifier_ct must be base64');
  require_(isB64_(p.verifier_iv, MAX_IV), 'verifier_iv must be base64');

  return withLock_(function () {
    if (getMeta_().verifier_ct) throw apiError_('conflict', 'Vault already initialized');
    setMeta_('kdf_salt', p.kdf_salt);
    setMeta_('kdf_iterations', String(p.kdf_iterations));
    setMeta_('verifier_ct', p.verifier_ct);
    setMeta_('verifier_iv', p.verifier_iv);
    return { initialized: true };
  });
}

/** payload: {item: {id, project_id?, ciphertext, iv}} */
function actionVaultUpsert_(payload) {
  var item = payload.item;
  require_(item && typeof item === 'object', 'item is required');
  require_(isUuid_(item.id), 'item.id must be a uuid');
  require_(item.project_id == null || isUuid_(item.project_id), 'project_id must be a uuid');
  require_(isB64_(item.ciphertext, MAX_CIPHERTEXT), 'ciphertext must be base64 (max ' + MAX_CIPHERTEXT + ')');
  require_(isB64_(item.iv, MAX_IV), 'iv must be base64');

  return withLock_(function () {
    if (!getMeta_().verifier_ct) throw apiError_('conflict', 'Vault not initialized');
    if (item.project_id && !findById_(readAll_('projects'), item.project_id)) {
      throw apiError_('not_found', 'Unknown project');
    }
    var existing = findById_(readAll_('vault'), item.id);
    var row = existing || { id: item.id };
    row.project_id = item.project_id || null;
    row.ciphertext = item.ciphertext;
    row.iv = item.iv;
    row.updated_at = nowLocalIso_();
    writeRow_('vault', row);
    appendRows_('log', [serverLog_('vault', row.project_id, null, 'vault updated', null)]);
    return clean_(row);
  });
}

/** payload: {id} */
function actionVaultDelete_(p) {
  require_(isUuid_(p.id), 'id must be a uuid');
  return withLock_(function () {
    var existing = findById_(readAll_('vault'), p.id);
    if (!existing) return { deleted: false };
    deleteRow_('vault', existing._row);
    appendRows_('log', [serverLog_('vault', existing.project_id, null, 'vault updated', null)]);
    return { deleted: true };
  });
}
