'use strict';
const { MONEDAS, CATS, MODO_CORTO, MODOS, parseMoney, parseNum, toInput, n0, division, fmt, fechaTxt, hoy, uid, whatsappText, buildPdf, nombreArchivo } = window.VaquitaLogic;
const PUEDE_COMPARTIR = (() => {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); }
  catch (e) { return false; }
})();

/* ========== Estado local ========== */
const S = {
  data: { juntadas: {}, gastos: {}, pagos: {}, grupos: {} },
  actividad: {}, papelera: {}, revs: {}, borradas: {}, noExiste: {},
  demo: demoData(),
  loaded: false, readOnly: false, notice: null,
  view: { name: 'home', tab: 'juntadas' },
  form: null, open: {}, confirm: null, toast: null, copyText: null, pagoForm: null, focus: null,
  demoOff: false, invite: false, verHistorial: false,
};
const leerLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } };
const grabarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: sigue en memoria */ } };

function demoData() {
  const P = ['Caro', 'Nico', 'Tomi', 'Flor', 'Juan'];
  const personas = P.map((n, i) => ({ id: 'p' + i, nombre: n, alias: n.toLowerCase() + '.ejemplo.mp' }));
  const uno = ids => Object.fromEntries(ids.map(i => ['p' + i, 1]));
  const J = 'demo1';
  return {
    juntadas: { [J]: { nombre: 'Asado en lo de Nico', fecha: '2026-10-24', lugar: 'Ejemplo', moneda: 'ARS', personas, creado: 1 } },
    gastos: {
      'demo-g1': { juntadaId: J, desc: 'Carnicería y verdulería', cat: 'Comida', modo: 'items', total: 5240000, pagadores: [{ p: 'p1', c: 5240000 }], participantes: [], valores: {},
        items: [{ id: 'i1', nombre: 'Vacío', precio: 2800000, consumen: uno([0, 1, 2, 4]) }, { id: 'i2', nombre: 'Chorizos (6)', precio: 1200000, consumen: { p0: 1, p1: 2, p2: 2, p4: 1 } }, { id: 'i3', nombre: 'Verduras para la parrilla', precio: 1240000, consumen: uno([0, 1, 2, 3, 4]) }], propina: 0, descuento: 0, creado: 1 },
      'demo-g2': { juntadaId: J, desc: 'Fernet, vino y gaseosas', cat: 'Bebida', modo: 'montos', total: 2700000, pagadores: [{ p: 'p0', c: 2000000 }, { p: 'p3', c: 700000 }], participantes: [], valores: { p0: 600000, p1: 800000, p2: 800000, p3: 200000, p4: 300000 }, items: [], propina: 0, descuento: 0, creado: 2 },
      'demo-g3': { juntadaId: J, desc: 'Carbón y hielo', cat: 'Súper', modo: 'iguales', total: 950000, pagadores: [{ p: 'p2', c: 950000 }], participantes: P.map((_, i) => 'p' + i), valores: {}, items: [], propina: 0, descuento: 0, creado: 3 },
      'demo-g4': { juntadaId: J, desc: 'Remis de vuelta', cat: 'Transporte', modo: 'iguales', total: 840000, pagadores: [{ p: 'p4', c: 840000 }], participantes: ['p3', 'p4'], valores: {}, items: [], propina: 0, descuento: 0, creado: 4 },
    },
    pagos: { 'demo-x1': { juntadaId: J, de: 'p3', a: 'p4', c: 420000, fecha: '2026-10-25', creado: 1 } },
    grupos: {},
  };
}
const esDemo = (id, doc) => String(id).startsWith('demo') || String((doc || {}).juntadaId).startsWith('demo');
function showDemo() { return S.loaded && !S.demoOff && !Object.keys(S.data.juntadas).length; }
function verDemo() { return showDemo() || String(S.view.jid).startsWith('demo'); }
function coll(col) { return verDemo() ? { ...S.data[col], ...S.demo[col] } : S.data[col]; }
const byCreado = (a, b) => n0(a.creado) - n0(b.creado);
const withId = o => Object.keys(o).map(id => ({ ...o[id], id }));
function gastosDe(jid) { return withId(coll('gastos')).filter(g => g.juntadaId === jid).sort(byCreado); }
function pagosDe(jid) { return withId(coll('pagos')).filter(g => g.juntadaId === jid).sort(byCreado); }
function juntada(jid) { const d = coll('juntadas')[jid]; return d ? { ...d, id: jid, personas: d.personas || [] } : null; }
const report = j => window.VaquitaLogic.report(j, gastosDe(j.id), pagosDe(j.id));

/* ---- Lo que recuerda este dispositivo ---- */
function misTokens() { return leerLS('vaquita.mias', []).filter(t => typeof t === 'string'); }
function recordar(t) { const l = misTokens(); if (!l.includes(t)) { l.unshift(t); grabarLS('vaquita.mias', l.slice(0, 90)); } }
function olvidar(t) {
  grabarLS('vaquita.mias', misTokens().filter(x => x !== t));
  const c = leerLS('vaquita.cache', {}); delete c[t]; grabarLS('vaquita.cache', c);
  quitarSnapshot(t);
}
function leerYo(t) { return leerLS('vaquita.yo', {})[t]; }
function guardarYo(t, pid) { const m = leerLS('vaquita.yo', {}); if (pid === undefined) delete m[t]; else m[t] = pid; grabarLS('vaquita.yo', m); }
function quien(t) { const yo = leerYo(t), j = S.data.juntadas[t]; const p = yo && j && (j.personas || []).find(x => x.id === yo); return p ? p.nombre : ''; }

/* ---- Servidor ---- */
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch (e) { /* respuesta sin cuerpo */ }
  if (!r.ok) { const e = new Error((json && json.error) || (r.status === 429 ? 'La app llegó al límite gratuito de hoy. Vuelve a funcionar a las 21:00 de Argentina y no se perdió nada.' : 'El servidor no pudo responder. Probá de nuevo.')); e.status = r.status; e.data = json; throw e; }
  return json;
}
function quitarSnapshot(t) {
  ['gastos', 'pagos'].forEach(col => { Object.keys(S.data[col]).forEach(id => { if (S.data[col][id].juntadaId === t) delete S.data[col][id]; }); });
  delete S.data.juntadas[t];
  delete S.actividad[t]; delete S.papelera[t]; delete S.revs[t];
}
function ingerir(s, sinCache) {
  const t = s.token;
  quitarSnapshot(t);
  S.data.juntadas[t] = s.juntada;
  s.gastos.forEach(g => { S.data.gastos[g.id] = g; });
  s.pagos.forEach(x => { S.data.pagos[x.id] = x; });
  S.actividad[t] = s.actividad || []; S.papelera[t] = s.borrados || []; S.revs[t] = s.rev;
  delete S.noExiste[t]; delete S.borradas[t];
  if (!sinCache) { const c = leerLS('vaquita.cache', {}); c[t] = s; grabarLS('vaquita.cache', c); }
}
function conexion(ok) {
  const antes = S.readOnly;
  S.readOnly = !ok;
  if (antes !== S.readOnly) render();
}
async function cargarTodo() {
  const tokens = misTokens();
  if (!tokens.length) { conexion(true); return; }
  try {
    const r = await api('POST', '/batch', { tokens });
    r.juntadas.forEach(s => ingerir(s));
    r.faltantes.forEach(t => { if (t !== S.view.jid) olvidar(t); });
    conexion(true);
  } catch (e) {
    if (e.status) return;
    const c = leerLS('vaquita.cache', {});
    tokens.forEach(t => { if (c[t]) ingerir(c[t], true); });
    conexion(false);
  }
}
async function traerJuntada(t) {
  try {
    const s = await api('GET', '/j/' + t);
    recordar(t); ingerir(s); S.notice = null; conexion(true);
  } catch (e) {
    if (e.status === 429 || e.status >= 500) S.notice = e.message;
    if (e.status === 404) { S.noExiste[t] = true; olvidar(t); }
    else if (e.status === 410) { S.borradas[t] = e.data || { nombre: 'Esta juntada' }; quitarSnapshot(t); }
    else if (!e.status) {
      const c = leerLS('vaquita.cache', {})[t];
      if (c) ingerir(c, true); else S.noExiste[t] = false;
      conexion(false);
    }
  }
  render();
}
function asegurarJuntada(t) { if (!String(t).startsWith('demo') && !S.data.juntadas[t]) traerJuntada(t); }

/* ---- Cambios de los demás: consulta liviana cada pocos segundos, sólo con la juntada a la vista ---- */
const CADA_MS = 5000;
let tSondeo = null, sondeoDe = null;
function sincronizarVivo() {
  const j = S.view.jid && !String(S.view.jid).startsWith('demo') && S.data.juntadas[S.view.jid] ? S.view.jid : null;
  if (j === sondeoDe) return;
  clearInterval(tSondeo);
  sondeoDe = j;
  if (j) tSondeo = setInterval(() => sondear(j), CADA_MS);
}
async function sondear(j) {
  if (document.visibilityState !== 'visible') return;
  try {
    const r = await api('GET', '/j/' + j + '/rev');
    if (r.rev !== S.revs[j]) await traerJuntada(j);
    else conexion(true);
  } catch (e) {
    if (e.status === 404 || e.status === 410) traerJuntada(j);
    else if (!e.status) conexion(false);
  }
}
function alVolver() { const j = S.view.jid; if (j && !String(j).startsWith('demo')) traerJuntada(j); else cargarTodo().then(render); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') alVolver(); });
window.addEventListener('online', alVolver);
window.addEventListener('offline', () => conexion(false));

async function save(col, id, doc, ifVersion) {
  if (col === 'grupos') { S.data.grupos[id] = doc; grabarLS('vaquita.grupos', S.data.grupos); render(); return true; }
  if (esDemo(id, doc)) { S.demo[col][id] = doc; render(); return true; }
  const t = doc.juntadaId;
  try {
    ingerir(await api('PUT', '/j/' + t + '/' + col + '/' + id, { data: doc, ifVersion, quien: quien(t) }));
    render();
    return true;
  } catch (e) { writeFailed(e, t); return false; }
}
async function remove(col, id) {
  if (col === 'grupos') { delete S.data.grupos[id]; grabarLS('vaquita.grupos', S.data.grupos); render(); return true; }
  const doc = coll(col)[id];
  if (esDemo(id, doc)) { delete S.demo[col][id]; render(); return true; }
  const t = doc.juntadaId;
  try {
    ingerir(await api('DELETE', '/j/' + t + '/' + col + '/' + id, { quien: quien(t) }));
    render();
    return true;
  } catch (e) { writeFailed(e, t); return false; }
}
function writeFailed(e, t) {
  if (!e.status) { toast('No hay conexión. No se guardó: probá de nuevo cuando vuelva internet.'); conexion(!navigator.onLine ? false : !S.readOnly); return; }
  toast(e.message);
  if (e.status === 409 && t) traerJuntada(t);
}
async function init() {
  S.demoOff = leerLS('vaquita.demoOff', 0) === 1;
  S.data.grupos = leerLS('vaquita.grupos', {});
  const inicial = idDeRuta();
  if (inicial) S.view = { name: 'juntada', jid: inicial, tab: 'gastos' };
  render();
  const c = leerLS('vaquita.cache', {});
  misTokens().forEach(t => { if (c[t]) ingerir(c[t], true); });
  render();
  await cargarTodo();
  S.loaded = true;
  if (inicial && !String(inicial).startsWith('demo')) await traerJuntada(inicial);
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ========== Render con actualización mínima del DOM: conserva foco y teclado mientras se escribe ========== */
const root = document.getElementById('app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || (a.nodeType === 1 && a.getAttribute('data-key') !== b.getAttribute('data-key'))) { a.replaceWith(b); return; }
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  Array.from(a.attributes).forEach(x => { if (!b.hasAttribute(x.name)) a.removeAttribute(x.name); });
  Array.from(b.attributes).forEach(x => { if (a.getAttribute(x.name) !== x.value) a.setAttribute(x.name, x.value); });
  morphKids(a, b);
  if (a.nodeName === 'INPUT') { const v = b.getAttribute('value') || ''; if (a.value !== v) a.value = v; }
  if (a.nodeName === 'SELECT') { const o = b.querySelector('option[selected]'); if (o && a.value !== o.value) a.value = o.value; }
}
function morphKids(a, b) {
  const A = Array.from(a.childNodes), B = Array.from(b.childNodes);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (!A[i]) a.appendChild(B[i]);
    else if (!B[i]) A[i].remove();
    else morph(A[i], B[i]);
  }
}
function render() {
  const t = document.createElement('template');
  t.innerHTML = view();
  morphKids(root, t.content);
  document.getElementById('toast').innerHTML = S.toast ? '<div class="toast">' + esc(S.toast) + '</div>' : '';
  if (S.focus) { const el = document.getElementById(S.focus); S.focus = null; if (el) el.focus(); }
  sincronizarVivo();
}
let toastT;
function toast(msg) { S.toast = msg; clearTimeout(toastT); toastT = setTimeout(() => { S.toast = null; render(); }, 4200); render(); }
function go(v) { S.view = v; S.invite = false; S.confirm = null; S.copyText = null; S.pagoForm = null; render(); window.scrollTo(0, 0); }
function rutaDe(id) { return id === 'demo1' ? '/ejemplo' : '/j/' + id; }
function idDeRuta() {
  if (location.pathname === '/ejemplo') return 'demo1';
  const m = /^\/j\/([A-Za-z0-9_-]{10,64})\/?$/.exec(location.pathname);
  return m ? m[1] : null;
}
function openJuntada(id, tab) {
  S.form = null;
  S.invite = false;
  if (location.pathname !== rutaDe(id)) history.pushState(null, '', rutaDe(id));
  go({ name: 'juntada', jid: id, tab: tab || 'gastos' });
  if (!String(id).startsWith('demo')) traerJuntada(id);
}
function goHome(tab) {
  S.form = null;
  if (location.pathname !== '/') history.pushState(null, '', '/');
  go({ name: 'home', tab: tab || 'juntadas' });
}
function route() {
  const id = idDeRuta();
  if (id) {
    if (S.view.jid !== id || S.view.name !== 'juntada') { S.form = null; S.invite = false; go({ name: 'juntada', jid: id, tab: 'gastos' }); }
    asegurarJuntada(id);
  } else if (S.view.name !== 'home') { S.form = null; go({ name: 'home', tab: 'juntadas' }); }
}
window.addEventListener('popstate', route);

/* ========== Vistas ========== */
function iniciales(n) { const w = String(n || '?').trim().split(/\s+/); return esc((w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase()); }
function av(j, pid) {
  const i = (j.personas || []).findIndex(p => p.id === pid);
  const p = (j.personas || [])[i] || { nombre: '?' };
  return '<span class="av" style="--c:var(--p' + (Math.max(i, 0) % 6) + ')" aria-hidden="true">' + iniciales(p.nombre) + '</span>';
}
function view() {
  const v = S.view;
  if (v.name === 'juntadaForm') return viewJuntadaForm();
  if (v.name === 'grupoForm') return viewGrupoForm();
  if (v.name === 'gastoForm') return viewGastoForm();
  if (v.name === 'juntada') return viewJuntada();
  return viewHome();
}
function storageNotes() {
  let h = '';
  if (S.notice) h += '<p class="note warn">' + esc(S.notice) + '</p>';
  if (S.readOnly) h += '<p class="note">Sin conexión. Podés ver lo último que se cargó y descargar el PDF. Para editar hace falta internet.</p>';
  return h;
}
function viewHome() {
  const tab = S.view.tab;
  const head = `<header class="hide"><svg viewBox="0 0 430 190" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
    <path d="M335 -14c40-8 96 2 112 30 14 26 34 42 26 74-8 30-44 34-74 22-22-9-34-24-52-32-22-10-44-14-50-36-6-24 8-52 38-58z"/>
    <path d="M372 160c20-12 56-8 76 8 18 16 16 40-8 44-30 6-74 2-84-22-4-12 6-24 16-30z"/>
  </svg><div class="wrap hide-inner"><h1>Vaquita</h1><p>Quién compró, qué consumió cada uno y cuánto hay que pasarle a quién.</p></div></header>`;
  const tabs = `<div class="seg" role="tablist"><button type="button" role="tab" aria-selected="${tab === 'juntadas'}" data-act="homeTab" data-tab="juntadas">Juntadas</button><button type="button" role="tab" aria-selected="${tab === 'grupos'}" data-act="homeTab" data-tab="grupos">Grupos</button></div>`;
  return head + '<main class="wrap page">' + storageNotes() + tabs + (tab === 'grupos' ? viewGrupos() : viewJuntadas()) + '</main>';
}
function viewJuntadas() {
  if (!S.loaded) return '<p class="empty">Cargando tus juntadas…</p>';
  const list = withId(coll('juntadas')).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || n0(b.creado) - n0(a.creado));
  const add = S.readOnly ? '' : '<button type="button" class="btn main wide" data-act="newJuntada">Nueva juntada</button>';
  const cards = list.map(j => {
    j.personas = j.personas || [];
    const r = report(j), ex = String(j.id).startsWith('demo');
    const st = !r.gastos.length ? '<span class="pill">Sin gastos</span>' : r.bal.transfers.length ? `<span class="pill warn">${r.bal.transfers.length === 1 ? '1 pago pendiente' : r.bal.transfers.length + ' pagos pendientes'}</span>` : '<span class="pill ok">Saldada</span>';
    return `<button type="button" class="item" data-act="openJ" data-id="${esc(j.id)}" data-key="${esc(j.id)}"><span class="stack grow" style="gap:5px">
      <span class="row" style="gap:6px"><h3 class="wrapword">${esc(j.nombre)}</h3>${ex ? '<span class="pill">Ejemplo</span>' : ''}</span>
      <span class="muted small">${esc([fechaTxt(j.fecha), ex ? '' : j.lugar].filter(Boolean).join(' · '))}</span>
      <span class="faces">${j.personas.slice(0, 7).map(p => av(j, p.id)).join('')}</span></span>
      <span class="stack" style="gap:6px;justify-items:end"><span class="num">${esc(r.money(r.bal.total))}</span>${st}</span></button>`;
  }).join('');
  const hint = list.length && list.every(j => String(j.id).startsWith('demo')) ? '<p class="muted small">Esta juntada de ejemplo no se guarda y desaparece cuando creás la primera tuya. Entrá y tocá lo que quieras.</p>' : '';
  return (list.length ? `<div class="list">${cards}</div>` : '<p class="empty">Todavía no hay juntadas. Creá la primera y sumá a quienes vinieron.</p>') + hint + add + (list.some(j => !String(j.id).startsWith('demo')) ? '<p class="muted small">Acá ves las juntadas que abriste en este dispositivo. En otro celular, entrá con el link de cada juntada.</p>' : '');
}
function viewGrupos() {
  const list = withId(S.data.grupos).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const add = S.readOnly ? '' : '<button type="button" class="btn main wide" data-act="newGrupo">Nuevo grupo</button>';
  const items = list.map(g => `<button type="button" class="item" data-act="${S.readOnly ? 'noop' : 'editGrupo'}" data-id="${esc(g.id)}" data-key="${esc(g.id)}"><span class="stack grow" style="gap:3px"><h3 class="wrapword">${esc(g.nombre)}</h3><span class="muted small wrapword">${esc((g.personas || []).map(p => p.nombre).join(', '))}</span></span><span class="pill">${(g.personas || []).length} personas</span></button>`).join('');
  return (list.length ? `<div class="list">${items}</div>` : '<p class="empty">Guardá tus grupos de amigos con sus alias y armá cada juntada en dos toques.</p>') + add + '<p class="muted small">Los grupos se guardan en este dispositivo.</p>';
}

/* ---- Formulario de juntada y de grupo ---- */
function personRows(f, usados) {
  return f.personas.map((p, i) => `<div class="personrow-form" data-key="${esc(p.id)}">
    <input id="pn-${esc(p.id)}" aria-label="Nombre" placeholder="Nombre" value="${esc(p.nombre)}" data-bind="personas.${i}.nombre" autocomplete="off">
    <input id="pa-${esc(p.id)}" aria-label="Alias o CBU" placeholder="Alias (opcional)" value="${esc(p.alias)}" data-bind="personas.${i}.alias" autocomplete="off">
    <button type="button" class="iconbtn" aria-label="Quitar a ${esc(p.nombre || 'esta persona')}" data-act="delPersona" data-i="${i}" ${usados && usados[p.id] ? 'data-used="1"' : ''}>×</button>
  </div>`).join('');
}
function amigosConocidos() {
  const m = new Map();
  withId(S.data.juntadas).forEach(j => (j.personas || []).forEach(p => { const k = String(p.nombre).toLowerCase(); if (p.nombre) m.set(k, { nombre: p.nombre, alias: p.alias || (m.get(k) || {}).alias || '' }); }));
  withId(S.data.grupos).forEach(g => (g.personas || []).forEach(p => { const k = String(p.nombre).toLowerCase(); if (p.nombre && !m.has(k)) m.set(k, { nombre: p.nombre, alias: p.alias || '' }); }));
  return Array.from(m.values());
}
function viewJuntadaForm() {
  const f = S.form, editing = !!f.id;
  const grupos = withId(S.data.grupos);
  const ya = new Set(f.personas.map(p => String(p.nombre).trim().toLowerCase()));
  const sug = amigosConocidos().filter(a => !ya.has(a.nombre.toLowerCase()));
  const usados = {};
  if (editing) {
    gastosDe(f.id).forEach(g => { (g.pagadores || []).forEach(x => { usados[x.p] = 1; }); Object.keys(division(g)).forEach(k => { usados[k] = 1; }); });
    pagosDe(f.id).forEach(x => { usados[x.de] = 1; usados[x.a] = 1; });
  }
  const err = validarJuntada(f);
  return `<main class="wrap page"><button type="button" class="btn quiet back" data-act="cancelForm">‹ Volver</button>
  <h1 class="title">${editing ? 'Editar juntada' : 'Nueva juntada'}</h1>
  <form class="stack" data-form="1" novalidate>
    <label class="field"><span>Nombre</span><input id="j-nombre" value="${esc(f.nombre)}" data-bind="nombre" placeholder="Asado del sábado" autocomplete="off"></label>
    <div class="grid2">
      <label class="field"><span>Fecha</span><input id="j-fecha" type="date" value="${esc(f.fecha)}" data-bind="fecha"></label>
      <label class="field"><span>Moneda</span><select id="j-moneda" data-bind="moneda">${Object.keys(MONEDAS).map(m => `<option value="${m}" ${f.moneda === m ? 'selected' : ''}>${m} (${esc(MONEDAS[m])})</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Lugar (opcional)</span><input id="j-lugar" value="${esc(f.lugar)}" data-bind="lugar" placeholder="Casa de Nico" autocomplete="off"></label>
  </form>
  <section class="stack"><h2>Quiénes vinieron</h2>
    ${grupos.length ? `<div class="stack" style="gap:6px"><span class="label">Sumar un grupo</span><div class="chips">${grupos.map(g => `<button type="button" class="chip plain" data-act="addGrupoAJ" data-id="${esc(g.id)}">${esc(g.nombre)}</button>`).join('')}</div></div>` : ''}
    ${sug.length ? `<div class="stack" style="gap:6px"><span class="label">Sumar amigos de otras juntadas</span><div class="chips">${sug.slice(0, 16).map((a, i) => `<button type="button" class="chip plain" data-act="addAmigo" data-n="${esc(a.nombre)}" data-a="${esc(a.alias)}">+ ${esc(a.nombre)}</button>`).join('')}</div></div>` : ''}
    <div class="stack" style="gap:6px">${personRows(f, usados)}</div>
    <button type="button" class="btn" data-act="addPersona">Agregar persona</button>
    <p class="muted small">El alias aparece en el PDF para que sepan a dónde transferir.</p>
    ${editing ? '' : `<label class="field"><span>Guardar esta gente como grupo (opcional)</span><input id="j-grupo" value="${esc(f.grupoNombre)}" data-bind="grupoNombre" placeholder="Amigos de la facu" autocomplete="off"></label>`}
  </section>
  ${editing ? `<section class="stack"><button type="button" class="btn danger ${S.confirm === 'delJ' ? 'sure' : ''}" data-act="delJuntada">${S.confirm === 'delJ' ? 'Tocá de nuevo para borrarla con todos sus gastos' : 'Borrar juntada'}</button></section>` : ''}
  <div class="savebar">${err ? `<span class="small muted">${esc(err)}</span>` : ''}<button type="button" class="btn main wide" data-act="saveJuntada" ${err ? 'disabled' : ''}>${editing ? 'Guardar cambios' : 'Crear juntada'}</button></div>
  </main>`;
}
function validarJuntada(f) {
  if (!f.nombre.trim()) return 'Falta ponerle un nombre.';
  const ok = f.personas.filter(p => p.nombre.trim());
  if (ok.length < 2) return 'Hacen falta al menos dos personas.';
  const seen = new Set();
  for (const p of ok) { const k = p.nombre.trim().toLowerCase(); if (seen.has(k)) return p.nombre.trim() + ' está dos veces. Agregale el apellido a una para distinguirlas.'; seen.add(k); }
  return '';
}
function viewGrupoForm() {
  const f = S.form;
  const ok = f.nombre.trim() && f.personas.some(p => p.nombre.trim());
  return `<main class="wrap page"><button type="button" class="btn quiet back" data-act="cancelForm">‹ Volver</button>
  <h1 class="title">${f.id ? 'Editar grupo' : 'Nuevo grupo'}</h1>
  <label class="field"><span>Nombre del grupo</span><input id="g-nombre" value="${esc(f.nombre)}" data-bind="nombre" placeholder="Amigos de la facu" autocomplete="off"></label>
  <div class="stack" style="gap:6px">${personRows(f)}</div>
  <button type="button" class="btn" data-act="addPersona">Agregar persona</button>
  ${f.id ? `<button type="button" class="btn danger ${S.confirm === 'delG' ? 'sure' : ''}" data-act="delGrupo">${S.confirm === 'delG' ? 'Tocá de nuevo para borrarlo' : 'Borrar grupo'}</button>` : ''}
  <div class="savebar"><button type="button" class="btn main wide" data-act="saveGrupo" ${ok ? '' : 'disabled'}>Guardar grupo</button></div></main>`;
}

/* ---- Juntada ---- */
function viewJuntada() {
  const j = juntada(S.view.jid);
  if (!j) {
    const b = S.borradas[S.view.jid];
    const cuerpo = b
      ? `<section class="card stack"><h2>${esc(b.nombre)} fue borrada</h2><p class="muted">Se puede recuperar durante 30 días desde que la borraron.</p><button type="button" class="btn main" data-act="restaurarJ">Recuperar juntada</button></section>`
      : S.noExiste[S.view.jid] ? '<p class="empty">No encontré esta juntada. Revisá que el link esté completo.</p>' : '<p class="empty">Cargando la juntada…</p>';
    return `<main class="wrap page"><button type="button" class="btn quiet back" data-act="home">‹ Juntadas</button>${cuerpo}</main>`;
  }
  const r = report(j), tab = S.view.tab, ex = String(j.id).startsWith('demo');
  const tabs = [['gastos', 'Gastos'], ['balances', 'Balances'], ['pagos', 'Pagos'], ['resumen', 'Resumen']];
  const body = tab === 'balances' ? tabBalances(j, r) : tab === 'pagos' ? tabPagos(j, r) : tab === 'resumen' ? tabResumen(j, r) : tabGastos(j, r);
  return `<main class="wrap page"><div class="row between"><button type="button" class="btn quiet back" data-act="home">‹ Juntadas</button><span class="row" style="gap:6px">${ex ? '' : `<button type="button" class="btn tiny" data-act="toggleInvite" aria-expanded="${S.invite}">Invitar</button>`}${S.readOnly ? '' : '<button type="button" class="btn tiny" data-act="editJuntada">Editar</button>'}</span></div>
  ${S.notice ? `<p class="note warn">${esc(S.notice)}</p>` : ''}
  ${S.readOnly && !S.notice ? '<p class="note">Sin conexión. Ves lo último que se cargó.</p>' : ''}
  ${S.invite && !ex ? cardInvitar(j) : ''}
  <header class="stack" style="gap:4px"><div class="row" style="gap:8px"><h1 class="title">${esc(j.nombre)}</h1>${ex ? '<span class="pill">Ejemplo</span>' : ''}</div>
  <p class="muted">${esc([fechaTxt(j.fecha), ex ? '' : j.lugar, j.personas.length + ' personas'].filter(Boolean).join(' · '))}</p></header>
  <div class="stats"><div><span class="label">Total</span><b>${esc(r.money(r.bal.total))}</b></div><div><span class="label">Por persona</span><b>${esc(r.money(r.promedio))}</b></div><div><span class="label">Falta pasar</span><b>${esc(r.money(r.totalPendiente))}</b></div></div>
  ${ex ? '' : bloqueYo(j, r)}
  <div class="seg" role="tablist">${tabs.map(t => `<button type="button" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div>
  ${body}</main>`;
}
function linkDe(j) { return location.origin + rutaDe(j.id); }
function cardInvitar(j) {
  const link = linkDe(j);
  const texto = 'Sumate a la cuenta de ' + j.nombre + ' en Vaquita: ' + link;
  return `<section class="card stack"><h2>Invitar al grupo</h2><p class="muted small">Quien tenga este link puede ver y editar la juntada, sin crearse una cuenta. Compartilo sólo con tus amigos.</p>
    <div class="linkbox">${esc(link)}</div>
    <div class="grid2"><button type="button" class="btn main" data-act="copy" data-text="${esc(link)}" data-msg="Link copiado">Copiar link</button>
    ${navigator.share ? `<button type="button" class="btn" data-act="shareLink">Compartir</button>` : `<a class="btn" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener noreferrer">Mandar por WhatsApp</a>`}</div></section>`;
}
function bloqueYo(j, r) {
  const yo = leerYo(j.id);
  if (yo === undefined || (yo && !j.personas.some(p => p.id === yo))) {
    return `<section class="card stack"><h3>¿Quién sos en esta juntada?</h3><div class="chips">${j.personas.map(p => `<button type="button" class="chip" data-act="setYo" data-p="${esc(p.id)}">${av(j, p.id)}${esc(p.nombre)}</button>`).join('')}</div><button type="button" class="btn tiny quiet" style="justify-self:start" data-act="setYo" data-p="">Ahora no</button></section>`;
  }
  if (!yo) return '';
  const debo = r.bal.transfers.filter(t => t.de === yo), cobro = r.bal.transfers.filter(t => t.a === yo);
  const partes = debo.map(t => 'Tenés que pasarle ' + r.money(t.c) + ' a ' + r.nm(t.a)).concat(cobro.map(t => r.nm(t.de) + ' te tiene que pasar ' + r.money(t.c)));
  return `<div class="me stack" style="gap:2px"><span class="row between"><span>${esc(r.nm(yo))}, ${partes.length ? 'esto te toca:' : 'estás al día.'}</span><button type="button" class="btn tiny quiet" style="min-height:0;padding:0;color:inherit" data-act="setYo" data-p="__nadie">Cambiar</button></span>${partes.map(x => `<span class="wrapword" style="font-weight:500">${esc(x)}</span>`).join('')}</div>`;
}
function historial(j) {
  if (String(j.id).startsWith('demo')) return '';
  const log = S.actividad[j.id] || [], bor = S.papelera[j.id] || [];
  if (!log.length && !bor.length) return '';
  if (!S.verHistorial) return '<button type="button" class="btn tiny quiet" style="justify-self:start" data-act="toggleHistorial">Ver historial de cambios</button>';
  const fecha = ms => new Date(ms).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `<section class="stack"><div class="row between"><h2>Historial</h2><button type="button" class="btn tiny quiet" data-act="toggleHistorial">Ocultar</button></div>
    ${bor.length ? `<div class="list">${bor.map(b => `<div class="item" data-key="b-${esc(b.id)}"><span class="grow wrapword">${esc(b.desc)}<span class="muted small" style="display:block">Borrado el ${esc(fecha(b.at))}</span></span>${S.readOnly ? '' : `<button type="button" class="btn tiny" data-act="restaurarGasto" data-id="${esc(b.id)}">Recuperar</button>`}</div>`).join('')}</div>` : ''}
    <div class="card log">${log.map(a => `<div class="wrapword">${esc(a.texto)}<time>${esc(fecha(a.at))}</time></div>`).join('')}</div></section>`;
}
function tabGastos(j, r) {
  const add = S.readOnly ? '' : '<button type="button" class="btn main wide" data-act="newGasto">Agregar gasto</button>';
  if (!r.lista.length) return '<p class="empty">Cargá lo primero que se compró. Podés dividirlo en partes iguales, por ítems del ticket o con montos a medida.</p>' + add + historial(j);
  return `<div class="list">${r.lista.map(x => `<button type="button" class="item" data-act="${S.readOnly ? 'noop' : 'editGasto'}" data-id="${esc(x.g.id)}" data-key="${esc(x.g.id)}"><span class="stack grow" style="gap:3px"><span class="wrapword" style="font-weight:700">${esc(x.g.desc)}</span><span class="muted small wrapword">Pagó ${esc(x.pagoTxt)}</span><span class="muted small wrapword">${esc(x.reparto)}${x.g.cat ? ' · ' + esc(x.g.cat) : ''}</span></span><span class="num">${esc(r.money(x.g.total))}</span></button>`).join('')}</div>` + add + historial(j);
}
function tabBalances(j, r) {
  const rows = r.bal.rows;
  const max = Math.max(1, ...j.personas.map(p => Math.abs(rows[p.id].saldo)));
  const out = j.personas.map(p => {
    const b = rows[p.id], w = Math.abs(b.saldo) / max * 100, open = S.open[p.id];
    const lab = b.saldo === 0 ? '<span class="muted small">Al día</span>' : `<span class="num ${b.saldo > 0 ? 'pos' : 'neg'}">${b.saldo > 0 ? 'Recibe' : 'Debe'} ${esc(r.money(Math.abs(b.saldo)))}</span>`;
    const det = r.lista.filter(x => x.d[p.id] > 0).map(x => `<div><span class="wrapword">${esc(x.g.desc)}</span><span class="num">${esc(r.money(x.d[p.id]))}</span></div>`).join('');
    const neto = b.enviado - b.recibido;
    return `<button type="button" class="personrow" data-act="togglePerson" data-p="${esc(p.id)}" aria-expanded="${!!open}" data-key="${esc(p.id)}"><span class="row between" style="flex-wrap:nowrap"><span class="who">${av(j, p.id)}${esc(p.nombre)}</span>${lab}</span>
      <span class="muted small" style="display:block;margin-top:4px">Pagó ${esc(r.money(b.pagado))} · Consumió ${esc(r.money(b.consumido))}${neto ? ' · ' + (neto > 0 ? 'Transfirió ' : 'Cobró ') + esc(r.money(Math.abs(neto))) : ''}</span>
      <span class="bar" aria-hidden="true" style="display:grid"><div><i class="l" style="width:${b.saldo < 0 ? w : 0}%"></i></div><div><i class="r" style="width:${b.saldo > 0 ? w : 0}%"></i></div></span></button>
      ${open ? `<div class="detail" data-key="d-${esc(p.id)}"><span class="label">Qué consumió</span>${det || '<span class="muted">Nada todavía.</span>'}</div>` : ''}`;
  }).join('');
  return `<p class="muted small">Tocá una persona para ver el detalle de lo que consumió.</p><div class="list" style="display:block">${out}</div>`;
}
function tabPagos(j, r) {
  const alias = {}; j.personas.forEach(p => { alias[p.id] = p.alias; });
  const tickets = r.bal.transfers.map(t => `<article class="ticket" data-key="${esc(t.de + t.a)}"><div class="ticket-top"><span class="who">${av(j, t.de)}${esc(r.nm(t.de))} le pasa a ${esc(r.nm(t.a))}</span><b class="big">${esc(r.money(t.c))}</b></div>
    <div class="ticket-foot"><span class="grow mono">${alias[t.a] ? 'Alias: ' + esc(alias[t.a]) : 'Sin alias cargado'}</span>
    <span class="row" style="gap:6px;flex-wrap:nowrap">${alias[t.a] ? `<button type="button" class="btn tiny" data-act="copy" data-text="${esc(alias[t.a])}" data-msg="Alias copiado">Copiar</button>` : ''}${S.readOnly ? '' : `<button type="button" class="btn tiny main" data-act="markPaid" data-de="${esc(t.de)}" data-a="${esc(t.a)}" data-c="${t.c}">Ya pagó</button>`}</span></div></article>`).join('');
  const none = r.gastos.length ? '<p class="empty">Está todo saldado. Nadie le debe nada a nadie.</p>' : '<p class="empty">Cuando cargues gastos, acá vas a ver quién le paga a quién con la menor cantidad de transferencias.</p>';
  const hechos = r.pagos.length ? `<section class="stack"><h2>Pagos registrados</h2><div class="list">${r.pagos.map(x => `<div class="item" data-key="${esc(x.id)}"><span class="grow wrapword">${esc(r.nm(x.de))} le pasó a ${esc(r.nm(x.a))}<span class="muted small" style="display:block">${esc(fechaTxt(x.fecha))}</span></span><span class="stack" style="gap:4px;justify-items:end"><span class="num">${esc(r.money(x.c))}</span>${S.readOnly ? '' : `<button type="button" class="btn tiny quiet" data-act="delPago" data-id="${esc(x.id)}">Deshacer</button>`}</span></div>`).join('')}</div></section>` : '';
  const pf = S.pagoForm;
  const opts = sel => j.personas.map(p => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  const manual = S.readOnly ? '' : pf ? `<section class="card stack"><h3>Registrar otro pago</h3><div class="grid2">
      <label class="field"><span>Quién pagó</span><select id="pf-de" data-pf="de">${opts(pf.de)}</select></label>
      <label class="field"><span>A quién</span><select id="pf-a" data-pf="a">${opts(pf.a)}</select></label>
      <label class="field"><span>Monto</span><input id="pf-m" class="money" inputmode="decimal" value="${esc(pf.monto)}" data-pf="monto" placeholder="0"></label></div>
      <div class="row"><button type="button" class="btn main" data-act="savePago">Registrar pago</button><button type="button" class="btn quiet" data-act="closePago">Cancelar</button></div></section>` : '<button type="button" class="btn" data-act="openPago">Registrar un pago parcial u otro monto</button>';
  return `<section class="stack"><h2>Quién le paga a quién</h2>${tickets || none}</section>${manual}${hechos}`;
}
function tabResumen(j, r) {
  const balRows = j.personas.map(p => {
    const b = r.bal.rows[p.id];
    return `<tr data-key="${esc(p.id)}"><td style="font-weight:600">${esc(p.nombre)}</td><td class="r">${esc(r.money(b.pagado))}</td><td class="r">${esc(r.money(b.consumido))}</td><td class="r num ${b.saldo > 0 ? 'pos' : b.saldo < 0 ? 'neg' : 'muted'}">${b.saldo === 0 ? 'Al día' : (b.saldo > 0 ? '+' : '') + esc(r.money(b.saldo))}</td></tr>`;
  }).join('');
  return `<section class="card stack"><h2>Compartir con el grupo</h2><p class="muted small">El PDF trae quién le paga a quién con los alias, el balance de cada uno, quién compró qué y el detalle de lo que consumió cada persona. </p>
    <div class="grid2">${PUEDE_COMPARTIR ? '<button type="button" class="btn main" data-act="sharePdf">Compartir PDF</button>' : ''}<button type="button" class="btn ${PUEDE_COMPARTIR ? '' : 'main'}" data-act="pdf">Descargar PDF</button><button type="button" class="btn" data-act="copyResumen">Copiar texto para WhatsApp</button></div>
    ${S.copyText ? `<label class="field"><span>Seleccioná y copiá este texto</span><textarea id="copyfallback" class="copyfallback" readonly>${esc(S.copyText)}</textarea></label>` : ''}</section>
  <section class="stack"><h2>Balance</h2><div class="card tablewrap" style="padding:6px"><table><thead><tr><th>Persona</th><th class="r">Pagó</th><th class="r">Consumió</th><th class="r">Saldo</th></tr></thead><tbody>${balRows}</tbody></table></div></section>
  <section class="stack"><h2>Quién compró qué</h2>${r.lista.length ? `<div class="list">${r.lista.map(x => `<div class="item" data-key="${esc(x.g.id)}"><span class="grow stack" style="gap:3px"><span style="font-weight:700" class="wrapword">${esc(x.g.desc)}</span><span class="muted small wrapword">Pagó ${esc(x.pagoTxt)} · ${esc(x.reparto)}</span>${x.sub.map(s => `<span class="muted small wrapword">${esc(s)}</span>`).join('')}</span><span class="num">${esc(r.money(x.g.total))}</span></div>`).join('')}</div>` : '<p class="empty">Sin gastos cargados.</p>'}</section>`;
}

/* ---- Formulario de gasto ---- */
function nuevoGastoForm(j) {
  const all = j.personas.map(p => p.id);
  return { id: null, jid: j.id, desc: '', cat: 'Comida', modo: 'iguales', totalStr: '', pagoModo: 'uno', pagador: all[0], pagos: {}, part: Object.fromEntries(all.map(p => [p, true])), montos: {}, pct: {}, partes: Object.fromEntries(all.map(p => [p, '1'])), items: [nuevoItem(j)], propinaStr: '', descuentoStr: '', creado: Date.now() };
}
function nuevoItem(j) { return { id: uid('i'), nombre: '', precioStr: '', consumen: Object.fromEntries(j.personas.map(p => [p.id, 1])), ajustar: false }; }
function gastoAForm(g, j) {
  const f = nuevoGastoForm(j);
  Object.assign(f, { id: g.id, version: g._v, desc: g.desc || '', cat: g.cat || 'Otros', modo: g.modo || 'iguales', creado: g.creado });
  const pag = g.pagadores || [];
  if (pag.length === 1) f.pagador = pag[0].p; else { f.pagoModo = 'varios'; pag.forEach(x => { f.pagos[x.p] = toInput(x.c); }); }
  if (f.modo === 'iguales') { f.totalStr = toInput(g.total); f.part = Object.fromEntries((g.participantes || []).map(p => [p, true])); }
  if (f.modo === 'porcentajes') { f.totalStr = toInput(g.total); Object.entries(g.valores || {}).forEach(([k, v]) => { f.pct[k] = String(v).replace('.', ','); }); }
  if (f.modo === 'partes') { f.totalStr = toInput(g.total); f.partes = {}; Object.entries(g.valores || {}).forEach(([k, v]) => { f.partes[k] = String(v).replace('.', ','); }); }
  if (f.modo === 'montos') Object.entries(g.valores || {}).forEach(([k, v]) => { f.montos[k] = toInput(v); });
  if (f.modo === 'items') {
    f.items = (g.items || []).map(it => {
      const c = { ...(it.consumen || {}) };
      return { id: it.id || uid('i'), nombre: it.nombre || '', precioStr: toInput(it.precio), consumen: c, ajustar: Object.values(c).some(v => v > 1) };
    });
    f.propinaStr = toInput(g.propina); f.descuentoStr = toInput(g.descuento);
  }
  return f;
}
function itemsSub(f) { return f.items.reduce((a, it) => a + (parseMoney(it.precioStr) || 0), 0); }
/* Traduce el formulario a un gasto y explica qué falta */
function buildGasto(f, j) {
  const errs = [];
  const g = { juntadaId: f.jid, desc: f.desc.trim(), cat: f.cat, modo: f.modo, total: 0, pagadores: [], participantes: [], valores: {}, items: [], propina: 0, descuento: 0, creado: f.creado };
  if (!g.desc) errs.push('Falta contar qué fue.');
  const ids = j.personas.map(p => p.id);
  const totalInput = parseMoney(f.totalStr) || 0;
  if (f.modo === 'iguales') {
    g.total = totalInput; g.participantes = ids.filter(p => f.part[p]);
    if (!g.total) errs.push('Falta el monto.');
    if (!g.participantes.length) errs.push('Elegí al menos una persona.');
  } else if (f.modo === 'partes') {
    g.total = totalInput;
    ids.forEach(p => { const v = parseNum(f.partes[p]); if (v) g.valores[p] = v; });
    if (!g.total) errs.push('Falta el monto.');
    if (!Object.keys(g.valores).length) errs.push('Asigná partes a alguien.');
  } else if (f.modo === 'porcentajes') {
    g.total = totalInput;
    ids.forEach(p => { const v = parseNum(f.pct[p]); if (v) g.valores[p] = v; });
    const s = Object.values(g.valores).reduce((a, b) => a + b, 0);
    if (!g.total) errs.push('Falta el monto.');
    if (Math.abs(s - 100) > .001) errs.push(s < 100 ? 'Falta asignar ' + fmtPct(100 - s) + '%.' : 'Te pasaste por ' + fmtPct(s - 100) + '%.');
  } else if (f.modo === 'montos') {
    ids.forEach(p => { const c = parseMoney(f.montos[p]); if (c) g.valores[p] = c; });
    g.total = Object.values(g.valores).reduce((a, b) => a + b, 0);
    if (!g.total) errs.push('Cargá cuánto le toca a cada uno.');
  } else {
    const usados = f.items.filter(it => it.nombre.trim() || parseMoney(it.precioStr));
    usados.forEach(it => {
      const precio = parseMoney(it.precioStr) || 0, cons = {};
      Object.keys(it.consumen).forEach(k => { if (it.consumen[k] > 0) cons[k] = it.consumen[k]; });
      const nom = it.nombre.trim() || 'un ítem';
      if (!precio) errs.push('Falta el precio de ' + nom + '.');
      if (!Object.keys(cons).length) errs.push('Falta elegir quién consumió ' + nom + '.');
      g.items.push({ id: it.id, nombre: it.nombre.trim(), precio, consumen: cons });
    });
    if (!usados.length) errs.push('Agregá al menos un ítem.');
    g.propina = parseMoney(f.propinaStr) || 0; g.descuento = parseMoney(f.descuentoStr) || 0;
    const sub = g.items.reduce((a, it) => a + it.precio, 0);
    if (usados.length && g.descuento >= sub + g.propina) errs.push('El descuento no puede cubrir todo el total.');
    g.total = Math.max(0, sub + g.propina - g.descuento);
  }
  if (f.pagoModo === 'uno') {
    g.pagadores = [{ p: f.pagador, c: g.total }];
  } else {
    ids.forEach(p => { const c = parseMoney(f.pagos[p]); if (c) g.pagadores.push({ p, c }); });
    const s = g.pagadores.reduce((a, x) => a + x.c, 0);
    if (s !== g.total && g.total) errs.push(s < g.total ? 'Falta asignar ' + fmt(g.total - s, j.moneda) + ' de lo pagado.' : 'Lo pagado se pasa por ' + fmt(s - g.total, j.moneda) + '.');
  }
  return { g, errs };
}
const fmtPct = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
function viewGastoForm() {
  const f = S.form, j = juntada(f.jid);
  if (!j) return '<main class="wrap page"><p class="empty">La juntada ya no existe.</p></main>';
  const { g, errs } = buildGasto(f, j);
  const money = c => fmt(c, j.moneda);
  const reparto = errs.some(e => /Falta el monto|Elegí|Asigná|Falta asignar .*%|Te pasaste|Agregá|Cargá/.test(e)) ? null : division(g);
  const mode = Object.keys(MODOS).map(m => `<button type="button" aria-pressed="${f.modo === m}" data-act="setModo" data-m="${m}">${MODO_CORTO[m]}</button>`).join('');
  const totalField = f.modo === 'items' || f.modo === 'montos' ? '' : `<label class="field"><span>Monto total</span><input id="g-total" class="money" inputmode="decimal" value="${esc(f.totalStr)}" data-bind="totalStr" placeholder="0"></label>`;
  let panel = '';
  const row = (p, inner) => `<div class="valrow" data-key="${esc(p.id)}"><span class="who">${av(j, p.id)}${esc(p.nombre)}</span>${inner}</div>`;
  if (f.modo === 'iguales') {
    panel = `<div class="row between"><span class="label">Entre quiénes</span><span class="row" style="gap:4px"><button type="button" class="btn tiny quiet" data-act="partAll" data-v="1">Todos</button><button type="button" class="btn tiny quiet" data-act="partAll" data-v="">Nadie</button></span></div><div class="chips">${j.personas.map(p => `<button type="button" class="chip" aria-pressed="${!!f.part[p.id]}" data-act="togglePart" data-p="${esc(p.id)}">${av(j, p.id)}${esc(p.nombre)}</button>`).join('')}</div>`;
  } else if (f.modo === 'montos') {
    panel = `<span class="label">Cuánto consumió cada uno</span><div class="vals">${j.personas.map(p => row(p, `<input id="m-${esc(p.id)}" class="money" inputmode="decimal" aria-label="Monto de ${esc(p.nombre)}" value="${esc(f.montos[p.id] || '')}" data-bind="montos.${esc(p.id)}" placeholder="0">`)).join('')}</div><p class="muted small">El total del gasto es la suma de estos montos. Quien no consumió, queda vacío.</p>`;
  } else if (f.modo === 'porcentajes') {
    panel = `<span class="label">Porcentaje de cada uno</span><div class="vals">${j.personas.map(p => row(p, `<input id="c-${esc(p.id)}" class="money" inputmode="decimal" aria-label="Porcentaje de ${esc(p.nombre)}" value="${esc(f.pct[p.id] || '')}" data-bind="pct.${esc(p.id)}" placeholder="0 %">`)).join('')}</div>`;
  } else if (f.modo === 'partes') {
    panel = `<span class="label">Partes de cada uno</span><div class="vals">${j.personas.map(p => row(p, `<input id="s-${esc(p.id)}" class="money" inputmode="decimal" aria-label="Partes de ${esc(p.nombre)}" value="${esc(f.partes[p.id] || '')}" data-bind="partes.${esc(p.id)}" placeholder="0">`)).join('')}</div><p class="muted small">Sirve para parejas o familias: quien pone 2 paga el doble que quien pone 1. Con 0 no paga nada.</p>`;
  } else {
    const sub = itemsSub(f);
    panel = `<span class="label">Ítems del ticket</span><div class="stack">${f.items.map((it, i) => `<div class="itemcard" data-key="${esc(it.id)}">
        <div class="itemhead"><input id="in-${esc(it.id)}" aria-label="Qué es" placeholder="Qué es" value="${esc(it.nombre)}" data-bind="items.${i}.nombre" autocomplete="off"><input id="ip-${esc(it.id)}" class="money" inputmode="decimal" aria-label="Precio de este ítem" placeholder="Precio" value="${esc(it.precioStr)}" data-bind="items.${i}.precioStr"><button type="button" class="iconbtn" aria-label="Quitar ítem" data-act="delItem" data-i="${i}">×</button></div>
        ${it.ajustar
          ? `<div class="vals">${j.personas.map(p => `<div class="row between" data-key="${esc(p.id)}" style="flex-wrap:nowrap"><span class="who">${av(j, p.id)}${esc(p.nombre)}</span><span class="stepper"><button type="button" aria-label="Menos" data-act="step" data-i="${i}" data-p="${esc(p.id)}" data-d="-1">−</button><b>${n0(it.consumen[p.id])}</b><button type="button" aria-label="Más" data-act="step" data-i="${i}" data-p="${esc(p.id)}" data-d="1">+</button></span></div>`).join('')}</div>`
          : `<div class="chips">${j.personas.map(p => `<button type="button" class="chip" aria-pressed="${it.consumen[p.id] > 0}" data-act="toggleCons" data-i="${i}" data-p="${esc(p.id)}">${av(j, p.id)}${esc(p.nombre)}</button>`).join('')}</div>`}
        <button type="button" class="btn tiny quiet" style="justify-self:start" data-act="toggleAjustar" data-i="${i}">${it.ajustar ? 'Volver a partes iguales' : 'Ajustar por cantidad (ej.: 2 cervezas y 1)'}</button>
      </div>`).join('')}</div>
      <button type="button" class="btn" data-act="addItem">Agregar ítem</button>
      <div class="grid2"><label class="field"><span class="row between"><span>Propina o recargo</span><button type="button" class="btn tiny quiet" style="min-height:0;padding:0" data-act="propina10" ${sub ? '' : 'disabled'}>10 %</button></span><input id="g-propina" class="money" inputmode="decimal" value="${esc(f.propinaStr)}" data-bind="propinaStr" placeholder="0"></label>
      <label class="field"><span>Descuento</span><input id="g-desc-monto" class="money" inputmode="decimal" value="${esc(f.descuentoStr)}" data-bind="descuentoStr" placeholder="0"></label></div>
      <p class="muted small">La propina y el descuento se reparten según lo que consumió cada uno.</p>`;
  }
  const payer = f.pagoModo === 'uno'
    ? `<div class="chips">${j.personas.map(p => `<button type="button" class="chip" aria-pressed="${f.pagador === p.id}" data-act="setPagador" data-p="${esc(p.id)}">${av(j, p.id)}${esc(p.nombre)}</button>`).join('')}</div>`
    : `<div class="vals">${j.personas.map(p => row(p, `<input id="py-${esc(p.id)}" class="money" inputmode="decimal" aria-label="Lo que pagó ${esc(p.nombre)}" value="${esc(f.pagos[p.id] || '')}" data-bind="pagos.${esc(p.id)}" placeholder="0">`)).join('')}</div>`;
  const preview = reparto ? `<section class="stack"><span class="label">Le toca a cada uno</span><div class="list" style="display:block">${j.personas.filter(p => reparto[p.id]).map(p => `<div class="row between" data-key="${esc(p.id)}" style="padding:8px 14px;flex-wrap:nowrap"><span class="who">${av(j, p.id)}${esc(p.nombre)}</span><span class="num">${esc(money(reparto[p.id]))}</span></div>`).join('')}</div></section>` : '';
  return `<main class="wrap page"><button type="button" class="btn quiet back" data-act="cancelForm">‹ ${esc(j.nombre)}</button>
  <h1 class="title">${f.id ? 'Editar gasto' : 'Nuevo gasto'}</h1>
  <label class="field"><span>Qué fue</span><input id="g-desc" value="${esc(f.desc)}" data-bind="desc" placeholder="Carne y achuras" autocomplete="off"></label>
  <div class="chips">${CATS.map(c => `<button type="button" class="chip plain" aria-pressed="${f.cat === c}" data-act="setCat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
  <section class="stack"><h2>Cómo se divide</h2><div class="seg multi">${mode}</div>${totalField}${panel}</section>
  <section class="stack"><div class="row between"><h2>Quién pagó</h2><button type="button" class="btn tiny quiet" data-act="togglePagoModo">${f.pagoModo === 'uno' ? 'Pagaron varios' : 'Pagó una sola persona'}</button></div>${payer}</section>
  ${preview}
  ${f.id ? `<button type="button" class="btn danger ${S.confirm === 'delGasto' ? 'sure' : ''}" data-act="delGasto">${S.confirm === 'delGasto' ? 'Tocá de nuevo para borrarlo' : 'Borrar gasto'}</button>` : ''}
  <div class="savebar"><div class="row between"><span class="small ${errs.length ? 'muted' : ''}">${esc(errs[0] || 'Listo para guardar')}</span><span class="num">${esc(money(g.total))}</span></div><button type="button" class="btn main wide" data-act="saveGasto" ${errs.length ? 'disabled' : ''}>${f.id ? 'Guardar cambios' : 'Guardar gasto'}</button></div>
  </main>`;
}

/* ========== Acciones ========== */
function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); return true; }
  catch (e) { return false; }
}
const nuevaPersona = (n, a) => ({ id: uid('p'), nombre: n || '', alias: a || '' });
function sumarPersonas(lista) {
  const f = S.form;
  f.personas = f.personas.filter(p => p.nombre.trim() || p.alias.trim() || (f.id && p.existente));
  const ya = new Set(f.personas.map(p => p.nombre.trim().toLowerCase()));
  lista.forEach(p => { const k = String(p.nombre).toLowerCase(); if (!ya.has(k)) { ya.add(k); f.personas.push(nuevaPersona(p.nombre, p.alias)); } });
  if (!f.personas.length) f.personas.push(nuevaPersona());
}
const A = {
  noop() {},
  home() { goHome(); },
  homeTab(d) { goHome(d.tab); },
  tab(d) { S.view.tab = d.tab; S.copyText = null; S.invite = false; render(); },
  openJ(d) { openJuntada(d.id); },
  newJuntada() {
    S.form = { id: null, nombre: '', fecha: hoy(), lugar: '', moneda: 'ARS', personas: [nuevaPersona(), nuevaPersona()], grupoNombre: '' };
    go({ name: 'juntadaForm', back: S.view }); S.focus = 'j-nombre'; render();
  },
  editJuntada() {
    const j = juntada(S.view.jid);
    S.form = { id: j.id, nombre: j.nombre || '', fecha: j.fecha || '', lugar: j.lugar || '', moneda: j.moneda || 'ARS', personas: j.personas.map(p => ({ id: p.id, nombre: p.nombre || '', alias: p.alias || '', existente: true })), grupoNombre: '', creado: j.creado, version: j._v };
    go({ name: 'juntadaForm', jid: j.id, back: S.view });
  },
  cancelForm() {
    const back = S.view.back; S.form = null;
    if (back) go(back); else goHome();
  },
  addPersona() { const p = nuevaPersona(); S.form.personas.push(p); S.focus = 'pn-' + p.id; render(); },
  delPersona(d, el) {
    if (el.dataset.used) { toast('Esta persona figura en gastos o pagos. Sacala de ahí antes de quitarla.'); return; }
    S.form.personas.splice(+d.i, 1); render();
  },
  addGrupoAJ(d) { const g = S.data.grupos[d.id]; if (g) { sumarPersonas(g.personas || []); render(); } },
  addAmigo(d) { sumarPersonas([{ nombre: d.n, alias: d.a }]); render(); },
  async saveJuntada() {
    const f = S.form; if (validarJuntada(f)) return;
    const personas = f.personas.filter(p => p.nombre.trim()).map(p => ({ id: p.id, nombre: p.nombre.trim(), alias: p.alias.trim() }));
    const doc = { nombre: f.nombre.trim(), fecha: f.fecha, lugar: f.lugar.trim(), moneda: f.moneda, personas, creado: f.creado || Date.now() };
    let id = f.id;
    if (id && String(id).startsWith('demo')) {
      S.demo.juntadas[id] = doc;
    } else {
      try {
        const snap = id
          ? await api('PUT', '/j/' + id, { data: doc, ifVersion: f.version, quien: quien(id) })
          : await api('POST', '/juntadas', { data: doc });
        id = snap.token; recordar(id); ingerir(snap);
      } catch (e) { writeFailed(e, id); return; }
    }
    if (f.grupoNombre && f.grupoNombre.trim()) await save('grupos', uid('g'), { nombre: f.grupoNombre.trim(), personas: personas.map(p => ({ nombre: p.nombre, alias: p.alias })) });
    const nueva = !f.id;
    openJuntada(id, 'gastos');
    if (nueva) { S.invite = true; render(); }
  },
  async delJuntada() {
    if (S.confirm !== 'delJ') { S.confirm = 'delJ'; render(); return; }
    const id = S.form.id;
    if (String(id).startsWith('demo')) {
      S.demo.gastos = {}; S.demo.pagos = {}; S.demo.juntadas = {};
      S.demoOff = true; try { localStorage.setItem('vaquita.demoOff', '1'); } catch (e) { /* no se recuerda */ }
      goHome(); toast('Ejemplo borrado'); return;
    }
    try { await api('DELETE', '/j/' + id, { quien: quien(id) }); }
    catch (e) { writeFailed(e, id); return; }
    olvidar(id);
    goHome(); toast('Juntada borrada. Se puede recuperar con su link durante 30 días.');
  },
  async restaurarJ() {
    const id = S.view.jid;
    try { const snap = await api('POST', '/j/' + id + '/restaurar', { quien: quien(id) }); delete S.borradas[id]; recordar(id); ingerir(snap); render(); toast('Juntada recuperada'); }
    catch (e) { writeFailed(e, id); }
  },
  async restaurarGasto(d) {
    const id = S.view.jid;
    try { ingerir(await api('POST', '/j/' + id + '/gastos/' + d.id + '/restaurar', { quien: quien(id) })); render(); toast('Gasto recuperado'); }
    catch (e) { writeFailed(e, id); }
  },
  toggleInvite() { S.invite = !S.invite; render(); },
  toggleHistorial() { S.verHistorial = !S.verHistorial; render(); },
  setYo(d) { guardarYo(S.view.jid, d.p === '__nadie' ? undefined : d.p); render(); },
  shareLink() { const j = juntada(S.view.jid); navigator.share({ title: j.nombre + ' en Vaquita', text: 'Sumate a la cuenta de ' + j.nombre, url: linkDe(j) }).catch(() => {}); },
  newGrupo() { S.form = { id: null, nombre: '', personas: [nuevaPersona(), nuevaPersona()] }; go({ name: 'grupoForm', back: { name: 'home', tab: 'grupos' } }); S.focus = 'g-nombre'; render(); },
  editGrupo(d) {
    const g = S.data.grupos[d.id]; if (!g) return;
    S.form = { id: d.id, nombre: g.nombre || '', personas: (g.personas || []).map(p => nuevaPersona(p.nombre, p.alias)) };
    go({ name: 'grupoForm', back: { name: 'home', tab: 'grupos' } });
  },
  async saveGrupo() {
    const f = S.form;
    const ok = await save('grupos', f.id || uid('g'), { nombre: f.nombre.trim(), personas: f.personas.filter(p => p.nombre.trim()).map(p => ({ nombre: p.nombre.trim(), alias: p.alias.trim() })) });
    if (ok) goHome('grupos');
  },
  async delGrupo() {
    if (S.confirm !== 'delG') { S.confirm = 'delG'; render(); return; }
    await remove('grupos', S.form.id); goHome('grupos');
  },
  newGasto() { const j = juntada(S.view.jid); S.form = nuevoGastoForm(j); go({ name: 'gastoForm', jid: j.id, back: S.view }); S.focus = 'g-desc'; render(); },
  editGasto(d) { const j = juntada(S.view.jid); const g = gastosDe(j.id).find(x => x.id === d.id); if (!g) return; S.form = gastoAForm(g, j); go({ name: 'gastoForm', jid: j.id, back: S.view }); },
  setModo(d) { S.form.modo = d.m; const j = juntada(S.form.jid); if (d.m === 'items' && !S.form.items.length) S.form.items = [nuevoItem(j)]; render(); },
  setCat(d) { S.form.cat = d.c; render(); },
  togglePart(d) { S.form.part[d.p] = !S.form.part[d.p]; render(); },
  partAll(d) { const j = juntada(S.form.jid); j.personas.forEach(p => { S.form.part[p.id] = !!d.v; }); render(); },
  setPagador(d) { S.form.pagador = d.p; render(); },
  togglePagoModo() { S.form.pagoModo = S.form.pagoModo === 'uno' ? 'varios' : 'uno'; render(); },
  addItem() { const it = nuevoItem(juntada(S.form.jid)); S.form.items.push(it); S.focus = 'in-' + it.id; render(); },
  delItem(d) { S.form.items.splice(+d.i, 1); if (!S.form.items.length) S.form.items.push(nuevoItem(juntada(S.form.jid))); render(); },
  toggleCons(d) { const c = S.form.items[+d.i].consumen; c[d.p] = c[d.p] > 0 ? 0 : 1; render(); },
  toggleAjustar(d) { const it = S.form.items[+d.i]; it.ajustar = !it.ajustar; if (!it.ajustar) Object.keys(it.consumen).forEach(k => { it.consumen[k] = it.consumen[k] > 0 ? 1 : 0; }); render(); },
  step(d) { const c = S.form.items[+d.i].consumen; c[d.p] = Math.max(0, n0(c[d.p]) + (+d.d)); render(); },
  propina10() { S.form.propinaStr = toInput(Math.round(itemsSub(S.form) / 10)); render(); },
  async saveGasto() {
    const f = S.form, j = juntada(f.jid);
    const { g, errs } = buildGasto(f, j);
    if (errs.length) return;
    if (await save('gastos', f.id || uid('g'), g, f.version)) { S.form = null; go(S.view.back); toast('Gasto guardado'); }
  },
  async delGasto() {
    if (S.confirm !== 'delGasto') { S.confirm = 'delGasto'; render(); return; }
    const back = S.view.back;
    if (await remove('gastos', S.form.id)) { S.form = null; go(back); toast('Gasto borrado'); }
  },
  togglePerson(d) { S.open[d.p] = !S.open[d.p]; render(); },
  markPaid(d) { save('pagos', uid('x'), { juntadaId: S.view.jid, de: d.de, a: d.a, c: +d.c, fecha: hoy(), creado: Date.now() }).then(ok => { if (ok) toast('Pago registrado'); }); },
  delPago(d) { remove('pagos', d.id); },
  openPago() { const j = juntada(S.view.jid); S.pagoForm = { de: j.personas[0].id, a: (j.personas[1] || j.personas[0]).id, monto: '' }; S.focus = 'pf-m'; render(); },
  closePago() { S.pagoForm = null; render(); },
  async savePago() {
    const p = S.pagoForm, c = parseMoney(p.monto);
    if (p.de === p.a) { toast('Elegí dos personas distintas.'); return; }
    if (!c) { toast('Cargá el monto del pago.'); return; }
    if (await save('pagos', uid('x'), { juntadaId: S.view.jid, de: p.de, a: p.a, c, fecha: hoy(), creado: Date.now() })) { S.pagoForm = null; render(); toast('Pago registrado'); }
  },
  copy(d) { copy(d.text, d.msg).then(ok => { if (!ok) toast('Copialo a mano: ' + d.text); }); },
  copyResumen() {
    const j = juntada(S.view.jid);
    const text = whatsappText(report(j)) + (String(j.id).startsWith('demo') ? '' : '\n\nDetalle y PDF: ' + linkDe(j));
    copy(text, 'Resumen copiado. Pegalo en el grupo.').then(ok => { if (!ok) { S.copyText = text; S.focus = 'copyfallback'; render(); } });
  },
  pdf() {
    const j = juntada(S.view.jid);
    const url = URL.createObjectURL(new Blob([buildPdf(report(j))], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = nombreArchivo(j);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('PDF descargado');
  },
  /* Sin esperas antes de compartir: los celulares exigen que salga directo del toque */
  sharePdf() {
    const j = juntada(S.view.jid);
    const file = new File([buildPdf(report(j))], nombreArchivo(j), { type: 'application/pdf' });
    navigator.share({ files: [file], title: j.nombre }).catch(e => { if (e && e.name !== 'AbortError') A.pdf(); });
  },
};
root.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  e.preventDefault();
  A[el.dataset.act](el.dataset, el);
});
function onField(e) {
  const t = e.target;
  if (t.dataset.bind && S.form) { setPath(S.form, t.dataset.bind, t.value); render(); }
  else if (t.dataset.pf && S.pagoForm) { S.pagoForm[t.dataset.pf] = t.value; render(); }
}
root.addEventListener('input', onField);
root.addEventListener('submit', e => e.preventDefault());

init();
