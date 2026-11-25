// #capture — mobile: next alert, project chips (recent first), milestone chips, note, dual button.
/* global dueOf, daysBetween, previewCompletion */
import { esc, fmtShort, inDays, hoursLeft } from '../format.js';
import { pendingDone } from '../sync.js';
import { timerSVG, seedOf } from '../enso.js';
import { state, alerts, recentProjects, openByDue, projectById, milestoneById, timer, today } from '../store.js';

/** Default selection = the next alert, so the common case is one tap on "Hecho". */
export function ensureCaptureSelection() {
  const c = state.ui.capture;
  if (c.projectId && projectById(c.projectId)) return;
  const next = alerts().next_alert;
  if (next) {
    c.projectId = next.milestone.project_id;
    c.milestoneId = next.milestone.id;
  } else {
    c.projectId = recentProjects()[0]?.id || null;
    c.milestoneId = null;
  }
}

function nextBlock(a) {
  const n = a.next_alert;
  let body = '<p class="title">Nada pendiente</p><p class="meta">Sin fechas próximas</p>';
  if (n) {
    const t = timer(n.milestone);
    const d = daysBetween(today(), n.due);
    const when = d === 0 && t ? `hoy, ${hoursLeft(t.hours_left)}` : `${inDays(d)}, ${fmtShort(n.due)}`;
    body = `<div class="next-row"><div>
        <p class="title">${esc(n.milestone.title)}</p>
        <p class="meta num">${esc(projectById(n.milestone.project_id)?.name || '')} · ${esc(when)}</p>
      </div>${timerSVG({ size: 44, timer: t, seed: seedOf(n.milestone.id) })}</div>`;
  }
  const od = a.overdue;
  const overdue = od.length
    ? `<p class="overdue num">${od.length} ${od.length === 1 ? 'vencido' : 'vencidos'} · ${od.slice(0, 3).map((x) => esc(x.milestone.title)).join(', ')}</p>`
    : '';
  return `<section class="next"><p class="label">Próximo</p>${body}${overdue}</section>`;
}

function actions() {
  const c = state.ui.capture;
  const m = c.milestoneId ? milestoneById(c.milestoneId) : null;
  const busy = state.ui.busy || (c.milestoneId && pendingDone(c.milestoneId) === today()) ? ' disabled' : '';
  if (!m) {
    const empty = !c.note.trim();
    return `<div class="actions"><button class="primary" data-act="save-note"${empty || busy ? ' disabled' : ''}><b>Guardar nota</b><span></span></button></div>`;
  }
  if (m.kind === 'once') {
    return `<div class="actions"><button class="primary" data-act="capture-done" data-anchor=""${busy}><b>Hecho</b><span></span></button></div>`;
  }
  const pv = previewCompletion(m, today());
  const other = m.anchor === 'fixed' ? 'rolling' : 'fixed';
  const otherText = other === 'rolling' ? 'o contar desde hoy' : 'o mantener fecha fija';
  return `<div class="actions">
    <button class="primary" data-act="capture-done" data-anchor="${m.anchor}"${busy}><b>Hecho</b><span class="num">próximo ${esc(fmtShort(pv[m.anchor].next_due))}</span></button>
    <button class="secondary num" data-act="capture-done" data-anchor="${other}"${busy}>${otherText} · <u>${esc(fmtShort(pv[other].next_due))}</u></button>
  </div>`;
}

export function renderCapture() {
  ensureCaptureSelection();
  const a = alerts();
  const c = state.ui.capture;
  const projects = recentProjects().map((p) =>
    `<button class="chip" data-act="pick-project" data-id="${esc(p.id)}" aria-pressed="${p.id === c.projectId}">${esc(p.name)}</button>`).join('');
  const ms = c.projectId ? openByDue(c.projectId).map((m) => {
    const due = dueOf(m);
    const d = due ? daysBetween(today(), due) : null;
    const lead = timerSVG({ size: 16, timer: timer(m), seed: seedOf(m.id), inline: true });
    const tail = d !== null && d < 0 ? `<span class="d num">−${-d} d</span>` : '';
    return `<button class="chip" data-act="pick-milestone" data-id="${esc(m.id)}" aria-pressed="${m.id === c.milestoneId}">${lead}${esc(m.title)}${tail}</button>`;
  }).join('') : '';
  return `<div class="capture">
    <header class="top"><a class="mark" href="#capture">Enso</a><nav><a href="#review">Revisión</a></nav></header>
    ${nextBlock(a)}
    <section class="block"><p class="label">Proyecto</p><div class="chips">${projects || '<p class="empty">Crea un proyecto en Revisión.</p>'}</div></section>
    ${c.projectId ? `<section class="block"><p class="label">Hito</p><div class="chips">${ms || '<p class="empty">Sin hitos abiertos</p>'}</div></section>` : ''}
    <section class="block"><p class="label">Nota</p>
      <input class="note" data-bind="note" maxlength="2000" placeholder="Breve, opcional" value="${esc(c.note)}" autocomplete="off" aria-label="Nota"></section>
    ${actions()}
  </div>`;
}
