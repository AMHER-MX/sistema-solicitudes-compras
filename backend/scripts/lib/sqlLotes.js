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
 * Aplica un archivo .sql completo, de una sola vez.
 *
 * A diferencia de SQL Server —donde había que partir el archivo por la palabra
 * GO— PostgreSQL acepta varias instrucciones en una sola llamada. Y aquí eso
 * no es solo comodidad: los bloques `DO $$ ... $$` llevan punto y coma adentro,
 * así que cualquier intento de partir el archivo por separadores lo rompería a
 * la mitad.
 *
 * @param {object}  pool          Pool de pg ya conectado.
 * @param {string}  archivo       Nombre del archivo dentro de `database/`.
 * @param {boolean} [mostrarAvisos] Imprime los RAISE NOTICE del script.
 */
export async function aplicarArchivo(pool, archivo, mostrarAvisos = false) {
  const contenido = await fs.readFile(path.join(DIR_SQL, archivo), 'utf8');

  process.stdout.write(`  → ${archivo} ... `);

  const cliente = await pool.connect();
  // Los RAISE NOTICE del script llegan como eventos, no como resultados.
  const alAvisar = (aviso) => {
    if (mostrarAvisos && aviso?.message) console.log(`\n    ${aviso.message}`);
  };
  cliente.on('notice', alAvisar);

  try {
    await cliente.query(contenido);
    console.log('OK');
  } catch (error) {
    console.log('FALLÓ');
    console.error(`\nError aplicando ${archivo}:`);
    console.error(`  ${error.message}`);
    // PostgreSQL dice en qué carácter del texto tronó: con eso se puede
    // señalar la línea exacta, que es lo único que ahorra tiempo aquí.
    if (error.position) {
      const hasta = contenido.slice(0, Number(error.position));
      const linea = hasta.split('\n').length;
      console.error(`  en la línea ${linea} de ${archivo}:`);
      console.error(`    ${contenido.split('\n')[linea - 1]?.trim()}`);
    }
    throw error;
  } finally {
    cliente.off('notice', alAvisar);
    cliente.release();
  }
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
