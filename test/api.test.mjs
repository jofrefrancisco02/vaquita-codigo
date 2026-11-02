import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { iniciar } from '../scripts/servidor-local.mjs';
import * as store from '../worker/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaquita-'));
const archivo = path.join(dir, 't.db');
let app, base;
const arrancar = async () => { app = await iniciar({ archivo, limites: { crear: 1000, escribir: 100000, leer: 100000 } }); base = app.base; };
async function req(method, url, body) {
  const r = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.clone().json(); } catch (e) { /* no es JSON */ }
  return { status: r.status, json, r };
}
const personas = [{ id: 'a1', nombre: 'Ana', alias: 'ana.mp' }, { id: 'b1', nombre: 'Beto', alias: '' }, { id: 'c1', nombre: 'Ceci', alias: '' }];
const juntada = { nombre: 'Cena <b>', fecha: '2026-11-02', lugar: 'Casa', moneda: 'ARS', personas };
const gasto = over => ({ desc: 'Taxi', cat: 'Transporte', modo: 'iguales', total: 90000, pagadores: [{ p: 'a1', c: 90000 }], participantes: ['a1', 'b1', 'c1'], valores: {}, items: [], propina: 0, descuento: 0, ...over });
const crear = async () => (await req('POST', '/api/juntadas', { data: juntada })).json.token;

before(arrancar);
after(async () => { await app.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

test('crea una juntada con un link imposible de adivinar', async () => {
  const r = await req('POST', '/api/juntadas', { data: juntada });
  assert.strictEqual(r.status, 201);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{22}$/);
  assert.strictEqual(r.json.juntada.personas.length, 3);
});

test('rechaza juntadas incompletas', async () => {
  assert.strictEqual((await req('POST', '/api/juntadas', { data: { ...juntada, nombre: ' ' } })).status, 400);
  assert.strictEqual((await req('POST', '/api/juntadas', { data: { ...juntada, personas: [personas[0]] } })).status, 400);
  assert.strictEqual((await req('POST', '/api/juntadas', { data: { ...juntada, moneda: '__proto__' } })).status, 400);
});

test('guarda gastos y deja registro', async () => {
  const t = await crear();
  const r = await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto(), quien: 'Ana' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.gastos.length, 1);
  assert.match(r.json.actividad[0].texto, /^Ana agregó Taxi/);
});

test('no acepta cuentas que no cierran', async () => {
  const t = await crear();
  const malos = [
    gasto({ pagadores: [{ p: 'a1', c: 100 }] }),
    gasto({ pagadores: [{ p: 'zzz', c: 90000 }] }),
    gasto({ participantes: ['zzz'] }),
    gasto({ total: -5, pagadores: [{ p: 'a1', c: -5 }] }),
    gasto({ total: 10.5, pagadores: [{ p: 'a1', c: 10.5 }] }),
    gasto({ modo: 'porcentajes', valores: { a1: 50, b1: 20 } }),
    gasto({ modo: 'montos', valores: { a1: 100 } }),
    gasto({ modo: 'items', items: [{ id: 'i1', nombre: 'x', precio: 500, consumen: { a1: 1 } }] }),
    gasto({ modo: 'eval' }),
    gasto({ desc: '' }),
  ];
  for (const m of malos) assert.strictEqual((await req('PUT', `/api/j/${t}/gastos/g1`, { data: m })).status, 400, JSON.stringify(m));
  assert.strictEqual((await req('GET', `/api/j/${t}`)).json.gastos.length, 0);
});

test('avisa si dos personas editan lo mismo a la vez', async () => {
  const t = await crear();
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  assert.strictEqual((await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto({ desc: 'Primero' }), ifVersion: 1 })).status, 200);
  assert.strictEqual((await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto({ desc: 'Segundo' }), ifVersion: 1 })).status, 409);
  assert.strictEqual((await req('GET', `/api/j/${t}`)).json.gastos[0].desc, 'Primero');
  assert.strictEqual((await req('PUT', `/api/j/${t}`, { data: juntada, ifVersion: 7 })).status, 409);
});

test('la escritura condicional frena una carrera entre dos pedidos', async () => {
  const t = await crear();
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  assert.strictEqual(await store.guardarItem(app.env.DB, t, 'gastos', 'g1', gasto(), 1, 'x'), true);
  assert.strictEqual(await store.guardarItem(app.env.DB, t, 'gastos', 'g1', gasto(), 1, 'y'), false);
  assert.strictEqual(await store.guardarItem(app.env.DB, t, 'gastos', 'g1', gasto(), null, 'z'), false);
});

test('no deja quitar a alguien que figura en un gasto o pago', async () => {
  const t = await crear();
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  assert.strictEqual((await req('PUT', `/api/j/${t}`, { data: { ...juntada, personas: personas.slice(0, 2) } })).status, 409);
});

test('un gasto borrado se puede recuperar', async () => {
  const t = await crear();
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  const d = await req('DELETE', `/api/j/${t}/gastos/g1`, { quien: 'Beto' });
  assert.strictEqual(d.json.gastos.length, 0);
  assert.strictEqual(d.json.borrados[0].desc, 'Taxi');
  const r = await req('POST', `/api/j/${t}/gastos/g1/restaurar`, {});
  assert.strictEqual(r.json.gastos.length, 1);
  assert.strictEqual(r.json.borrados.length, 0);
});

test('una juntada borrada se puede recuperar y lo vencido se elimina', async () => {
  const t = await crear();
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  assert.strictEqual((await req('DELETE', `/api/j/${t}`, {})).status, 200);
  const g = await req('GET', `/api/j/${t}`);
  assert.strictEqual(g.status, 410);
  assert.ok(g.json.nombre);
  assert.strictEqual((await req('POST', `/api/j/${t}/restaurar`, {})).status, 200);
  assert.strictEqual((await req('GET', `/api/j/${t}`)).json.gastos.length, 1);
  await req('DELETE', `/api/j/${t}`, {});
  await store.purgar(app.env.DB, Date.now() + 31 * 86400000);
  assert.strictEqual((await req('GET', `/api/j/${t}`)).status, 404);
  assert.strictEqual((await app.env.DB.prepare('SELECT COUNT(*) n FROM items WHERE token = ?').bind(t).first()).n, 0);
});

test('registra pagos y los deshace', async () => {
  const t = await crear();
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  assert.strictEqual((await req('PUT', `/api/j/${t}/pagos/x1`, { data: { de: 'a1', a: 'a1', c: 100 } })).status, 400);
  const r = await req('PUT', `/api/j/${t}/pagos/x1`, { data: { de: 'b1', a: 'a1', c: 30000 } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.pagos[0].c, 30000);
  assert.strictEqual((await req('DELETE', `/api/j/${t}/pagos/x1`, {})).json.pagos.length, 0);
});

test('la revisión cambia con cada modificación', async () => {
  const t = await crear();
  assert.strictEqual((await req('GET', `/api/j/${t}/rev`)).json.rev, 1);
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  assert.strictEqual((await req('GET', `/api/j/${t}/rev`)).json.rev, 2);
});

test('la portada carga varias juntadas juntas', async () => {
  const a = await crear(), b = await crear();
  await req('PUT', `/api/j/${a}/gastos/g1`, { data: gasto() });
  const r = await req('POST', '/api/batch', { tokens: [a, b, 'AAAAAAAAAAAAAAAAAAAAAA'] });
  assert.strictEqual(r.json.juntadas.length, 2);
  assert.strictEqual(r.json.juntadas.find(s => s.token === a).gastos.length, 1);
  assert.deepStrictEqual(r.json.faltantes, ['AAAAAAAAAAAAAAAAAAAAAA']);
});

test('escapa el nombre en la vista previa del link', async () => {
  const t = await crear();
  const html = await (await fetch(`${base}/j/${t}`)).text();
  assert.ok(html.includes('Cena &lt;b&gt;'));
  assert.ok(!html.includes('Cena <b>'));
});

test('sirve la app y no entrega archivos ajenos', async () => {
  assert.strictEqual((await fetch(base + '/')).status, 200);
  assert.strictEqual((await fetch(base + '/ejemplo')).status, 200);
  for (const p of ['/..%2f..%2fpackage.json', '/worker/index.mjs', '/wrangler.toml']) assert.strictEqual((await fetch(base + p)).status, 404, p);
});

test('rechaza contenido enorme o que no sea JSON', async () => {
  const t = await crear();
  assert.strictEqual((await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto({ desc: 'x'.repeat(300 * 1024) }) })).status, 413);
  assert.strictEqual((await fetch(`${base}/api/juntadas`, { method: 'POST', body: 'hola' })).status, 415);
});

test('frena la creación masiva', async () => {
  const a2 = await iniciar({ limites: { crear: 2 } });
  const post = () => fetch(a2.base + '/api/juntadas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ data: juntada }) });
  assert.strictEqual((await post()).status, 201);
  assert.strictEqual((await post()).status, 201);
  assert.strictEqual((await post()).status, 429);
  await a2.cerrar();
});

test('los datos sobreviven a un reinicio', async () => {
  const t = await crear();
  await req('PUT', `/api/j/${t}/gastos/g1`, { data: gasto() });
  await app.cerrar();
  await arrancar();
  assert.strictEqual((await req('GET', `/api/j/${t}`)).json.gastos.length, 1);
});
