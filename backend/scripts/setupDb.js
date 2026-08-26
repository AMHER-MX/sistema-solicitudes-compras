/**
 * Instala el esquema DESDE CERO y carga los datos de prueba en SQL Server.
 *
 *   cd backend && npm run db:setup
 *
 * ⚠  OJO: 01_schema.sql empieza tirando las tablas (DROP TABLE). Esto BORRA
 *    todas las solicitudes capturadas. Es para instalar una base nueva.
 *    Si la base ya está en uso y solo quieres agregar lo nuevo, usa:
 *        npm run db:migrar
 *
 * Requiere que la base indicada en DB_DATABASE ya exista. Para crearla:
 *   sqlcmd -S localhost -U sa -P tuPassword -Q "CREATE DATABASE SGC_COMPRAS"
 * o desde SQL Server Management Studio: clic derecho en Databases -> New Database.
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

  const [conteos] = (await pool.request().query(`
    SELECT (SELECT COUNT(*) FROM dbo.usuarios)             AS usuarios,
           (SELECT COUNT(*) FROM dbo.sucursales)           AS sucursales,
           (SELECT COUNT(*) FROM dbo.clientes)             AS clientes,
           (SELECT COUNT(*) FROM dbo.solicitudes_compras)  AS solicitudes,
           (SELECT COUNT(*) FROM dbo.solicitudes_detalle)  AS partidas,
           (SELECT COUNT(*) FROM dbo.solicitud_historial)  AS historial
  `)).recordset;

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
