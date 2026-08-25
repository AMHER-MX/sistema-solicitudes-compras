/**
 * Crea el esquema y carga los datos de prueba en SQL Server.
 *
 *   cd backend && npm run db:setup
 *
 * Requiere que la base indicada en DB_DATABASE ya exista. Para crearla:
 *   sqlcmd -S localhost -U sa -P tuPassword -Q "CREATE DATABASE SGC_COMPRAS"
 * o desde SQL Server Management Studio: clic derecho en Databases -> New Database.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cerrarPool, obtenerPool } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const dirSql = path.resolve(aqui, '..', '..', 'database');

const ARCHIVOS = ['01_schema.sql', '02_seed.sql'];

/**
 * Parte un script en lotes por la palabra GO.
 *
 * GO no es SQL: es el separador de lotes que entienden sqlcmd y SSMS, pero el
 * driver no lo reconoce. Hay que mandar cada lote por separado — y además es
 * obligatorio, porque instrucciones como CREATE VIEW deben ir solas en su lote.
 */
function partirEnLotes(sql) {
  return sql
    .split(/^\s*GO\s*$/gim)
    .map((lote) => lote.trim())
    .filter((lote) => lote.length > 0);
}

async function main() {
  console.log(`Aplicando scripts SQL sobre ${env.db.database} en ${env.db.host}:${env.db.port}\n`);

  const pool = await obtenerPool();

  for (const archivo of ARCHIVOS) {
    const ruta = path.join(dirSql, archivo);
    const contenido = await fs.readFile(ruta, 'utf8');
    const lotes = partirEnLotes(contenido);

    process.stdout.write(`  → ${archivo} (${lotes.length} lotes) ... `);

    for (const [i, lote] of lotes.entries()) {
      try {
        await pool.request().batch(lote);
      } catch (error) {
        console.log('FALLÓ');
        console.error(`\nError en el lote ${i + 1} de ${archivo}:`);
        console.error(`  ${error.message}\n`);
        console.error('SQL del lote:');
        console.error(lote.split('\n').slice(0, 25).join('\n'));
        throw error;
      }
    }
    console.log('OK');
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

  await cerrarPool();
}

main().catch(async (e) => {
  console.error('\nFalló el setup:', e.message);
  await cerrarPool();
  process.exit(1);
});
