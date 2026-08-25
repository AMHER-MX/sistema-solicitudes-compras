/**
 * Punto de entrada del backend.
 *   npm run dev    -> con recarga automática
 *   npm start      -> producción
 */
import { crearApp } from './app.js';
import { env } from './config/env.js';
import { pool, probarConexion } from './config/db.js';
import { estadoErp } from './services/erp/index.js';
import { cerrarPoolSqlServer } from './services/erp/sqlServerClient.js';

const app = crearApp();

const servidor = app.listen(env.port, async () => {
  console.log('──────────────────────────────────────────────');
  console.log(` SGC Compras API escuchando en :${env.port}`);
  console.log(` Entorno    : ${env.nodeEnv}`);
  console.log(` CORS       : ${env.corsOrigin.join(', ')}`);

  const erp = await estadoErp();
  const descripcionErp = {
    SQLSERVER: () => `SQL Server ${erp.sql_server.host}/${erp.sql_server.base_datos}` +
                     ` — almacenes ${erp.sql_server.almacenes.join(', ')}` +
                     ` — ${erp.sql_server.conectado ? 'conectado' : `SIN CONEXIÓN (${erp.sql_server.error})`}`,
    QUITER_API: () => `API ${erp.api.base_url}`,
    MOCK: () => 'NO configurado (usando catálogo simulado)',
  }[erp.origen];
  console.log(` ERP        : ${descripcionErp()}`);

  try {
    const hora = await probarConexion();
    console.log(` PostgreSQL : conectado (${hora.toISOString()})`);
  } catch (e) {
    console.error(` PostgreSQL : SIN CONEXIÓN -> ${e.message}`);
    console.error('   Revisa las variables PG* en tu archivo .env');
  }
  console.log('──────────────────────────────────────────────');
});

// Cierre ordenado: deja de aceptar conexiones y libera el pool.
const cerrar = (senal) => async () => {
  console.log(`\n[${senal}] Cerrando servidor...`);
  servidor.close(async () => {
    await Promise.allSettled([pool.end(), cerrarPoolSqlServer()]);
    process.exit(0);
  });
};

process.on('SIGINT', cerrar('SIGINT'));
process.on('SIGTERM', cerrar('SIGTERM'));
