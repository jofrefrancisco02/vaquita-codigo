'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

test('entiende los montos como se escriben en Argentina', () => {
  const casos = { '1.234,56': 123456, '1234.5': 123450, '1234,5': 123450, '12.345': 1234500, '1,234.56': 123456, '0,5': 50, '$ 48.000': 4800000 };
  Object.entries(casos).forEach(([k, v]) => assert.strictEqual(L.parseMoney(k), v, k));
  assert.strictEqual(L.parseMoney(''), null);
  assert.strictEqual(L.parseMoney('abc'), null);
});

test('un reparto nunca pierde ni inventa centavos', () => {
  const r = L.allocate(10000, { a: 1, b: 1, c: 1 });
  assert.strictEqual(r.a + r.b + r.c, 10000);
});

test('prorratea la propina según lo consumido', () => {
  const d = L.division({ modo: 'items', total: 1650000, propina: 150000, descuento: 0, items: [
    { precio: 900000, consumen: { a: 1, b: 1, c: 1 } },
    { precio: 600000, consumen: { a: 2, b: 1 } },
  ] });
  assert.deepStrictEqual(d, { a: 770000, b: 550000, c: 330000 });
});

test('con cualquier combinación, los saldos cierran en cero y las transferencias los saldan', () => {
  for (let n = 0; n < 400; n++) {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].slice(0, 2 + n % 6);
    const personas = ids.map(id => ({ id, nombre: id }));
    const gastos = [];
    for (let k = 0; k < 5; k++) {
      const total = 1 + Math.floor(Math.random() * 9999999);
      const p = ids[Math.floor(Math.random() * ids.length)];
      const w = Object.fromEntries(ids.map(i => [i, 1 + Math.floor(Math.random() * 7)]));
      const modo = ['iguales', 'partes', 'porcentajes'][k % 3];
      const g = { modo, total, pagadores: [{ p, c: total }], participantes: ids, valores: w };
      assert.strictEqual(Object.values(L.division(g)).reduce((x, y) => x + y, 0), total);
      gastos.push(g);
    }
    const c = L.compute({ personas }, gastos, []);
    assert.strictEqual(Object.values(c.rows).reduce((x, r) => x + r.saldo, 0), 0);
    assert.ok(c.transfers.length <= ids.length - 1);
    const fin = L.compute({ personas }, gastos, c.transfers);
    assert.strictEqual(fin.transfers.length, 0);
  }
});
