// #vault — references and low-impact secrets. Hidden values are never put in the DOM.
import { esc } from '../format.js';
import { state, projects, activeProjects, projectById } from '../store.js';
import { vault, idleLeftMs, itemById } from '../vault.js';
import { MIN_PASSPHRASE } from '../crypto.js';
import { header } from './shell.js';

const KIND = { ref: 'Referencia', secret: 'Secreto' };

export function idleText() {
  const s = Math.ceil(idleLeftMs() / 1000);
  return `Abierta · se cierra sola en ${s > 60 ? `${Math.ceil(s / 60)} min` : `${s} s`} sin actividad`;
}

export function copiedText() {
  const s = Math.ceil((vault.copied.until - Date.now()) / 1000);
  return s > 0 ? `Copiado · se borra en ${s} s` : 'Copiado · por borrar';
}

function lockBox() {
  const creating = vault.status === 'uninit';
  const dis = vault.working ? ' disabled' : '';
  const button = vault.working ? (creating ? 'Creando…' : 'Abriendo…') : creating ? 'Crear bóveda' : 'Abrir';
  return `<form class="lock-box" data-form="${creating ? 'vault-create' : 'vault-unlock'}">
    <h1>${creating ? 'Crear la bóveda' : 'Bóveda cerrada'}</h1>
    <p>${creating ? `Elige una frase maestra de al menos ${MIN_PASSPHRASE} caracteres.` : 'Escribe tu frase para abrirla en este dispositivo.'}</p>
    <label class="label" for="pp">Frase maestra</label>
    <input id="pp" name="pass" type="password" required${creating ? ` minlength="${MIN_PASSPHRASE}"` : ''} autocomplete="${creating ? 'new' : 'current'}-password"${dis}>
    ${creating ? `<label class="label second" for="pp2">Repite la frase</label>
    <input id="pp2" name="pass2" type="password" required autocomplete="new-password"${dis}>` : ''}
    ${vault.error ? `<p class="err" role="alert">${esc(vault.error)}</p>` : ''}
    <button class="primary" type="submit"${dis}><b>${button}</b><span>→</span></button>
    <p class="fine">La frase no se guarda en ningún sitio y no se puede recuperar. Si la pierdes, el contenido de la bóveda se pierde con ella.</p>
  </form>`;
}

function itemForm(item) {
  const isNew = !item;
  const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
  const cur = item?.project_id || '';
  const list = activeProjects().slice();
  if (cur && !list.some((p) => p.id === cur) && projectById(cur)) list.push(projectById(cur));
  return `<form class="panel" data-form="vault-item" data-id="${esc(item?.id || '')}">
    <h2>${isNew ? 'Nueva entrada' : 'Editar entrada'}</h2>
    <div class="fields">
      <label class="field"><span class="label">Tipo</span>
        <select name="kind">${opt('ref', 'Referencia', item?.kind || 'ref')}${opt('secret', 'Secreto', item?.kind)}</select></label>
      <label class="field"><span class="label">Proyecto</span>
        <select name="project_id">${opt('', 'Sin proyecto', cur)}${list.map((p) => opt(p.id, p.name, cur)).join('')}</select></label>
      <label class="field wide"><span class="label">Nombre</span>
        <input name="label" required maxlength="200" value="${esc(item?.label || '')}" autocomplete="off"></label>
      <label class="field wide"><span class="label">Valor o referencia</span>
        <input name="value" required maxlength="4000" value="${esc(item?.value || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    </div>
    <div class="row-acts">
      <button class="btn-line" type="submit"${state.ui.busy ? ' disabled' : ''}>Guardar</button>
      <button class="btn-quiet" type="button" data-act="cancel-form">Cancelar</button>
      <span class="spacer"></span>
      ${isNew ? '' : `<button class="btn-quiet" type="button" data-act="vault-delete" data-id="${esc(item.id)}">Eliminar</button>`}
    </div>
  </form>`;
}

function row(item) {
  const id = esc(item.id);
  if (item.broken) {
    return `<div class="row"><p class="name">Entrada ilegible<span class="kind">No se pudo descifrar</span></p><p class="val ref">Bloque alterado o de otra clave</p>
      <div class="acts"><button data-act="vault-delete" data-id="${id}">Eliminar</button></div></div>`;
  }
  const f = state.ui.form;
  if (f?.type === 'vault' && f.id === item.id) return itemForm(item);
  const shown = vault.revealed.has(item.id);
  const copied = vault.copied?.id === item.id;
  const edit = `<button data-act="vault-edit" data-id="${id}">Editar</button>`;
  const name = `<p class="name">${esc(item.label)}<span class="kind">${KIND[item.kind] || ''}</span></p>`;
  if (item.kind === 'ref') return `<div class="row">${name}<p class="val ref">${esc(item.value)}</p><div class="acts">${edit}</div></div>`;
  return `<div class="row${shown ? ' is-open' : ''}">${name}
    ${shown ? `<p class="val">${esc(item.value)}</p>` : '<p class="val mask" aria-label="Oculto">••••••••••••</p>'}
    <div class="acts"><button data-act="vault-toggle" data-id="${id}">${shown ? 'Ocultar' : 'Mostrar'}</button>
      ${copied ? `<span class="copied num" data-copied>${esc(copiedText())}</span>` : `<button data-act="vault-copy" data-id="${id}">Copiar</button>${edit}`}</div>
  </div>`;
}

function unlocked() {
  const q = vault.query.trim().toLocaleLowerCase('es');
  const known = (x) => (x.project_id && projectById(x.project_id) ? x.project_id : null);
  const order = [...projects().filter((p) => vault.items.some((x) => known(x) === p.id)).map((p) => [p.id, p.name]),
    ...(vault.items.some((x) => !known(x)) ? [[null, 'Sin proyecto']] : [])];
  const filters = order.length > 1 ? [['all', 'Todo'], ...order.map(([id, n]) => [id || 'none', n])] : [];
  const filter = filters.some(([k]) => k === vault.filter) ? vault.filter : 'all';
  // Search looks at names only, so a hidden secret cannot be probed through the list.
  const groups = order.filter(([id]) => filter === 'all' || filter === (id || 'none')).map(([id, name]) => {
    const items = vault.items.filter((x) => known(x) === id && (!q || (x.label || '').toLocaleLowerCase('es').includes(q)))
      .sort((a, b) => (a.label || '').localeCompare(b.label || '', 'es'));
    return items.length ? `<section class="group"><h2 class="label">${esc(name)}</h2>${items.map(row).join('')}</section>` : '';
  }).join('');
  const f = state.ui.form;
  const empty = vault.items.length ? 'Nada coincide.' : 'Todavía no hay entradas.';
  return `<div class="vault">
    <section class="head">
      <div><h1>Bóveda</h1><p class="state num" data-idle>${esc(idleText())}</p></div>
      <div class="right"><button class="btn-quiet" data-act="vault-lock">Cerrar ahora</button>
        <button class="btn-line" data-act="vault-new">+ Nueva entrada</button></div>
    </section>
    ${f?.type === 'vault' && !itemById(f.id) ? itemForm(null) : ''}
    ${vault.items.length ? `<div class="filters">${filters.map(([k, n]) => `<button class="chip" data-act="vault-filter" data-id="${esc(k)}" aria-pressed="${k === filter}">${esc(n)}</button>`).join('')}
      <input type="text" data-bind="vault-query" placeholder="Buscar" aria-label="Buscar" autocomplete="off" value="${esc(vault.query)}"></div>` : ''}
    ${groups || `<p class="empty">${empty}</p>`}
    <p class="foot">Las credenciales críticas (root, llaves SSH, APIs de producción) viven en tu gestor de contraseñas; aquí solo su referencia.
      Todo se cifra en este dispositivo antes de salir; el servidor guarda bloques opacos.</p>
  </div>`;
}

export function renderVault() {
  const body = {
    open: unlocked,
    locked: lockBox,
    uninit: lockBox,
    failed: () => `<p class="empty">${esc(vault.error)} <button class="link-ul" data-act="vault-retry">Reintentar</button></p>`
  }[vault.status] || (() => '<p class="empty">Cargando…</p>');
  return `<div class="page">${header('vault', '<span class="crumb">Bóveda</span>')}${body()}</div>`;
}
