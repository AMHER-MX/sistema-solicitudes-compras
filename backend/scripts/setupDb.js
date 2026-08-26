/**
 * Instala el esquema DESDE CERO y carga los datos de prueba en PostgreSQL.
 *
 *   cd backend && npm run db:setup
 *
 * ⚠  OJO: 01_schema.sql empieza tirando las tablas (DROP TABLE). Esto BORRA
 *    todas las solicitudes capturadas. Es para instalar una base nueva.
 *    Si la base ya está en uso y solo quieres agregar lo nuevo, usa:
 *        npm run db:migrar
 *
 * Requiere que la base ya exista. En Railway la crea el propio servicio de
 * PostgreSQL; en una computadora local:
 *   createdb sgc_compras
 */
import { cerrarPool, obtenerPool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { aplicarArchivo, listarMigraciones } from './lib/sqlLotes.js';

async function main() {
  console.log(`Aplicando scripts SQL sobre ${env.db.database} en ${env.db.host}:${env.db.port}\n`);

  const pool = await obtenerPool();

  // Las migraciones también se aplican aquí. En una base recién creada no
  // hacen nada (01_schema.sql ya trae todo), pero así una instalación nueva
  // y una migrada quedan idénticas, sin depender de que nadie se acuerde.
  const archivos = ['01_schema.sql', '02_seed.sql', ...(await listarMigraciones())];

  for (const archivo of archivos) {
    await aplicarArchivo(pool, archivo);
  }

  const [conteos] = (await pool.query(`
    SELECT (SELECT COUNT(*) FROM usuarios)             AS usuarios,
           (SELECT COUNT(*) FROM sucursales)           AS sucursales,
           (SELECT COUNT(*) FROM clientes)             AS clientes,
           (SELECT COUNT(*) FROM solicitudes_compras)  AS solicitudes,
           (SELECT COUNT(*) FROM solicitudes_detalle)  AS partidas,
           (SELECT COUNT(*) FROM solicitud_historial)  AS historial
  `)).rows;

  console.log('\nRegistros cargados:', conteos);
  console.log('\nUsuarios de prueba (password: demo1234)');
  console.log('  vendedor@demo.mx   -> Vendedor');
  console.log('  comprador@demo.mx  -> Comprador');
  console.log('  gerente@demo.mx    -> Gerente');
  console.log('\n⚠  Estas cuentas son de prueba. Antes de producción, crea las');
  console.log('   cuentas reales desde la pantalla Usuarios y desactiva estas.');

  await cerrarPool();
}

main().catch(async (e) => {
  console.error('\nFalló el setup:', e.message);
  await cerrarPool();
  process.exit(1);
});
