/* Acceso a la base D1. Cada función usa pocas consultas: el plan gratuito limita filas leídas y escritas por día. */
const DIA = 86400000;
export const RETENCION_BORRADOS = 30 * DIA;

const toItem = (row, token) => ({ ...JSON.parse(row.data), id: row.id, juntadaId: token, _v: row.version });
const orden = (a, b) => (a.creado || 0) - (b.creado || 0);
const logStmt = (db, token, texto, at) => db.prepare('INSERT INTO actividad (token, texto, at) VALUES (?, ?, ?)').bind(token, texto, at);
const bumpStmt = (db, token, at) => db.prepare('UPDATE juntadas SET rev = rev + 1, updated_at = ? WHERE token = ?').bind(at, token);

export const getRow = (db, token) => db.prepare('SELECT * FROM juntadas WHERE token = ?').bind(token).first();
export const getRev = (db, token) => db.prepare('SELECT rev, deleted_at FROM juntadas WHERE token = ?').bind(token).first();

export async function snapshot(db, token) {
  const [j, items, borrados, actividad] = await db.batch([
    db.prepare('SELECT * FROM juntadas WHERE token = ?').bind(token),
    db.prepare('SELECT * FROM items WHERE token = ? AND deleted_at IS NULL').bind(token),
    db.prepare("SELECT id, data, deleted_at FROM items WHERE token = ? AND kind = 'gastos' AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50").bind(token),
    db.prepare('SELECT texto, at FROM actividad WHERE token = ? ORDER BY id DESC LIMIT 60').bind(token),
  ]);
  const row = j.results[0];
  if (!row) return null;
  return {
    token,
    rev: row.rev,
    juntada: { ...JSON.parse(row.data), id: token, _v: row.version },
    gastos: items.results.filter(r => r.kind === 'gastos').map(r => toItem(r, token)).sort(orden),
    pagos: items.results.filter(r => r.kind === 'pagos').map(r => toItem(r, token)).sort(orden),
    borrados: borrados.results.map(r => ({ id: r.id, desc: JSON.parse(r.data).desc, at: r.deleted_at })),
    actividad: actividad.results,
  };
}

/* La portada carga varias juntadas de una vez, sin historial, en una sola tanda de consultas */
export async function snapshots(db, tokens) {
  if (!tokens.length) return [];
  const marcas = tokens.map(() => '?').join(',');
  const [js, items] = await db.batch([
    db.prepare(`SELECT * FROM juntadas WHERE token IN (${marcas}) AND deleted_at IS NULL`).bind(...tokens),
    db.prepare(`SELECT * FROM items WHERE token IN (${marcas}) AND deleted_at IS NULL`).bind(...tokens),
  ]);
  return js.results.map(row => {
    const propios = items.results.filter(r => r.token === row.token);
    return {
      token: row.token,
      rev: row.rev,
      juntada: { ...JSON.parse(row.data), id: row.token, _v: row.version },
      gastos: propios.filter(r => r.kind === 'gastos').map(r => toItem(r, row.token)).sort(orden),
      pagos: propios.filter(r => r.kind === 'pagos').map(r => toItem(r, row.token)).sort(orden),
    };
  });
}

export async function crearJuntada(db, token, doc, texto) {
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO juntadas (token, data, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(token, JSON.stringify(doc), now, now),
    logStmt(db, token, texto, now),
  ]);
}

/* Devuelve false si alguien cambió la juntada entre la lectura y esta escritura */
export async function actualizarJuntada(db, token, doc, version, texto) {
  const now = Date.now();
  const r = await db.prepare('UPDATE juntadas SET data = ?, version = version + 1, rev = rev + 1, updated_at = ? WHERE token = ? AND version = ?').bind(JSON.stringify(doc), now, token, version).run();
  if (!r.meta.changes) return false;
  await logStmt(db, token, texto, now).run();
  return true;
}
export async function marcarJuntada(db, token, borrada, texto) {
  const now = Date.now();
  await db.batch([
    db.prepare('UPDATE juntadas SET deleted_at = ?, rev = rev + 1, updated_at = ? WHERE token = ?').bind(borrada ? now : null, now, token),
    logStmt(db, token, texto, now),
  ]);
}

export const getItem = (db, token, kind, id) => db.prepare('SELECT * FROM items WHERE token = ? AND kind = ? AND id = ?').bind(token, kind, id).first();
export const contar = async (db, token, kind) => (await db.prepare('SELECT COUNT(*) AS n FROM items WHERE token = ? AND kind = ? AND deleted_at IS NULL').bind(token, kind).first()).n;
export const itemsVivos = async (db, token, kind) => (await db.prepare('SELECT * FROM items WHERE token = ? AND kind = ? AND deleted_at IS NULL').bind(token, kind).all()).results.map(r => toItem(r, token));

/* Con version: sólo actualiza si nadie lo cambió antes. Sin version: sólo crea si no existía. */
export async function guardarItem(db, token, kind, id, doc, version, texto) {
  const now = Date.now();
  const json = JSON.stringify(doc);
  const r = version
    ? await db.prepare('UPDATE items SET data = ?, version = version + 1 WHERE token = ? AND kind = ? AND id = ? AND version = ? AND deleted_at IS NULL').bind(json, token, kind, id, version).run()
    : await db.prepare('INSERT OR IGNORE INTO items (token, kind, id, data) VALUES (?, ?, ?, ?)').bind(token, kind, id, json).run();
  if (!r.meta.changes) return false;
  await db.batch([bumpStmt(db, token, now), logStmt(db, token, texto, now)]);
  return true;
}
export async function borrarItem(db, token, kind, id, texto) {
  const now = Date.now();
  const del = kind === 'gastos'
    ? db.prepare('UPDATE items SET deleted_at = ? WHERE token = ? AND kind = ? AND id = ?').bind(now, token, kind, id)
    : db.prepare('DELETE FROM items WHERE token = ? AND kind = ? AND id = ?').bind(token, kind, id);
  await db.batch([del, bumpStmt(db, token, now), logStmt(db, token, texto, now)]);
}
export async function restaurarItem(db, token, kind, id, texto) {
  const now = Date.now();
  await db.batch([
    db.prepare('UPDATE items SET deleted_at = NULL, version = version + 1 WHERE token = ? AND kind = ? AND id = ?').bind(token, kind, id),
    bumpStmt(db, token, now),
    logStmt(db, token, texto, now),
  ]);
}

/* Elimina de verdad lo que lleva más de 30 días en la papelera */
export async function purgar(db, now = Date.now()) {
  const limite = now - RETENCION_BORRADOS;
  const viejas = 'SELECT token FROM juntadas WHERE deleted_at IS NOT NULL AND deleted_at < ?';
  await db.batch([
    db.prepare('DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(limite),
    db.prepare(`DELETE FROM items WHERE token IN (${viejas})`).bind(limite),
    db.prepare(`DELETE FROM actividad WHERE token IN (${viejas})`).bind(limite),
    db.prepare('DELETE FROM juntadas WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(limite),
  ]);
}
