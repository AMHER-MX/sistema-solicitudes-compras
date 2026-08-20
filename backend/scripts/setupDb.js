/**
 * Crea el esquema y carga los datos semilla.
 *
 *   cd backend && npm run db:setup
 *
 * Requiere que la base de datos indicada en PGDATABASE ya exista:
 *   createdb sgc_compras     (o)     CREATE DATABASE sgc_compras;
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const dirSql = path.resolve(aquí, '..', '..', 'database');

const ARCHIVOS = ['01_schema.sql', '02_seed.sql'];

async function main() {
  console.log(`Aplicando scripts SQL sobre ${env.db.database}@${env.db.host}:${env.db.port}\n`);

  for (const archivo of ARCHIVOS) {
    const ruta = path.join(dirSql, archivo);
    const sql = await fs.readFile(ruta, 'utf8');
    process.stdout.write(`  → ${archivo} ... `);
    await pool.query(sql);
    console.log('OK');
  }

  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM usuarios)::int            AS usuarios,
            (SELECT COUNT(*) FROM sucursales)::int          AS sucursales,
            (SELECT COUNT(*) FROM clientes)::int            AS clientes,
            (SELECT COUNT(*) FROM solicitudes_compras)::int  AS solicitudes,
            (SELECT COUNT(*) FROM solicitudes_detalle)::int  AS partidas,
            (SELECT COUNT(*) FROM solicitud_historial)::int  AS historial`,
  );

  console.log('\nRegistros cargados:', rows[0]);
  console.log('\nUsuarios de prueba (password: demo1234)');
  console.log('  vendedor@demo.mx   -> Vendedor');
  console.log('  comprador@demo.mx  -> Comprador');
  console.log('  gerente@demo.mx    -> Gerente');
  await pool.end();
}

main().catch(async (e) => {
  console.error('\nFalló el setup:', e.message);
  await pool.end();
  process.exit(1);
});
