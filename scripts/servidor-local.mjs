/* Corre el Worker real en Node, con una base SQLite que se comporta como D1. No necesita instalar nada. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  _esLectura() { return /^\s*SELECT/i.test(this.sql); }
  _ejecutar() {
    const s = this.db.prepare(this.sql);
    if (this._esLectura()) return { results: s.all(...this.args).map(r => ({ ...r })), success: true, meta: { changes: 0 } };
    const r = s.run(...this.args);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  async first() { return this._ejecutar().results[0] ?? null; }
  async all() { return this._ejecutar(); }
  async run() { return this._ejecutar(); }
}
export function crearD1(archivo) {
  const db = new DatabaseSync(archivo);
  const hay = db.prepare("SELECT name FROM sqlite_master WHERE name = 'juntadas'").get();
  if (!hay) db.exec(fs.readFileSync(path.join(RAIZ, 'migrations', '0001_inicial.sql'), 'utf8'));
  return {
    cerrar: () => db.close(),
    prepare: sql => new Stmt(db, sql),
    batch: async stmts => {
      db.exec('BEGIN');
      try { const out = stmts.map(s => s._ejecutar()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
const ASSETS = {
  async fetch(req) {
    const u = new URL(typeof req === 'string' ? req : req.url);
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const full = path.join(RAIZ, 'public', path.normalize(rel));
    if (rel === '_headers' || !full.startsWith(path.join(RAIZ, 'public')) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return new Response('No encontrado', { status: 404 });
    return new Response(fs.readFileSync(full), { headers: { 'Content-Type': TIPOS[path.extname(full)] || 'application/octet-stream' } });
  },
};
export function iniciar({ archivo, puerto = 0, limites } = {}) {
  const DB = crearD1(archivo || ':memory:');
  const env = { DB, ASSETS, LIMITES: limites };
  const server = http.createServer(async (req, res) => {
    const partes = [];
    for await (const c of req) partes.push(c);
    const body = partes.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(partes) : undefined;
    const r = await worker.fetch(new Request('http://' + req.headers.host + req.url, { method: req.method, headers: req.headers, body }), env, { waitUntil() {} });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  return new Promise(ok => server.listen(puerto, '127.0.0.1', () => ok({
    env,
    base: 'http://127.0.0.1:' + server.address().port,
    cerrar: () => new Promise(fin => { server.closeAllConnections(); server.close(() => { DB.cerrar(); fin(); }); }),
  })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.join(RAIZ, 'data'), { recursive: true });
  const puerto = Number(process.env.PORT) || 3000;
  await iniciar({ archivo: process.env.DB_FILE || path.join(RAIZ, 'data', 'local.db'), puerto });
  console.log('Vaquita escuchando en http://localhost:' + puerto);
}
