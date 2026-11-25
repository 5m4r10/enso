// #review — PC: projects column + margin with alerts and last review.
/* global dueOf, daysBetween */
import { esc, fmtShort, fmtLong, inDays, agoDays, hoursLeft, capitalize } from '../format.js';
import { ensoSVG, timerSVG, seedOf } from '../enso.js';
import { state, activeProjects, openByDue, lastLogOf, lastActivityDays, projectRing, timer, alerts, today, projectById } from '../store.js';
import { header } from './shell.js';
import { projectForm } from './forms.js';

function dueText(m) {
  const due = dueOf(m);
  const d = daysBetween(today(), due);
  if (d < 0) return { text: `hace ${-d} d`, overdue: true };
  return { text: d === 0 ? 'hoy' : fmtShort(due), overdue: false };
}

function projectRow(p, staleIds) {
  const ring = projectRing(p.id);
  const last = lastLogOf(p.id);
  const idle = lastActivityDays(p);
  const stale = staleIds.has(p.id);
  const lastText = last
    ? `<span class="when">${esc(capitalize(agoDays(idle)))}</span>${last.note ? ` — ${esc(last.note)}` : ''}`
    : `<span class="when">${esc(capitalize(agoDays(idle ?? 0)))}</span> — sin registros`;
  const ups = openByDue(p.id).filter((m) => dueOf(m)).slice(0, 3).map((m) => {
    const d = dueText(m);
    const t = timerSVG({ size: 16, timer: timer(m), seed: seedOf(m.id), inline: true });
    return `<li class="${d.overdue ? 'is-overdue' : ''}"><span>${esc(m.title)}</span><span class="num">${t}${esc(d.text)}</span></li>`;
  }).join('');
  return `<article class="project" data-act="open-project" data-id="${esc(p.id)}" tabindex="0">
    ${ensoSVG({ size: 44, progress: ring.progress, state: ring.state, seed: seedOf(p.id) })}
    <div>
      <h3>${esc(p.name)} <span class="count num">${esc(ring.label)}</span></h3>
      <p class="last${stale ? ' is-stale' : ''}">${lastText}</p>
    </div>
    <ul class="upcoming">${ups || '<li class="empty">Sin fechas próximas</li>'}</ul>
  </article>`;
}

function margin(a) {
  const name = (m) => esc(projectById(m.project_id)?.name || '');
  const overdue = a.overdue.map((x) =>
    `<li>${esc(x.milestone.title)}<span class="meta shu num">${name(x.milestone)} · ${x.days_overdue} ${x.days_overdue === 1 ? 'día' : 'días'}</span></li>`).join('');
  const upcoming = a.upcoming.map((x) => {
    const t = timer(x.milestone);
    const when = x.days_left === 0 && t ? `hoy, ${hoursLeft(t.hours_left)}` : inDays(x.days_left);
    return `<li>${timerSVG({ size: 20, timer: t, seed: seedOf(x.milestone.id) })}<div>${esc(x.milestone.title)}<span class="meta num">${name(x.milestone)} · ${esc(when)}</span></div></li>`;
  }).join('');
  const stale = a.stale.map((x) =>
    `<li>${esc(x.project.name)}<span class="meta shu num">${x.days_idle} días sin registro</span></li>`).join('');
  const lastReview = a.last_review_days;
  const reviewDate = lastReview === null ? '' : fmtLong(addDaysIso(today(), -lastReview));
  return `<aside class="margin">
    <h2 class="label section-head">Atención</h2>
    ${overdue ? `<div class="group"><h4 class="shu">Vencidos</h4><ul>${overdue}</ul></div>` : ''}
    <div class="group"><h4>Próximos 7 días</h4>${upcoming ? `<ul class="timed">${upcoming}</ul>` : '<p class="empty">Nada en los próximos 7 días</p>'}</div>
    ${stale ? `<div class="group"><h4 class="shu">Sin movimiento</h4><ul>${stale}</ul></div>` : ''}
    <div class="review-box">
      <p class="label">Última revisión</p>
      <p class="big num">${lastReview === null ? 'nunca' : esc(agoDays(lastReview))}</p>
      <p class="sub num">${esc(reviewDate)}</p>
      <button class="btn-line wide" data-act="register-review"${state.ui.busy ? ' disabled' : ''}><span>Registrar revisión</span><span>→</span></button>
    </div>
  </aside>`;
}

function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function renderReview() {
  const a = alerts();
  const staleIds = new Set(a.stale.map((x) => x.project.id));
  const list = activeProjects().slice().sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
  const form = state.ui.form?.type === 'project' && !state.ui.form.id ? projectForm(null) : '';
  return `<div class="page">${header('review')}
    <div class="grid">
      <section>
        <div class="section-head"><h2 class="label">Proyectos</h2><button class="btn-quiet" data-act="new-project">+ Nuevo proyecto</button></div>
        ${form}
        ${list.map((p) => projectRow(p, staleIds)).join('') || '<p class="empty">Aún no hay proyectos.</p>'}
      </section>
      ${margin(a)}
    </div>
  </div>`;
}

