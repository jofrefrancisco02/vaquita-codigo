import L from '../public/logic.js';
import * as store from './store.mjs';
import { ESQUEMA } from './schema.mjs';

const MAX_BODY = 256 * 1024;
const MAX_GASTOS = 300;
const MAX_PAGOS = 300;
const MAX_LOTE = 90;
const RE_TOKEN = '[A-Za-z0-9_-]{10,64}';
const RE_ID = '[A-Za-z0-9][A-Za-z0-9_-]{0,39}';
const LIMITES = { crear: 30, escribir: 300, leer: 1500 };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SEGURIDAD = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP };

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...SEGURIDAD } });

function nuevoToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Freno ante abusos. Cuenta por instancia del servidor, así que es una protección parcial. */
const cuentas = new Map();
function limitar(req, env, tipo, ventana) {
  const max = (env.LIMITES && env.LIMITES[tipo]) || LIMITES[tipo];
  const k = tipo + '|' + (req.headers.get('cf-connecting-ip') || 'local');
  const now = Date.now();
  if (cuentas.size > 5000) cuentas.clear();
  let c = cuentas.get(k);
  if (!c || c.hasta < now) { c = { n: 0, hasta: now + ventana }; cuentas.set(k, c); }
  if (++c.n > max) throw new HttpError(429, 'Demasiados pedidos seguidos. Esperá un momento y probá de nuevo.');
}

async function leerJson(req) {
  if (!/^application\/json/i.test(req.headers.get('content-type') || '')) throw new HttpError(415, 'El pedido tiene que ser JSON.');
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) throw new HttpError(413, 'El contenido es demasiado grande.');
  const texto = await req.text();
  if (texto.length > MAX_BODY) throw new HttpError(413, 'El contenido es demasiado grande.');
  try {
    const v = JSON.parse(texto);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch (e) { throw new HttpError(400, 'No pude leer los datos enviados.'); }
}
async function viva(db, token) {
  const row = await store.getRow(db, token);
  if (!row) throw new HttpError(404, 'No encontré esta juntada. Revisá el link.');
  if (row.deleted_at) throw new HttpError(410, 'Esta juntada fue borrada.', { nombre: JSON.parse(row.data).nombre, borradaEl: row.deleted_at });
  return { row, j: JSON.parse(row.data) };
}
const quienDe = b => (typeof (b && b.quien) === 'string' && b.quien.trim().slice(0, 60)) || 'Alguien';
function validar(res) {
  if (res.error) throw new HttpError(400, res.error);
  return res.doc;
}
const conflicto = nombre => new HttpError(409, 'Alguien más cambió ' + nombre + ' mientras lo editabas. Cerralo y volvé a abrirlo para ver la última versión.');

const rutas = [
  ['GET', '/api/healthz', async () => json({ ok: true })],
  ['POST', '/api/juntadas', async (req, m, env) => {
    limitar(req, env, 'crear', 3600000);
    const b = await leerJson(req);
    const doc = validar(L.limpiarJuntada(b.data));
    const token = nuevoToken();
    await store.crearJuntada(env.DB, token, doc, quienDe(b) + ' creó la juntada');
    return json(await store.snapshot(env.DB, token), 201);
  }],
  ['POST', '/api/batch', async (req, m, env) => {
    const b = await leerJson(req);
    const re = new RegExp('^' + RE_TOKEN + '$');
    const pedidos = (Array.isArray(b.tokens) ? b.tokens : []).slice(0, MAX_LOTE);
    const validos = pedidos.filter(t => typeof t === 'string' && re.test(t));
    const juntadas = await store.snapshots(env.DB, validos);
    const hay = new Set(juntadas.map(s => s.token));
    return json({ juntadas, faltantes: validos.filter(t => !hay.has(t)) });
  }],
  ['GET', `/api/j/(${RE_TOKEN})`, async (req, m, env) => {
    await viva(env.DB, m[1]);
    return json(await store.snapshot(env.DB, m[1]));
  }],
  /* Consulta liviana que la app repite cada pocos segundos para detectar cambios */
  ['GET', `/api/j/(${RE_TOKEN})/rev`, async (req, m, env) => {
    const r = await store.getRev(env.DB, m[1]);
    if (!r) throw new HttpError(404, 'No encontré esta juntada. Revisá el link.');
    if (r.deleted_at) throw new HttpError(410, 'Esta juntada fue borrada.');
    return json({ rev: r.rev });
  }],
  ['PUT', `/api/j/(${RE_TOKEN})`, async (req, m, env) => {
    const db = env.DB, token = m[1];
    const { row } = await viva(db, token);
    const b = await leerJson(req);
    if (b.ifVersion != null && row.version !== b.ifVersion) throw conflicto('la juntada');
    const doc = validar(L.limpiarJuntada(b.data));
    const quedan = new Set(doc.personas.map(p => p.id));
    const usados = new Set();
    (await store.itemsVivos(db, token, 'gastos')).forEach(g => {
      (g.pagadores || []).forEach(x => usados.add(x.p));
      Object.keys(L.division(g)).forEach(k => usados.add(k));
    });
    (await store.itemsVivos(db, token, 'pagos')).forEach(x => { usados.add(x.de); usados.add(x.a); });
    if ([...usados].some(id => !quedan.has(id))) throw new HttpError(409, 'No se puede quitar a alguien que figura en gastos o pagos.');
    if (!(await store.actualizarJuntada(db, token, doc, row.version, quienDe(b) + ' editó los datos de la juntada'))) throw conflicto('la juntada');
    return json(await store.snapshot(db, token));
  }],
  ['DELETE', `/api/j/(${RE_TOKEN})`, async (req, m, env) => {
    await viva(env.DB, m[1]);
    const b = await leerJson(req);
    await store.marcarJuntada(env.DB, m[1], true, quienDe(b) + ' borró la juntada');
    return json({ ok: true });
  }],
  ['POST', `/api/j/(${RE_TOKEN})/restaurar`, async (req, m, env) => {
    const row = await store.getRow(env.DB, m[1]);
    if (!row) throw new HttpError(404, 'No encontré esta juntada. Revisá el link.');
    const b = await leerJson(req);
    if (row.deleted_at) await store.marcarJuntada(env.DB, m[1], false, quienDe(b) + ' recuperó la juntada');
    return json(await store.snapshot(env.DB, m[1]));
  }],
  ['PUT', `/api/j/(${RE_TOKEN})/(gastos|pagos)/(${RE_ID})`, async (req, m, env) => {
    const db = env.DB, [, token, kind, id] = m;
    const { j } = await viva(db, token);
    const b = await leerJson(req);
    const row = await store.getItem(db, token, kind, id);
    const nombre = kind === 'gastos' ? 'este gasto' : 'este pago';
    const money = c => L.fmt(c, j.moneda);
    if (row && row.deleted_at) throw new HttpError(409, 'Este gasto fue borrado. Podés recuperarlo desde el historial.');
    if (row && b.ifVersion == null) throw new HttpError(409, 'Ya existe un registro con este identificador.');
    if (row && row.version !== b.ifVersion) throw conflicto(nombre);
    if (!row && b.ifVersion) throw new HttpError(409, 'Alguien más borró este registro mientras lo editabas.');
    if (!row && (await store.contar(db, token, kind)) >= (kind === 'gastos' ? MAX_GASTOS : MAX_PAGOS)) throw new HttpError(400, 'Esta juntada llegó al máximo de registros.');
    let doc, texto;
    if (kind === 'gastos') {
      doc = validar(L.limpiarGasto(b.data, j));
      texto = quienDe(b) + (row ? ' editó ' : ' agregó ') + doc.desc + ' (' + money(doc.total) + ')';
    } else {
      doc = validar(L.limpiarPago(b.data, j));
      const nm = pid => (j.personas.find(p => p.id === pid) || {}).nombre || 'Alguien';
      texto = quienDe(b) + ' registró que ' + nm(doc.de) + ' le pasó ' + money(doc.c) + ' a ' + nm(doc.a);
    }
    if (!(await store.guardarItem(db, token, kind, id, doc, row ? row.version : null, texto))) throw conflicto(nombre);
    return json(await store.snapshot(db, token), row ? 200 : 201);
  }],
  ['DELETE', `/api/j/(${RE_TOKEN})/(gastos|pagos)/(${RE_ID})`, async (req, m, env) => {
    const db = env.DB, [, token, kind, id] = m;
    const { j } = await viva(db, token);
    const b = await leerJson(req);
    const row = await store.getItem(db, token, kind, id);
    if (row && !row.deleted_at) {
      const d = JSON.parse(row.data);
      await store.borrarItem(db, token, kind, id, kind === 'gastos' ? quienDe(b) + ' borró ' + d.desc : quienDe(b) + ' deshizo un pago de ' + L.fmt(d.c, j.moneda));
    }
    return json(await store.snapshot(db, token));
  }],
  ['POST', `/api/j/(${RE_TOKEN})/gastos/(${RE_ID})/restaurar`, async (req, m, env) => {
    const db = env.DB, [, token, id] = m;
    const { j } = await viva(db, token);
    const b = await leerJson(req);
    const row = await store.getItem(db, token, 'gastos', id);
    if (!row) throw new HttpError(404, 'Ese gasto ya no se puede recuperar.');
    if (row.deleted_at) {
      const res = L.limpiarGasto(JSON.parse(row.data), j);
      if (res.error) throw new HttpError(409, 'No se puede recuperar: incluye a alguien que ya no está en la juntada.');
      await store.restaurarItem(db, token, 'gastos', id, quienDe(b) + ' recuperó ' + res.doc.desc);
    }
    return json(await store.snapshot(db, token));
  }],
].map(([met, patron, fn]) => ({ met, re: new RegExp('^' + patron + '$'), fn }));

async function paginaApp(req, env, token) {
  const base = await env.ASSETS.fetch(new Request(new URL('/', req.url)));
  let html = await base.text();
  if (token) {
    const row = await store.getRow(env.DB, token);
    if (row && !row.deleted_at) {
      const nombre = escHtml(JSON.parse(row.data).nombre);
      html = html.replace('<title>Vaquita</title>', '<title>' + nombre + ' · Vaquita</title>')
        .replace('property="og:title" content="Vaquita"', 'property="og:title" content="' + nombre + ' · Vaquita"');
    }
  }
  return new Response(req.method === 'HEAD' ? null : html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...SEGURIDAD } });
}

/* Sólo la primera vez, cuando la base está vacía, crea las tablas */
const basesListas = new WeakSet();
async function prepararBase(db) {
  if (basesListas.has(db)) return;
  try {
    await db.prepare('SELECT 1 FROM actividad LIMIT 1').first();
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message))) throw e;
    await db.batch(ESQUEMA.map(sql => db.prepare(sql)));
  }
  basesListas.add(db);
}

async function manejar(req, env) {
  const p = new URL(req.url).pathname;
  if (p.startsWith('/api/') || p.startsWith('/j/')) await prepararBase(env.DB);
  if (p.startsWith('/api/')) {
    for (const r of rutas) {
      if (r.met !== req.method) continue;
      const m = r.re.exec(p);
      if (!m) continue;
      limitar(req, env, r.met === 'GET' ? 'leer' : 'escribir', 60000);
      return await r.fn(req, m, env);
    }
    throw new HttpError(404, 'Esa dirección no existe.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
  if (p === '/ejemplo') return paginaApp(req, env, null);
  const mj = new RegExp('^/j/(' + RE_TOKEN + ')/?$').exec(p);
  if (mj) return paginaApp(req, env, mj[1]);
  return env.ASSETS.fetch(req);
}

export default {
  async fetch(req, env) {
    try {
      return await manejar(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error('Error inesperado:', e);
      const limite = /limit|exceeded|quota/i.test(String(e && e.message));
      return json({ error: limite
        ? 'La app llegó al límite gratuito de hoy. Vuelve a funcionar a las 21:00 de Argentina y no se perdió nada.'
        : 'Algo falló en el servidor. Probá de nuevo.' }, limite ? 503 : 500);
    }
  },
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(prepararBase(env.DB).then(() => store.purgar(env.DB)));
  },
};
