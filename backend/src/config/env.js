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

  // Base de datos propia del sistema (PostgreSQL).
  //
  // Railway —y casi cualquier hospedaje— entrega una sola cadena de conexión
  // en DATABASE_URL. Si está, manda sobre los valores sueltos: así el mismo
  // código corre en internet y en una computadora local sin cambiar nada.
  db: {
    url: (process.env.DATABASE_URL || '').trim(),
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 5432),
    database: process.env.DB_DATABASE || 'sgc_compras',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    // Cifrado de la conexión.
    //
    // No basta con "si hay DATABASE_URL, entonces TLS": la red privada de
    // Railway (los hosts *.railway.internal) NO habla TLS, y pedírselo hace
    // que la conexión falle. Los hosts públicos sí lo exigen. Se decide
    // mirando a dónde apunta la cadena, y DB_SSL manda si está definida.
    ssl: (() => {
      if (process.env.DB_SSL !== undefined) return bool(process.env.DB_SSL, false);
      const url = process.env.DATABASE_URL || '';
      if (!url) return false;
      return !/\.railway\.internal/i.test(url);
    })(),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'llave-insegura-solo-desarrollo',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  // ── Existencias de Quiter, por la API interna de refacciones ──────────────
  erp: {
    baseUrl: (process.env.QUITER_BASE_URL || '').trim(),
    apiKey: (process.env.QUITER_API_KEY || '').trim(),
    timeoutMs: num(process.env.QUITER_TIMEOUT_MS, 5000),
    almacenDefault: process.env.ERP_ALMACEN_DEFAULT || process.env.QUITER_ALMACEN_DEFAULT || '101',
    cacheTtlSeg: num(process.env.ERP_CACHE_TTL_SEG, 30),
  },

};

// Aviso temprano: en producción la llave JWT no puede quedarse por defecto.
if (env.nodeEnv === 'production' && env.jwt.secret.startsWith('llave-insegura')) {
  console.warn('[ADVERTENCIA] JWT_SECRET no está configurado. Defínelo antes de salir a producción.');
}
