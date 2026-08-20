/**
 * Pool de conexiones a PostgreSQL (driver `pg`).
 *
 * Exporta:
 *  - query(sql, params)      -> ejecuta una consulta suelta
 *  - withTransaction(fn)     -> ejecuta fn(client) dentro de BEGIN/COMMIT/ROLLBACK
 *  - pool                    -> por si se necesita acceso directo
 */
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  ssl: env.db.ssl,
  max: 10,                      // conexiones simultáneas
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en el pool:', err.message);
});

/** Ejecuta una consulta y devuelve el result de pg. */
export const query = (sql, params = []) => pool.query(sql, params);

/**
 * Envuelve varias consultas en una sola transacción.
 * Si el callback lanza error se hace ROLLBACK automáticamente.
 *
 * @example
 *   const solicitud = await withTransaction(async (client) => { ... });
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release(); // siempre devolver la conexión al pool
  }
}

/** Verificación de salud usada por /api/health y al arrancar el servidor. */
export async function probarConexion() {
  const { rows } = await pool.query('SELECT NOW() AS ahora');
  return rows[0].ahora;
}
