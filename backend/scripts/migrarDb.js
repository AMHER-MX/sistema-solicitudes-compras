/**
 * Aplica las migraciones sobre una base que YA tiene datos.
 *
 *   cd backend && npm run db:migrar
 *
 * Diferencia con `npm run db:setup`:
 *
 *   db:setup   instala de cero. Empieza tirando las tablas (DROP TABLE), así
 *              que BORRA todo lo capturado. Solo para una base nueva.
 *
 *   db:migrar  solo agrega lo que falta. No borra nada y se puede correr
 *              varias veces sin problema. Esto es lo que se corre en el
 *              servidor cuando ya hay solicitudes capturadas.
 *
 * Cada migración vive en database/NN_migracion_*.sql y se aplica en orden.
 */
import { cerrarPool, obtenerPool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { aplicarArchivo, listarMigraciones } from './lib/sqlLotes.js';

async function main() {
  const migraciones = await listarMigraciones();

  if (migraciones.length === 0) {
    console.log('No hay migraciones pendientes en database/.');
    return;
  }

  console.log(`Aplicando migraciones sobre ${env.db.database} en ${env.db.host}:${env.db.port}\n`);

  const pool = await obtenerPool();

  for (const archivo of migraciones) {
    await aplicarArchivo(pool, archivo, true);
  }

  // Resumen de cómo quedó la tabla de usuarios: es lo que el operador quiere
  // ver para confirmar que no se perdió ninguna cuenta.
  const [resumen] = (await pool.query(`
    SELECT COUNT(*)                                              AS total,
           COUNT(*) FILTER (WHERE activo)                        AS activos,
           COUNT(*) FILTER (WHERE rol = 'Gerente'   AND activo) AS gerentes,
           COUNT(*) FILTER (WHERE rol = 'Comprador' AND activo) AS compradores,
           COUNT(*) FILTER (WHERE rol = 'Vendedor'  AND activo) AS vendedores,
           COUNT(*) FILTER (WHERE debe_cambiar_password)        AS con_password_temporal
    FROM usuarios
  `)).rows;

  console.log('\nUsuarios después de migrar:', resumen);
  console.log('\nListo. Ninguna solicitud fue modificada.');
}

main()
  .then(cerrarPool)
  .catch(async (e) => {
    console.error('\nFalló la migración:', e.message);
    await cerrarPool();
    process.exit(1);
  });
