/* Estructura de la base. La app la crea sola la primera vez que arranca. */
export const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS juntadas ( token TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, rev INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER )`,
  `CREATE TABLE IF NOT EXISTS items ( token TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('gastos', 'pagos')), id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER, PRIMARY KEY (token, kind, id) )`,
  `CREATE TABLE IF NOT EXISTS actividad ( id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, texto TEXT NOT NULL, at INTEGER NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS actividad_token ON actividad (token, id)`,
  `CREATE INDEX IF NOT EXISTS juntadas_borradas ON juntadas (deleted_at) WHERE deleted_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS items_borrados ON items (deleted_at) WHERE deleted_at IS NOT NULL`,
];
