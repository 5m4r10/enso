// Inline forms (no modals): project and milestone create/edit.
import { esc } from '../format.js';

const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;

export function projectForm(p) {
  const isNew = !p;
  return `<form class="panel" data-form="project" data-id="${esc(p?.id || '')}">
    <h2>${isNew ? 'Nuevo proyecto' : 'Editar proyecto'}</h2>
    <div class="fields">
      <label class="field wide"><span class="label">Nombre</span>
        <input name="name" required maxlength="120" value="${esc(p?.name || '')}" autocomplete="off"></label>
      <label class="field"><span class="label">Sin movimiento a los (días)</span>
        <input name="stale_days" type="number" min="1" max="365" inputmode="numeric" placeholder="14" value="${esc(p?.stale_days ?? '')}"></label>
    </div>
    <div class="row-acts">
      <button class="btn-line" type="submit">Guardar</button>
      <button class="btn-quiet" type="button" data-act="cancel-form">Cancelar</button>
      <span class="spacer"></span>
      ${isNew ? '' : `<button class="btn-quiet" type="button" data-act="archive-project" data-id="${esc(p.id)}">Archivar proyecto</button>`}
    </div>
  </form>`;
}

export function milestoneForm(m, projectId) {
  const isNew = !m;
  const kind = m?.kind || 'once';
  const recurring = kind === 'recurring';
  return `<form class="panel" data-form="milestone" data-id="${esc(m?.id || '')}" data-project="${esc(projectId)}">
    <h2>${isNew ? 'Nuevo hito' : 'Editar hito'}</h2>
    <div class="fields">
      <label class="field wide"><span class="label">Título</span>
        <input name="title" required maxlength="200" value="${esc(m?.title || '')}" autocomplete="off"></label>
      <label class="field"><span class="label">Tipo</span>
        <select name="kind" data-act-change="kind"${isNew ? '' : ' disabled'}>
          ${opt('once', 'Una vez', kind)}${opt('recurring', 'Recurrente', kind)}
        </select></label>
      <label class="field" data-only="once"${recurring ? ' hidden' : ''}><span class="label">Fecha (opcional)</span>
        <input name="due_date" type="date" value="${esc(m?.due_date || '')}"></label>
      <label class="field" data-only="recurring"${recurring ? '' : ' hidden'}><span class="label">${isNew ? 'Primera fecha' : 'Próxima fecha'}</span>
        <input name="next_due" type="date" value="${esc(m?.next_due || '')}"></label>
      <label class="field" data-only="recurring"${recurring ? '' : ' hidden'}><span class="label">Cada</span>
        <input name="interval_n" type="number" min="1" max="999" inputmode="numeric" value="${esc(m?.interval_n ?? 1)}"></label>
      <label class="field" data-only="recurring"${recurring ? '' : ' hidden'}><span class="label">Unidad</span>
        <select name="interval_unit">${opt('day', 'días', m?.interval_unit)}${opt('week', 'semanas', m?.interval_unit)}${opt('month', 'meses', m?.interval_unit || 'month')}</select></label>
      <label class="field" data-only="recurring"${recurring ? '' : ' hidden'}><span class="label">Al completar</span>
        <select name="anchor">${opt('fixed', 'Mantener fecha fija', m?.anchor || 'fixed')}${opt('rolling', 'Contar desde el día hecho', m?.anchor)}</select></label>
    </div>
    <div class="row-acts">
      <button class="btn-line" type="submit">Guardar</button>
      <button class="btn-quiet" type="button" data-act="cancel-form">Cancelar</button>
      <span class="spacer"></span>
      ${isNew ? '' : `<button class="btn-quiet" type="button" data-act="archive-milestone" data-id="${esc(m.id)}">Archivar hito</button>`}
    </div>
  </form>`;
}

/** Form → payload. Returns {error} on invalid input. */
export function readForm(form) {
  const fd = new FormData(form);
  const s = (k) => (fd.get(k) ?? '').toString().trim();
  if (form.dataset.form === 'project') {
    const stale = s('stale_days');
    return { project: { name: s('name'), stale_days: stale ? Number(stale) : null } };
  }
  const kind = form.querySelector('[name=kind]').value;
  const m = { title: s('title'), kind };
  if (kind === 'once') {
    m.due_date = s('due_date') || null;
  } else {
    m.next_due = s('next_due') || null;
    if (!m.next_due) return { error: 'Los hitos recurrentes necesitan fecha.' };
    m.interval_n = Number(s('interval_n') || 1);
    m.interval_unit = s('interval_unit');
    m.anchor = s('anchor');
    if (!form.dataset.id) m.due_date = m.next_due;
  }
  return { milestone: m };
}
