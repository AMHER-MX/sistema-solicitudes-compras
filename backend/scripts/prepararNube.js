/**
 * Pone la base al día antes de que el servidor empiece a atender.
 *
 * Corre en cada arranque en el hospedaje (Railway), y decide solo:
 *
 *   base vacía        -> instala el esquema y los datos de arranque
 *   base con datos    -> aplica únicamente las migraciones pendientes
 *   base inalcanzable -> se detiene con un mensaje claro, sin arrancar
 *
 * Por qué así: en un hospedaje nadie va a abrir una terminal para correr
 * `db:setup` a mano. Y lo que NO puede pasar es que un despliegue rutinario
 * borre las solicitudes capturadas, así que la decisión no se toma por
 * configuración ni por costumbre: se toma mirando lo que hay en la base.
 *
 * Es seguro que corra en cada despliegue. Sobre una base al día no hace nada.
 */
import { cerrarPool, obtenerPool, query } from '../src/config/db.js';
import { aplicarArchivo, listarMigraciones } from './lib/sqlLotes.js';

async function main() {
  console.log('[nube] Revisando la base antes de arrancar...');

  const pool = await obtenerPool();

  const [tabla] = await query("SELECT to_regclass('public.usuarios') AS existe");
  const hayEsquema = tabla.existe !== null;

  if (!hayEsquema) {
    console.log('[nube] Base vacía: instalando el esquema y los datos de arranque.');
    await aplicarArchivo(pool, '01_schema.sql');
    await aplicarArchivo(pool, '02_seed.sql');
  } else {
    const [conteos] = await query(`
      SELECT (SELECT COUNT(*) FROM usuarios) AS usuarios,
             (SELECT COUNT(*) FROM solicitudes_compras) AS solicitudes
    `);
    console.log(`[nube] Base existente: ${conteos.usuarios} usuario(s), `
              + `${conteos.solicitudes} solicitud(es). No se toca nada de eso.`);
  }

  // Las migraciones se aplican siempre: son idempotentes y en una base recién
  // instalada no hacen nada, porque el esquema ya las incluye.
  for (const archivo of await listarMigraciones()) {
    await aplicarArchivo(pool, archivo);
  }

  const [demo] = await query(
    "SELECT COUNT(*) AS n FROM usuarios WHERE activo AND email LIKE '%@demo.mx'",
  );
  if (Number(demo.n) > 0) {
    console.warn(`[nube] ⚠  Hay ${demo.n} cuenta(s) de prueba @demo.mx activas.`);
    console.warn('[nube]    Su contraseña está en el README. Entra a Usuarios,');
    console.warn('[nube]    crea tu cuenta real de Gerente y desactívalas.');
  }

  console.log('[nube] Base lista.');
}

main()
  .then(() => cerrarPool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('\n[nube] No se pudo preparar la base:', error.message);
    console.error('[nube] Revisa que la variable DATABASE_URL apunte al PostgreSQL del proyecto.');
    await cerrarPool().catch(() => {});
    // Salir con error evita que el servidor arranque contra una base rota:
    // más vale que el despliegue falle a que la gente entre y no funcione.
    process.exit(1);
  });
