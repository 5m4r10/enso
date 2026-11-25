// Router, events and boot. Views are pure HTML renderers; all events are delegated here.
import { MOCK } from '../config.js';
import { initAuth, rejectAccount, renderSignInButton, cancelSignIn } from './auth.js';
import { call } from './api.js';
import { state, loadProjectLog, milestoneById, today } from './store.js';
import { sync, initSync, runSync, record, discard, flush, isSyncing, pendingEntries, failedEntries, pendingDone } from './sync.js';
import { nowLocalIso, uuid, esc, fmtShort } from './format.js';
import { renderReview } from './views/review.js';
import { renderCapture } from './views/capture.js';
import { renderProject } from './views/project.js';
import { renderVault, idleText, copiedText } from './views/vault.js';
import { vault, initVault, loadVault, unlock, unlockBio, removeBio, create, lock, saveItem, deleteItem, copyItem, itemById } from './vault.js';
import { MIN_PASSPHRASE } from './crypto.js';
import { readForm } from './views/forms.js';

const root = document.getElementById('app');
let route = parseRoute();
let lastRefresh = 0;
let toastTimer = null;

function parseRoute() {
  const h = location.hash.slice(1);
  if (!h) return { name: window.innerWidth >= 900 ? 'review' : 'capture' };
  const [name, id] = h.split('/');
  return { name, id: id ? decodeURIComponent(id) : null };
}

/** Form contents survive background re-renders; a form that is closed or reset is not restored. */
function keepForms() {
  const key = (form) => `${form.dataset.form}/${form.dataset.id || ''}/${form.dataset.project || ''}`;
  const saved = new Map([...root.querySelectorAll('form[data-form]')].map((form) =>
    [key(form), [...form.elements].filter((el) => el.name).map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value])]));
  const a = document.activeElement;
  const focus = a && root.contains(a) && (a.name || a.dataset.bind)
    ? { name: a.name, bind: a.dataset.bind, form: a.form ? key(a.form) : null, pos: a.type === 'text' ? a.selectionStart : null } : null;
  return () => {
    let target = focus?.bind ? root.querySelector(`[data-bind="${focus.bind}"]`) : null;
    for (const form of root.querySelectorAll('form[data-form]')) {
      for (const [name, value] of saved.get(key(form)) || []) {
        const el = form.elements[name];
        if (el) el[typeof value === 'boolean' ? 'checked' : 'value'] = value;
      }
      form.querySelector('[data-act-change]')?.dispatchEvent(new Event('change', { bubbles: true }));
      if (focus?.form === key(form) && focus.name) target = form.elements[focus.name];
    }
    if (target?.focus) {
      target.focus({ preventScroll: true });
      if (focus.pos !== null) target.setSelectionRange(focus.pos, focus.pos);
    }
  };
}

function render() {
  if (!state.snap) return;
  const restore = keepForms();
  const views = {
    review: renderReview,
    capture: renderCapture,
    project: () => renderProject(route.id),
    vault: renderVault
  };
  root.innerHTML = (views[route.name] || renderReview)();
  restore();
  document.title = route.name === 'capture' ? 'Ensō · Captura' : route.name === 'vault' ? 'Ensō · Bóveda' : 'Ensō';
}

// Background updates wait while text is being typed: replacing the input breaks Android's keyboard.
let stale = false;
function softRender() {
  const a = document.activeElement;
  stale = !!a && root.contains(a) && a.tagName === 'INPUT' && a.value !== '';
  if (!stale) render();
}
root.addEventListener('focusout', () => setTimeout(() => { if (stale) softRender(); }));

function toast(msg, isError = false, sticky = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `toast${isError ? ' is-error' : ''}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 2500);
}

// Online-only edits (projects, milestones, vault) run one at a time.
let pending = 0;
let tail = Promise.resolve();

function enqueue(fn) {
  pending++;
  const run = tail.then(fn).finally(() => { pending--; });
  tail = run.catch(() => {});
  return run;
}

/** Online-only edit: sends queued captures first, runs the mutation, then syncs in the background. */
async function act(fn, okMsg) {
  if (state.ui.busy) { toast('Guardando el cambio anterior…', false, true); return; }
  state.ui.busy = true;
  render();
  if (sync.status === 'signin') showGate();
  toast('Guardando…', false, true);
  try {
    await enqueue(async () => { await flush(); return fn(); });
    toast(okMsg || 'Guardado');
  } catch (e) {
    toast(`No se pudo guardar: ${e.message}`, true);
    return;
  } finally {
    state.ui.busy = false;
    render();
  }
  runSync();
}

/** Capture: safe on this device before it says so; sending happens in the background. */
async function save(entry, okMsg) {
  try {
    await record(entry);
    toast(navigator.onLine === false ? `${okMsg} · se enviará al reconectar` : okMsg);
    return true;
  } catch (_) {
    toast('No se pudo guardar en este dispositivo', true);
    return false;
  }
}

const recording = new Set();
async function complete(milestoneId, anchor, note, okMsg) {
  // Twice the same day is a double tap, not a second cycle.
  if (recording.has(milestoneId) || pendingDone(milestoneId) === today()) return false;
  recording.add(milestoneId);
  const ok = await save({ type: 'done', milestone_id: milestoneId, project_id: milestoneById(milestoneId)?.project_id, anchor, note }, okMsg);
  recording.delete(milestoneId);
  return ok;
}

window.addEventListener('beforeunload', (e) => { if (pending) e.preventDefault(); });

const clicks = {
  'open-project': (el) => { location.hash = `#project/${encodeURIComponent(el.dataset.id)}`; },
  'register-review': () => save({ type: 'review' }, 'Revisión registrada'),
  'new-project': () => { state.ui.form = { type: 'project', id: null }; render(); },
  'edit-project': (el) => { state.ui.form = { type: 'project', id: el.dataset.id }; render(); },
  'archive-project': (el) => {
    if (!window.confirm('¿Archivar este proyecto? Sus eventos de Calendar se eliminarán.')) return;
    state.ui.form = null;
    act(() => call('upsertProject', { project: { id: el.dataset.id, status: 'archived' } }), 'Proyecto archivado')
      .then(() => { location.hash = '#review'; });
  },
  'new-milestone': () => { state.ui.form = { type: 'milestone', id: null }; render(); },
  'edit-milestone': (el) => { state.ui.form = { type: 'milestone', id: el.dataset.id }; state.ui.confirmMilestone = null; render(); },
  'archive-milestone': (el) => {
    state.ui.form = null;
    act(() => call('upsertMilestone', { milestone: { id: el.dataset.id, status: 'archived' } }), 'Hito archivado');
  },
  'cancel-form': () => { state.ui.form = null; render(); },
  confirm: (el) => { state.ui.confirmMilestone = el.dataset.id; render(); },
  'cancel-confirm': () => { state.ui.confirmMilestone = null; render(); },
  complete: (el) => {
    state.ui.confirmMilestone = null;
    complete(el.dataset.id, el.dataset.anchor || null, '', `Hecho · ${milestoneById(el.dataset.id)?.title || ''}`);
  },
  reopen: (el) => act(() => call('upsertMilestone', { milestone: { id: el.dataset.id, status: 'open' } }), 'Hito reabierto'),
  'pick-project': (el) => {
    const c = state.ui.capture;
    if (c.projectId !== el.dataset.id) { c.projectId = el.dataset.id; c.milestoneId = null; }
    render();
  },
  'pick-milestone': (el) => {
    const c = state.ui.capture;
    c.milestoneId = c.milestoneId === el.dataset.id ? null : el.dataset.id;
    render();
  },
  'capture-done': async (el) => {
    const c = state.ui.capture;
    const id = c.milestoneId, note = c.note;
    if (!await complete(id, el.dataset.anchor || null, note.trim(), `Hecho · ${milestoneById(id)?.title || ''}`)) return;
    if (c.note === note) c.note = '';
    if (c.milestoneId === id) c.milestoneId = null;
    render();
  },
  'save-note': async () => {
    const c = state.ui.capture;
    const note = c.note;
    if (!note.trim() || !c.projectId || recording.has('note')) return;
    recording.add('note');
    const ok = await save({ type: 'note', project_id: c.projectId, note: note.trim() }, 'Nota guardada');
    recording.delete('note');
    if (ok && c.note === note) c.note = '';
    render();
  }
};

/* ---------- vault ---------- */

async function enterVault() {
  if (route.name !== 'vault' || vault.status === 'open') return;
  const p = loadVault();
  if (sync.status === 'signin') showGate();
  render();
  await p;
  render();
  focusPassphrase();
}

function focusPassphrase() {
  if (window.innerWidth >= 900 && route.name === 'vault' && !document.getElementById('gate')) document.getElementById('pp')?.focus();
}

Object.assign(clicks, {
  'vault-retry': () => enterVault(),
  'vault-bio': async () => {
    if (vault.working) return;
    const p = unlockBio();
    render();
    await p;
    render();
  },
  'vault-use-pass': () => { vault.usePass = true; vault.error = ''; render(); document.getElementById('pp')?.focus(); },
  'vault-remove-bio': async () => {
    if (!window.confirm('¿Quitar la huella en este dispositivo? Se abrirá de nuevo con la frase.')) return;
    try { await removeBio(); toast('Huella quitada'); } catch (_) { toast('No se pudo quitar', true); }
    render();
  },
  'vault-lock': () => lock('user'),
  'vault-new': () => { state.ui.form = { type: 'vault', id: null }; render(); },
  'vault-edit': (el) => { state.ui.form = { type: 'vault', id: el.dataset.id }; render(); },
  'vault-filter': (el) => { vault.filter = el.dataset.id; render(); },
  'vault-toggle': (el) => {
    const id = el.dataset.id;
    if (!vault.revealed.delete(id)) vault.revealed.add(id);
    render();
  },
  'vault-copy': async (el) => {
    try { await copyItem(el.dataset.id); render(); } catch (_) { toast('El navegador no permitió copiar', true); }
  },
  'vault-delete': (el) => {
    const label = itemById(el.dataset.id)?.label || 'esta entrada';
    if (!window.confirm(`¿Eliminar «${label}»? No se puede deshacer.`)) return;
    act(async () => { await deleteItem(el.dataset.id); state.ui.form = null; }, 'Entrada eliminada');
  }
});

/** Passphrase fields are emptied as soon as they are read. */
async function submitPassphrase(form, type) {
  if (vault.working) return;
  const pass = form.pass.value, pass2 = form.pass2?.value, withBio = !!form.elements.bio?.checked;
  if (type === 'vault-create') {
    vault.error = pass.normalize('NFKC').length < MIN_PASSPHRASE ? `Usa al menos ${MIN_PASSPHRASE} caracteres.`
      : pass !== pass2 ? 'Las frases no coinciden.' : '';
    if (vault.error) { form.reset(); render(); focusPassphrase(); return; }
  }
  form.reset();
  const p = type === 'vault-create' ? create(pass, withBio) : unlock(pass, withBio);
  render();
  const notice = await p;
  if (notice) toast(notice, true);
  render();
  focusPassphrase();
}

function submitVaultItem(form) {
  if (state.ui.busy) { toast('Guardando el cambio anterior…', false, true); return; }
  const item = {
    id: form.dataset.id || uuid(), project_id: form.project_id.value || null, kind: form.kind.value,
    label: form.elements.label.value.trim(), value: form.elements.value.value
  };
  if (!item.label || !item.value) { toast('Faltan el nombre o el valor', true); return; }
  // The form stays open until the server confirms, so a failure does not lose what was typed.
  act(async () => { await saveItem(item); state.ui.form = null; }, 'Entrada guardada');
}

initVault((reason) => {
  if (reason === 'clipboard') { if (route.name === 'vault') render(); return; }
  if (state.ui.form?.type === 'vault') state.ui.form = null;
  if (reason === 'idle') toast('Bóveda cerrada por inactividad');
  if (route.name === 'vault') { render(); focusPassphrase(); }
});

setInterval(() => {
  if (route.name !== 'vault' || vault.status !== 'open') return;
  const idle = root.querySelector('[data-idle]'), copied = root.querySelector('[data-copied]');
  if (idle) idle.textContent = idleText();
  if (copied && vault.copied) copied.textContent = copiedText();
}, 1000);

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act], a[href]');
  if (el?.dataset.act && clicks[el.dataset.act]) {
    e.preventDefault();
    clicks[el.dataset.act](el);
  }
});

root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.project[data-act]')) clicks['open-project'](e.target);
});

root.addEventListener('input', (e) => {
  if (e.target.dataset.bind === 'vault-query') { vault.query = e.target.value; render(); return; }
  if (e.target.dataset.bind === 'note') {
    state.ui.capture.note = e.target.value;
    const save = root.querySelector('[data-act="save-note"]');
    if (save) save.disabled = !e.target.value.trim() || state.ui.busy;
  }
});

root.addEventListener('change', (e) => {
  if (e.target.dataset.actChange === 'kind') {
    const form = e.target.closest('form');
    form.querySelectorAll('[data-only]').forEach((n) => { n.hidden = n.dataset.only !== e.target.value; });
  }
});

root.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const type = form.dataset.form;
  if (type === 'note') {
    const note = form.note.value.trim();
    if (!note) return;
    if (recording.has('note')) return;
    recording.add('note');
    save({ type: 'note', project_id: form.dataset.project, note }, 'Nota guardada').then((ok) => {
      recording.delete('note');
      const input = root.querySelector('.compose input');
      if (ok && input?.value.trim() === note) input.value = '';
      render();
    });
    return;
  }
  if (type === 'vault-create' || type === 'vault-unlock') { submitPassphrase(form, type); return; }
  if (type === 'vault-item') { submitVaultItem(form); return; }
  const data = readForm(form);
  if (data.error) { toast(data.error, true); return; }
  if (type === 'project') {
    if (state.ui.busy) { toast('Guardando el cambio anterior…', false, true); return; }
    const project = { id: form.dataset.id || uuid(), ...data.project };
    act(async () => {
      const saved = await call('upsertProject', { project });
      // An older deployed backend ignores the field: do not report it as saved.
      if ((saved.keep_url || null) !== project.keep_url) throw new Error('el servidor aún no admite la nota de Keep; lo demás sí se guardó');
      state.ui.form = null;
    }, 'Proyecto guardado');
  } else if (type === 'milestone') {
    if (state.ui.busy) { toast('Guardando el cambio anterior…', false, true); return; }
    const milestone = { id: form.dataset.id || uuid(), project_id: form.dataset.project, ...data.milestone };
    act(async () => { await call('upsertMilestone', { milestone }); state.ui.form = null; }, 'Hito guardado');
  }
});

window.addEventListener('hashchange', async () => {
  route = parseRoute();
  state.ui.form = null;
  state.ui.confirmMilestone = null;
  window.scrollTo(0, 0);
  render();
  enterVault();
  if (route.name === 'project' && route.id && !state.projectLogs[route.id]) {
    await loadLog();
  }
});

// Live clock for timers; never re-render while the user is typing.
setInterval(() => {
  state.now = nowLocalIso();
  if (document.activeElement?.tagName !== 'INPUT' && !state.ui.form) render();
}, 60000);

async function loadLog() {
  const id = route.id;
  try { await loadProjectLog(id); } catch (_) { /* the view says it is unavailable */ }
  softRender();
}

/* ---------- sync triggers and status bar ---------- */

const bar = document.createElement('div');
bar.id = 'sync';
bar.setAttribute('role', 'status');
bar.hidden = true;
root.before(bar);
let newVersion = null;

const count = (n) => `${n} por enviar`;

function renderBar() {
  const n = pendingEntries().length, failed = failedEntries();
  const btn = (act, text, id = '') => `<button class="link-ul" data-act="${act}" data-id="${esc(id)}">${text}</button>`;
  let line = '';
  if (navigator.onLine === false || sync.status === 'offline') line = `Sin conexión${n ? ` · ${count(n)}` : ''}`;
  else if (sync.status === 'signin') line = `Falta iniciar sesión${n ? ` · ${count(n)}` : ''} ${btn('sign-in', 'Entrar')}`;
  else if (sync.status === 'error') line = `No se pudo sincronizar: ${esc(sync.error)}${n ? ` · ${count(n)}` : ''} ${btn('sync-now', 'Reintentar')}`;
  else if (n) line = `Enviando · ${count(n)}`;
  const parts = line ? [`<p class="num">${line}</p>`] : [];
  for (const e of failed) {
    const what = e.type === 'done' ? `Hecho · ${milestoneById(e.milestone_id)?.title || 'hito'}` : e.type === 'note' ? 'Nota' : 'Revisión';
    parts.push(`<p><span class="shu">No aceptado:</span> ${esc(what)}${e.note ? ` · «${esc(e.note)}»` : ''} · ${esc(fmtShort(e.ts_client))} (${esc(e.error)}) ${btn('discard', 'Descartar', e.id)}</p>`);
  }
  if (newVersion) parts.push(`<p>Hay una versión nueva ${btn('update-app', 'Actualizar')}</p>`);
  bar.innerHTML = parts.join('');
  bar.hidden = !parts.length;
}

Object.assign(clicks, {
  'sign-in': () => showGate(),
  'sync-now': () => runSync(),
  discard: (el) => {
    if (window.confirm('¿Descartar esta captura? No se puede deshacer.')) discard(el.dataset.id).catch(() => toast('No se pudo descartar', true));
  },
  'update-app': () => {
    if (pending) { toast('Guardando el cambio anterior…'); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    newVersion.postMessage('activate');
  }
});
bar.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) clicks[el.dataset.act](el);
});

async function syncNow() {
  await runSync();
  lastRefresh = Date.now();
}

window.addEventListener('online', syncNow);
window.addEventListener('offline', renderBar);
setInterval(() => {
  if (pendingEntries().length && !isSyncing() && navigator.onLine !== false && sync.status !== 'signin') syncNow();
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || pending || isSyncing()) return;
  if (pendingEntries().length || Date.now() - lastRefresh > 5 * 60000) syncNow();
});

async function registerWorker() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!('serviceWorker' in navigator) || (local && !new URLSearchParams(location.search).has('sw'))) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const offer = (w) => { if (w && navigator.serviceWorker.controller) { newVersion = w; renderBar(); } };
    offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
  } catch (_) { /* the app works without it, only not offline */ }
}

// Overlay, not a replacement view: an expired session must not discard text being typed.
function showGate(message = '') {
  hideGate();
  const el = document.createElement('div');
  el.id = 'gate';
  el.innerHTML = `<div class="page"><section class="gate">
    <h1>Ensō</h1><p>${esc(message || 'Inicia sesión con tu cuenta de Google para continuar.')}</p>
    <div class="gis" id="gis"></div>${state.snap ? '<button class="btn-quiet later">Ahora no</button>' : ''}</section></div>`;
  el.querySelector('.later')?.addEventListener('click', () => { hideGate(); cancelSignIn(); });
  document.body.append(el);
  renderSignInButton(el.querySelector('#gis')).catch((e) => { el.querySelector('p').textContent = e.message; });
}

function hideGate() {
  document.getElementById('gate')?.remove();
}

// With pending calls the original request resumes by itself; otherwise start over.
function onSignedIn({ pending: waiting }) {
  hideGate();
  if (isSyncing()) sync.status = 'syncing';
  renderBar();
  if (!waiting) syncNow();
}

// With local data the app stays usable and the bar asks; a full gate only when there is nothing to
// show or the owner is waiting for an online operation.
function onNeedSignIn() {
  if (!state.snap || state.ui.busy || vault.status === 'loading') { showGate(); return; }
  sync.status = 'signin';
  renderBar();
}

function onForbidden() {
  rejectAccount();
  showGate('Esta cuenta no es la dueña de Ensō.');
}

async function boot() {
  root.innerHTML = '<div class="page"><p class="empty">Cargando…</p></div>';
  if (!MOCK) initAuth({ needSignIn: onNeedSignIn, signedIn: onSignedIn });
  registerWorker();
  await initSync({
    changed: () => { softRender(); renderBar(); },
    synced: () => {
      if (route.name !== 'project') state.projectLogs = {}; // written from elsewhere: re-read on next visit
      else if (route.id) loadLog();
    },
    forbidden: onForbidden
  });
  if (state.snap) enterVault();
  const had = !!state.snap;
  await syncNow();
  if (!had && state.snap) enterVault();
  if (!state.snap && !document.getElementById('gate')) {
    root.innerHTML = `<div class="page"><section class="gate"><h1>Ensō</h1><p class="shu">${esc(sync.error)}</p>
      <button class="link-ul" data-act="sync-now">Reintentar</button></section></div>`;
  }
}

boot();
