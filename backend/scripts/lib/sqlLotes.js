/**
 * Utilidades compartidas por los scripts que aplican archivos .sql
 * (setupDb.js y migrarDb.js).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/** Carpeta `database/` del proyecto. */
export const DIR_SQL = path.resolve(aqui, '..', '..', '..', 'database');

/**
 * Parte un script en lotes por la palabra GO.
 *
 * GO no es SQL: es el separador de lotes que entienden sqlcmd y SSMS, pero el
 * driver no lo reconoce. Hay que mandar cada lote por separado — y además es
 * obligatorio, porque instrucciones como CREATE VIEW deben ir solas en su lote.
 */
export function partirEnLotes(sql) {
  return sql
    .split(/^\s*GO\s*$/gim)
    .map((lote) => lote.trim())
    .filter((lote) => lote.length > 0);
}

/**
 * Aplica un archivo .sql lote por lote.
 *
 * Si un lote falla, reporta cuál fue y muestra su SQL: sin eso, el error de
 * SQL Server llega sin contexto y no hay forma de saber qué instrucción tronó.
 *
 * @param {object}  pool            Pool de mssql ya conectado.
 * @param {string}  archivo         Nombre del archivo dentro de `database/`.
 * @param {boolean} [mostrarPrint]  Imprime los mensajes PRINT del script.
 */
export async function aplicarArchivo(pool, archivo, mostrarPrint = false) {
  const contenido = await fs.readFile(path.join(DIR_SQL, archivo), 'utf8');
  const lotes = partirEnLotes(contenido);

  if (mostrarPrint) {
    console.log(`  → ${archivo} (${lotes.length} lotes)`);
  } else {
    process.stdout.write(`  → ${archivo} (${lotes.length} lotes) ... `);
  }

  for (const [i, lote] of lotes.entries()) {
    const peticion = pool.request();
    // Los PRINT del script llegan como eventos 'info', no como resultados.
    if (mostrarPrint) peticion.on('info', (m) => console.log(`    ${m.message}`));

    try {
      await peticion.batch(lote);
    } catch (error) {
      console.log(mostrarPrint ? '' : 'FALLÓ');
      console.error(`\nError en el lote ${i + 1} de ${archivo}:`);
      console.error(`  ${error.message}\n`);
      console.error('SQL del lote:');
      console.error(lote.split('\n').slice(0, 25).join('\n'));
      throw error;
    }
  }

  if (!mostrarPrint) console.log('OK');
}

/**
 * Lista los archivos de migración de `database/`, en orden alfabético
 * (que es el orden en que deben aplicarse: 03_, 04_, 05_...).
 */
export async function listarMigraciones() {
  const archivos = await fs.readdir(DIR_SQL);
  return archivos
    .filter((n) => /^\d+_migracion_.+\.sql$/i.test(n))
    .sort();
}
