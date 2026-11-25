// #project/<id> — one project: open/done milestones, inline completion, log.
/* global dueOf, daysBetween, previewCompletion */
import { esc, fmtShort, inDays, agoDays, kindLabel } from '../format.js';
import { ensoSVG, timerSVG, seedOf } from '../enso.js';
import { state, projectById, milestonesOf, openByDue, projectRing, lastActivityDays, timer, today, milestoneById } from '../store.js';
import { pendingDone, sync } from '../sync.js';
import { keepLink } from '../links.js';
import { header } from './shell.js';
import { projectForm, milestoneForm } from './forms.js';

const DEFAULT_STALE = 14;
const day = (iso) => fmtShort(iso).replace(/^\S+ /, ''); // '30 nov'

function dueCell(m) {
  const due = dueOf(m);
  if (!due) return '<p class="due muted">sin fecha</p>';
  const d = daysBetween(today(), due);
  const t = timerSVG({ size: 18, timer: timer(m), seed: seedOf(m.id), inline: true });
  const rel = d < 0 ? `hace ${-d} ${-d === 1 ? 'día' : 'días'}` : inDays(d);
  return `<p class="due num${d < 0 ? ' is-overdue' : ''}">${t}${esc(fmtShort(due))}<small>${esc(rel)}</small></p>`;
}

function confirmRow(m) {
  if (m.kind === 'once') {
    return `<div class="confirm">
      <button class="primary-sm" data-act="complete" data-id="${esc(m.id)}">Marcar hecho</button>
      <button class="btn-quiet" data-act="cancel-confirm">Cancelar</button></div>`;
  }
  const pv = previewCompletion(m, today());
  const other = m.anchor === 'fixed' ? 'rolling' : 'fixed';
  const otherText = other === 'rolling' ? 'o contar desde hoy' : 'o mantener fecha fija';
  return `<div class="confirm">
    <button class="primary-sm" data-act="complete" data-id="${esc(m.id)}" data-anchor="${m.anchor}">Hecho<span class="num">próximo ${esc(fmtShort(pv[m.anchor].next_due))}</span></button>
    <button class="btn-quiet" data-act="complete" data-id="${esc(m.id)}" data-anchor="${other}">${otherText} · <span class="num">${esc(fmtShort(pv[other].next_due))}</span></button>
    <button class="btn-quiet" data-act="cancel-confirm">Cancelar</button></div>`;
}

const unsent = () => `<span class="saving">${sync.status === 'syncing' ? 'Guardando…' : 'Por enviar'}</span>`;

function openRow(m, projectId) {
  if (state.ui.form?.type === 'milestone' && state.ui.form.id === m.id) return milestoneForm(m, projectId);
  const extra = m.kind === 'recurring' && m.last_done_at ? ` · hecho ${fmtShort(m.last_done_at)}` : '';
  const confirming = state.ui.confirmMilestone === m.id;
  return `<article class="ms">
    <div><h3>${esc(m.title)}</h3><p class="kind">${esc(kindLabel(m) + extra)}</p></div>
    ${dueCell(m)}
    <div class="acts">${pendingDone(m.id) === today() ? unsent() : confirming ? '' : `<button class="link-ul" data-act="confirm" data-id="${esc(m.id)}">Hecho</button>`}
      <button class="btn-quiet" data-act="edit-milestone" data-id="${esc(m.id)}">Editar</button></div>
    ${confirming ? confirmRow(m) : ''}
  </article>`;
}

function doneRow(m) {
  return `<article class="ms is-done">
    <div><h3>${esc(m.title)}</h3><p class="kind">${esc(kindLabel(m))}</p></div>
    <p class="due num">${esc(fmtShort(m.last_done_at || ''))}</p>
    <div class="acts">${pendingDone(m.id) ? unsent() : `<button class="btn-quiet" data-act="reopen" data-id="${esc(m.id)}">Reabrir</button>`}</div>
  </article>`;
}

const TYPE = { note: 'Nota', done: 'Hecho', review: 'Revisión', reschedule: 'Reprogramado', vault: 'Bóveda' };

function logItem(l) {
  const title = l.milestone_id ? esc(milestoneById(l.milestone_id)?.title || 'Hito') : '';
  let body;
  if (l.type === 'done') body = `${title}${l.meta?.next_due ? ` <span class="sys num">· próximo ${esc(day(l.meta.next_due))}</span>` : ''}${l.note ? `<br>${esc(l.note)}` : ''}`;
  else if (l.type === 'reschedule') body = `<span class="sys num">${title} · ${esc(l.meta?.from ? day(l.meta.from) : 'sin fecha')} → ${esc(l.meta?.to ? day(l.meta.to) : 'sin fecha')}</span>`;
  else if (l.type === 'vault') body = '<span class="sys">Bóveda actualizada</span>';
  else body = esc(l.note || '');
  return `<li><p class="when num"><span>${esc(fmtShort(l.ts_client))}</span><span class="type">${TYPE[l.type] || l.type}${l.unsent ? ' · por enviar' : ''}</span></p>${body}</li>`;
}

export function renderProject(id) {
  const p = projectById(id);
  if (!p) return `<div class="page">${header('project')}<p class="empty">Proyecto no encontrado.</p></div>`;
  const ring = projectRing(p.id);
  const idle = lastActivityDays(p);
  const open = openByDue(p.id);
  const done = milestonesOf(p.id).filter((m) => m.status === 'done')
    .sort((a, b) => String(b.last_done_at).localeCompare(String(a.last_done_at)));
  const stored = state.projectLogs[p.id];
  const mine = state.pendingLogs.filter((l) => l.project_id === p.id);
  const ids = new Set(mine.map((l) => l.id));
  const logs = [...mine, ...(stored || []).filter((l) => !ids.has(l.id))];
  const logNote = stored ? '' : `<p class="empty">${sync.status === 'syncing' || sync.status === 'idle' ? 'Cargando registro…' : 'El registro completo necesita conexión.'}</p>`;
  const f = state.ui.form;
  const editingProject = f?.type === 'project' && f.id === p.id;
  const newMilestone = f?.type === 'milestone' && !f.id;
  const counts = ring.state ? 'recurrente' : `${ring.done} de ${ring.total} hitos`;

  return `<div class="page">${header('project', '<a class="crumb" href="#review">← Proyectos</a>')}
    ${editingProject ? projectForm(p) : `<section class="hero">
      ${ensoSVG({ size: 96, progress: ring.progress, state: ring.state, seed: seedOf(p.id) })}
      <div><h1>${esc(p.name)}</h1>
        <p class="meta num"><span>${esc(counts)}</span><span>último registro ${esc(agoDays(idle ?? 0))}</span><span>sin movimiento a los ${p.stale_days || DEFAULT_STALE} días</span></p>
      </div>
      <div class="tools">${keepLink(p)}<button class="btn-quiet" data-act="edit-project" data-id="${esc(p.id)}">Editar proyecto</button></div>
    </section>`}
    <div class="grid project-grid">
      <section>
        <div class="section-head"><h2 class="label">Hitos abiertos</h2><button class="btn-quiet" data-act="new-milestone">+ Nuevo hito</button></div>
        ${newMilestone ? milestoneForm(null, p.id) : ''}
        ${open.map((m) => openRow(m, p.id)).join('') || '<p class="empty">Sin hitos abiertos.</p>'}
        <div class="list-end"></div>
        ${done.length ? `<div class="section-head done-head"><h2 class="label">Hechos</h2></div>${done.map(doneRow).join('')}<div class="list-end"></div>` : ''}
      </section>
      <aside>
        <h2 class="label section-head">Registro</h2>
        <form class="compose" data-form="note" data-project="${esc(p.id)}">
          <input name="note" maxlength="2000" placeholder="Añadir nota…" autocomplete="off" aria-label="Nota">
          <button type="submit">Guardar</button>
        </form>
        ${stored || mine.length ? `<ul class="log">${logs.filter((l) => l.type !== 'review').map(logItem).join('') || '<li class="empty">Sin registros todavía.</li>'}</ul>` : ''}${logNote}
      </aside>
    </div>
  </div>`;
}
