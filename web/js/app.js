// Router, events and boot. Views are pure HTML renderers; all events are delegated here.
/* global completeMilestone */
import { MOCK } from '../config.js';
import { initAuth, rejectAccount, renderSignInButton } from './auth.js';
import { call } from './api.js';
import { state, refresh, loadProjectLog, milestoneById, today } from './store.js';
import { nowLocalIso, uuid, esc } from './format.js';
import { renderReview } from './views/review.js';
import { renderCapture } from './views/capture.js';
import { renderProject } from './views/project.js';
import { renderVault, idleText, copiedText } from './views/vault.js';
import { vault, initVault, loadVault, unlock, create, lock, saveItem, deleteItem, copyItem, itemById } from './vault.js';
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
    [key(form), [...form.elements].filter((el) => el.name).map((el) => [el.name, el.value])]));
  const a = document.activeElement;
  const focus = a && root.contains(a) && (a.name || a.dataset.bind)
    ? { name: a.name, bind: a.dataset.bind, form: a.form ? key(a.form) : null, pos: a.type === 'text' ? a.selectionStart : null } : null;
  return () => {
    let target = focus?.bind ? root.querySelector(`[data-bind="${focus.bind}"]`) : null;
    for (const form of root.querySelectorAll('form[data-form]')) {
      for (const [name, value] of saved.get(key(form)) || []) {
        if (form.elements[name]) form.elements[name].value = value;
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
  document.title = route.name === 'capture' ? 'Enso · Captura' : route.name === 'vault' ? 'Enso · Bóveda' : 'Enso';
}

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

// Apps Script takes seconds per call. Writes run one at a time; the snapshot and the log are
// re-read (in parallel) only when no write is left, so a refresh never undoes a pending change.
let pending = 0;
let tail = Promise.resolve();

function enqueue(fn) {
  pending++;
  const run = tail.then(fn).finally(() => { pending--; });
  tail = run.catch(() => {});
  return run;
}

async function reload() {
  if (pending) return;
  if (route.name !== 'project') state.projectLogs = {}; // written from elsewhere: re-read on next visit
  await Promise.all([refresh(), route.name === 'project' && route.id ? loadProjectLog(route.id) : null]);
  lastRefresh = Date.now();
}

/** The write already succeeded: a failed re-read must not be reported as a failed save. */
async function reloadQuietly() {
  try { await reload(); } catch (_) { toast('Guardado, pero no se pudo actualizar la vista', true); }
  render();
}

/** Runs a mutation, confirms it, then refreshes in the background. */
async function act(fn, okMsg) {
  if (state.ui.busy) { toast('Guardando el cambio anterior…', false, true); return; }
  state.ui.busy = true;
  render();
  toast('Guardando…', false, true);
  try {
    await enqueue(fn);
    toast(okMsg || 'Guardado');
  } catch (e) {
    toast(`No se pudo guardar: ${e.message}`, true);
    return;
  } finally {
    state.ui.busy = false;
    render();
  }
  await reloadQuietly();
}

/** Optimistic completion: same domain rule as the server, reverted if the write fails. */
async function complete(milestoneId, anchor, note, okMsg, onFail) {
  const m = milestoneById(milestoneId);
  if (!m || state.ui.saving.has(milestoneId)) return;
  const entry = { id: uuid(), ts_client: nowLocalIso(), milestone_id: milestoneId, anchor: anchor || undefined, note: note || undefined };
  const before = { ...m };
  const r = completeMilestone(m, today(), m.kind === 'once' ? null : (anchor || m.anchor));
  Object.assign(m, { status: r.status, next_due: r.next_due, last_done_at: r.last_done_at });
  state.ui.saving.add(milestoneId);
  render();
  toast('Guardando…', false, true);
  try {
    await enqueue(() => call('complete', entry));
    toast(okMsg);
  } catch (e) {
    const current = milestoneById(milestoneId);
    if (current) Object.assign(current, before);
    onFail?.();
    toast(`No se pudo guardar: ${e.message}`, true);
    return;
  } finally {
    state.ui.saving.delete(milestoneId);
    render();
  }
  await reloadQuietly();
}

window.addEventListener('beforeunload', (e) => { if (pending) e.preventDefault(); });

const clicks = {
  'open-project': (el) => { location.hash = `#project/${encodeURIComponent(el.dataset.id)}`; },
  'register-review': () => act(() => call('review', { id: uuid(), ts_client: nowLocalIso() }), 'Revisión registrada'),
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
    complete(el.dataset.id, el.dataset.anchor, '', `Hecho · ${milestoneById(el.dataset.id)?.title || ''}`);
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
  'capture-done': (el) => {
    const c = state.ui.capture;
    const title = milestoneById(c.milestoneId)?.title || '';
    const note = c.note.trim();
    const id = c.milestoneId;
    c.note = '';
    c.milestoneId = null;
    complete(id, el.dataset.anchor, note, `Hecho · ${title}`, () => {
      if (!c.note && !c.milestoneId) Object.assign(c, { note, milestoneId: id });
    });
  },
  'save-note': () => {
    const c = state.ui.capture;
    const note = c.note.trim();
    if (!note || !c.projectId) return;
    act(async () => {
      await call('capture', { entries: [{ id: uuid(), ts_client: nowLocalIso(), type: 'note', project_id: c.projectId, note }] });
      c.note = '';
    }, 'Nota guardada');
  }
};

/* ---------- vault ---------- */

async function enterVault() {
  if (route.name !== 'vault' || vault.status === 'open') return;
  const p = loadVault();
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
  const pass = form.pass.value, pass2 = form.pass2?.value;
  if (type === 'vault-create') {
    vault.error = pass.normalize('NFKC').length < MIN_PASSPHRASE ? `Usa al menos ${MIN_PASSPHRASE} caracteres.`
      : pass !== pass2 ? 'Las frases no coinciden.' : '';
    if (vault.error) { form.reset(); render(); focusPassphrase(); return; }
  }
  form.reset();
  const p = type === 'vault-create' ? create(pass) : unlock(pass);
  render();
  await p;
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
  const el = e.target.closest('[data-act]');
  if (el && clicks[el.dataset.act]) {
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
    act(async () => {
      await call('capture', { entries: [{ id: uuid(), ts_client: nowLocalIso(), type: 'note', project_id: form.dataset.project, note }] });
      root.querySelector('.compose')?.reset();
    }, 'Nota guardada');
    return;
  }
  if (type === 'vault-create' || type === 'vault-unlock') { submitPassphrase(form, type); return; }
  if (type === 'vault-item') { submitVaultItem(form); return; }
  const data = readForm(form);
  if (data.error) { toast(data.error, true); return; }
  if (type === 'project') {
    if (state.ui.busy) { toast('Guardando el cambio anterior…', false, true); return; }
    const project = { id: form.dataset.id || uuid(), ...data.project };
    state.ui.form = null;
    act(() => call('upsertProject', { project }), 'Proyecto guardado');
  } else if (type === 'milestone') {
    if (state.ui.busy) { toast('Guardando el cambio anterior…', false, true); return; }
    const milestone = { id: form.dataset.id || uuid(), project_id: form.dataset.project, ...data.milestone };
    state.ui.form = null;
    act(() => call('upsertMilestone', { milestone }), 'Hito guardado');
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
    try { await loadProjectLog(route.id); } catch (e) { toast(e.message, true); }
    render();
  }
});

// Live clock for timers; never re-render while the user is typing.
setInterval(() => {
  state.now = nowLocalIso();
  if (document.activeElement?.tagName !== 'INPUT' && !state.ui.form) render();
}, 60000);

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.snap || pending || Date.now() - lastRefresh < 5 * 60000) return;
  try { await refresh(); lastRefresh = Date.now(); if (!state.ui.form) render(); } catch (_) { /* keep last snapshot */ }
});

// Overlay, not a replacement view: an expired session must not discard text being typed.
function showGate(message = '') {
  hideGate();
  const el = document.createElement('div');
  el.id = 'gate';
  el.innerHTML = `<div class="page"><section class="gate">
    <h1>Enso</h1><p>${esc(message || 'Inicia sesión con tu cuenta de Google para continuar.')}</p>
    <div class="gis" id="gis"></div></section></div>`;
  document.body.append(el);
  renderSignInButton(el.querySelector('#gis'));
}

function hideGate() {
  document.getElementById('gate')?.remove();
}

// With pending calls the original request resumes by itself; otherwise start over.
function onSignedIn({ pending }) {
  hideGate();
  if (!pending && !state.snap) boot();
}

async function boot() {
  root.innerHTML = '<div class="page"><p class="empty">Cargando…</p></div>';
  try {
    if (!MOCK) await initAuth({ needSignIn: () => showGate(), signedIn: onSignedIn });
    await refresh();
    lastRefresh = Date.now();
    render();
    if (route.name === 'project' && route.id) { await loadProjectLog(route.id); render(); }
    enterVault();
  } catch (e) {
    if (e.code === 'forbidden' && !MOCK) {
      rejectAccount();
      return showGate('Esta cuenta no es la dueña de Enso.');
    }
    root.innerHTML = `<div class="page"><section class="gate"><h1>Enso</h1><p class="shu">${esc(e.message)}</p></section></div>`;
  }
}

boot();
