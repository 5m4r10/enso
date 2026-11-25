// In-memory backend for ?mock=1 on localhost. Same contract as gas/, same domain rules.
/* global completeMilestone, dueOf */
import { nowLocalIso } from './format.js';

const P = { tesis: 'p-tesis', casa: 'p-casa', vps: 'p-vps', coche: 'p-coche', jp: 'p-jp' };
const ts = (d, t = '09:00') => `${d}T${t}:00-06:00`;
let n = 0;
const id = (p) => `${p}-${++n}`;

const db = {
  projects: [
    { id: P.tesis, name: 'Tesis', stale_days: 14, status: 'active', sort: 0, created_at: ts('2026-08-01') },
    { id: P.casa, name: 'Casa', stale_days: 14, status: 'active', sort: 1, created_at: ts('2026-09-03') },
    { id: P.vps, name: 'Servidor VPS', stale_days: 21, status: 'active', sort: 2, created_at: ts('2026-06-10') },
    { id: P.coche, name: 'Coche', stale_days: 14, status: 'active', sort: 3, created_at: ts('2026-07-15') },
    { id: P.jp, name: 'Japonés', stale_days: 7, status: 'active', sort: 4, created_at: ts('2026-05-01') }
  ],
  milestones: [
    ...['Marco teórico', 'Capítulo 1', 'Capítulo 2'].map((t) => ({ id: id('m'), project_id: P.tesis, title: t, kind: 'once', status: 'done', due_date: null })),
    { id: id('m'), project_id: P.tesis, title: 'Enviar formato de registro', kind: 'once', status: 'open', due_date: '2026-11-23' },
    { id: id('m'), project_id: P.tesis, title: 'Entregar capítulo 4', kind: 'once', status: 'open', due_date: '2026-11-27' },
    { id: id('m'), project_id: P.tesis, title: 'Reunión con asesora', kind: 'once', status: 'open', due_date: '2026-12-04' },
    { id: id('m'), project_id: P.tesis, title: 'Capítulo 5', kind: 'once', status: 'open', due_date: null },
    { id: id('m'), project_id: P.tesis, title: 'Defensa', kind: 'once', status: 'open', due_date: null },
    { id: id('m'), project_id: P.casa, title: 'Pagar predial', kind: 'recurring', interval_n: 1, interval_unit: 'month', anchor: 'fixed', due_date: '2026-01-30', next_due: '2026-11-30', last_done_at: '2026-10-28', status: 'open' },
    { id: id('m'), project_id: P.casa, title: 'Impermeabilizar azotea', kind: 'once', status: 'open', due_date: '2026-12-15' },
    { id: id('m'), project_id: P.casa, title: 'Cambiar boiler', kind: 'once', status: 'done', due_date: '2026-11-05', last_done_at: '2026-11-02' },
    { id: id('m'), project_id: P.vps, title: 'Verificar backups', kind: 'recurring', interval_n: 1, interval_unit: 'week', anchor: 'rolling', due_date: '2026-06-17', next_due: '2026-11-20', last_done_at: '2026-11-13', status: 'open' },
    { id: id('m'), project_id: P.vps, title: 'Renovar certificados', kind: 'recurring', interval_n: 1, interval_unit: 'month', anchor: 'fixed', due_date: '2026-06-25', next_due: '2026-11-25', last_done_at: '2026-10-24', status: 'open' },
    { id: id('m'), project_id: P.coche, title: 'Verificación vehicular', kind: 'once', status: 'open', due_date: '2026-11-11' },
    { id: id('m'), project_id: P.coche, title: 'Cambio de aceite', kind: 'once', status: 'done', due_date: '2026-09-30', last_done_at: '2026-09-28' },
    { id: id('m'), project_id: P.jp, title: 'Repasar kanji', kind: 'recurring', interval_n: 1, interval_unit: 'week', anchor: 'rolling', due_date: '2026-05-08', next_due: '2026-11-28', last_done_at: '2026-11-21', status: 'open' }
  ],
  log: [
    { id: id('l'), ts_client: ts('2026-11-21', '18:00'), project_id: P.tesis, type: 'note', note: 'Capítulo 3 enviado a revisión' },
    { id: id('l'), ts_client: ts('2026-11-18'), project_id: P.casa, type: 'note', note: 'Cotización de impermeabilizante: tres proveedores' },
    { id: id('l'), ts_client: ts('2026-11-16'), project_id: P.casa, type: 'reschedule', note: null, milestone_title: 'Impermeabilizar azotea', meta: { from: '2026-11-30', to: '2026-12-15' } },
    { id: id('l'), ts_client: ts('2026-11-02'), project_id: P.casa, type: 'done', note: null, milestone_title: 'Cambiar boiler' },
    { id: id('l'), ts_client: ts('2026-10-28'), project_id: P.casa, type: 'done', note: null, milestone_title: 'Pagar predial', meta: { anchor_used: 'fixed', next_due: '2026-11-30', skipped_cycles: 0 } },
    { id: id('l'), ts_client: ts('2026-10-20'), project_id: P.casa, type: 'note', note: 'Revisé el recibo del agua; la fuga quedó resuelta' },
    { id: id('l'), ts_client: ts('2026-11-13'), project_id: P.vps, type: 'note', note: 'Actualicé nginx a 1.27' },
    { id: id('l'), ts_client: ts('2026-11-05'), project_id: P.coche, type: 'note', note: 'Cotización del taller' },
    { id: id('l'), ts_client: ts('2026-11-22', '20:00'), project_id: P.jp, type: 'note', note: 'Lección 14, kanji de tiempo' },
    { id: id('l'), ts_client: ts('2026-11-14', '10:30'), project_id: null, type: 'review', note: null }
  ]
};

// Link the fixture log entries that name a milestone by title.
db.log.forEach((l) => {
  if (l.milestone_title) l.milestone_id = db.milestones.find((m) => m.title === l.milestone_title)?.id;
  delete l.milestone_title;
  l.ts_server = l.ts_client;
});

const clone = (x) => structuredClone(x);
const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };

function lastLogs() {
  const per = {}; let review = null;
  for (const l of db.log) {
    const t = Date.parse(l.ts_client);
    if (l.type === 'review' && (!review || t > Date.parse(review.ts_client))) review = l;
    if (l.project_id && countsAsActivity(l) && (!per[l.project_id] || t > Date.parse(per[l.project_id].ts_client))) per[l.project_id] = l;
  }
  return [...Object.values(per), ...(review ? [review] : [])];
}

function applyEntry(e) {
  if (db.log.some((l) => l.id === e.id)) return { dup: true };
  let meta = null, projectId = e.project_id || null;
  if (e.type === 'done') {
    const m = db.milestones.find((x) => x.id === e.milestone_id) || fail('not_found', 'Hito desconocido');
    if (m.status !== 'open') fail('conflict', 'El hito no está abierto');
    const anchor = m.kind === 'once' ? null : (e.meta?.anchor || m.anchor);
    const r = completeMilestone(m, e.ts_client.slice(0, 10), anchor);
    Object.assign(m, { status: r.status, next_due: r.next_due, last_done_at: r.last_done_at });
    meta = { anchor_used: anchor, next_due: r.next_due, skipped_cycles: r.skipped_cycles };
    projectId = m.project_id;
  }
  db.log.push({ id: e.id, ts_client: e.ts_client, ts_server: nowLocalIso(), project_id: projectId,
    milestone_id: e.milestone_id || null, type: e.type, note: e.note || null, meta });
  return { dup: false };
}

const vaultDb = { meta: null, items: [] };

const handlers = {
  snapshot: () => ({
    today: nowLocalIso().slice(0, 10),
    projects: db.projects,
    milestones: db.milestones.filter((m) => m.status !== 'archived'),
    logs: lastLogs()
  }),
  projectLog: ({ project_id }) => {
    const logs = db.log.filter((l) => l.project_id === project_id).sort((a, b) => Date.parse(b.ts_client) - Date.parse(a.ts_client));
    return { logs, total: logs.length };
  },
  capture: ({ entries }) => {
    const accepted = [], duplicates = [], rejected = [];
    for (const e of entries) {
      try { (applyEntry(e).dup ? duplicates : accepted).push(e.id); } catch (err) { rejected.push({ id: e.id, code: err.code, error: err.message }); }
    }
    return { accepted, duplicates, rejected, milestones: [] };
  },
  complete: (p) => {
    const r = applyEntry({ id: p.id, ts_client: p.ts_client, type: 'done', milestone_id: p.milestone_id, note: p.note, meta: p.anchor ? { anchor: p.anchor } : null });
    return { milestone: db.milestones.find((m) => m.id === p.milestone_id), duplicate: r.dup };
  },
  review: (p) => {
    const e = { id: p.id, ts_client: p.ts_client, type: 'review', note: p.note || null };
    const r = applyEntry(e);
    return { log: db.log.find((l) => l.id === e.id), duplicate: r.dup };
  },
  upsertProject: ({ project }) => {
    let p = db.projects.find((x) => x.id === project.id);
    if (!p) { p = { id: project.id, status: 'active', sort: db.projects.length, created_at: nowLocalIso() }; db.projects.push(p); }
    Object.assign(p, project);
    return p;
  },
  upsertMilestone: ({ milestone }) => {
    let m = db.milestones.find((x) => x.id === milestone.id);
    const before = m ? dueOf(m) : null;
    if (!m) { m = { id: milestone.id, status: 'open', last_done_at: null, next_due: null }; db.milestones.push(m); }
    Object.assign(m, milestone);
    if (m.kind === 'once') Object.assign(m, { interval_n: null, interval_unit: null, anchor: null, next_due: null });
    else { m.anchor = m.anchor || 'fixed'; if (!m.next_due) m.next_due = m.due_date; }
    if (before && before !== dueOf(m) && m.status === 'open') {
      db.log.push({ id: crypto.randomUUID(), ts_client: nowLocalIso(), project_id: m.project_id, milestone_id: m.id, type: 'reschedule', note: null, meta: { from: before, to: dueOf(m) } });
    }
    return m;
  },
  vaultList: () => ({
    kdf: vaultDb.meta && { salt: vaultDb.meta.kdf_salt, iterations: vaultDb.meta.kdf_iterations },
    verifier: vaultDb.meta && { ct: vaultDb.meta.verifier_ct, iv: vaultDb.meta.verifier_iv },
    items: vaultDb.items
  }),
  vaultInit: (p) => {
    if (vaultDb.meta) fail('conflict', 'Vault already initialized');
    vaultDb.meta = p;
    return { initialized: true };
  },
  vaultUpsert: ({ item }) => {
    const row = { ...item, updated_at: nowLocalIso() };
    vaultDb.items = [...vaultDb.items.filter((x) => x.id !== item.id), row];
    db.log.push({ id: crypto.randomUUID(), ts_client: nowLocalIso(), project_id: item.project_id, milestone_id: null, type: 'vault', note: 'vault updated', meta: null });
    return row;
  },
  vaultDelete: ({ id: vid }) => {
    const n = vaultDb.items.length;
    vaultDb.items = vaultDb.items.filter((x) => x.id !== vid);
    return { deleted: vaultDb.items.length < n };
  }
};

export async function mockCall(action, payload) {
  // ?latency=3000 imitates Apps Script response times.
  await new Promise((r) => setTimeout(r, Number(new URLSearchParams(location.search).get('latency')) || 120));
  // Test hooks: window.mockFault = 'offline' | 'lost' (applied, but the answer never arrives).
  if (window.mockFault === 'offline') fail('network', 'Sin conexión (simulada)');
  const h = handlers[action];
  if (!h) fail('bad_request', 'Unknown action: ' + action);
  const out = clone(h(payload));
  if (window.mockFault === 'lost' && action === 'capture') fail('network', 'Respuesta perdida (simulada)');
  return out;
}
