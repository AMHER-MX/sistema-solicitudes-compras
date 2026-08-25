/**
 * Carga y valida la configuración desde variables de entorno.
 * Un solo lugar donde leer process.env en toda la aplicación.
 */
import dotenv from 'dotenv';

dotenv.config();

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'si', 'sí'].includes(String(v).toLowerCase());

const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    host: process.env.PGHOST || 'localhost',
    port: num(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE || 'sgc_compras',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    ssl: bool(process.env.PGSSL) ? { rejectUnauthorized: false } : false,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'llave-insegura-solo-desarrollo',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  // ── ERP por API HTTP (opcional) ───────────────────────────────────────────
  erp: {
    baseUrl: (process.env.QUITER_BASE_URL || '').trim(),
    apiKey: (process.env.QUITER_API_KEY || '').trim(),
    timeoutMs: num(process.env.QUITER_TIMEOUT_MS, 5000),
    almacenDefault: process.env.ERP_ALMACEN_DEFAULT || process.env.QUITER_ALMACEN_DEFAULT || '101',
    cacheTtlSeg: num(process.env.ERP_CACHE_TTL_SEG, 30),
  },

  // ── ERP por SQL Server (origen recomendado en producción) ─────────────────
  erpSql: {
    host: (process.env.ERPSQL_HOST || '').trim(),
    port: num(process.env.ERPSQL_PORT, 1433),
    database: (process.env.ERPSQL_DATABASE || '').trim(),
    user: (process.env.ERPSQL_USER || '').trim(),
    password: process.env.ERPSQL_PASSWORD || '',
    encrypt: bool(process.env.ERPSQL_ENCRYPT, true),
    trustServerCertificate: bool(process.env.ERPSQL_TRUST_CERT, true),
    timeoutMs: num(process.env.ERPSQL_TIMEOUT_MS, 15000),
    // Almacenes de refacciones a considerar, separados por coma.
    almacenes: (process.env.ERPSQL_ALMACENES || '101,102,103,104,201,202,203')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

// Aviso temprano: en producción la llave JWT no puede quedarse por defecto.
if (env.nodeEnv === 'production' && env.jwt.secret.startsWith('llave-insegura')) {
  console.warn('[ADVERTENCIA] JWT_SECRET no está configurado. Defínelo antes de salir a producción.');
}
