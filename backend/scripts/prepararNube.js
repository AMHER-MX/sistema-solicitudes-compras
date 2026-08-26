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

/**
 * Describe un error de conexión de forma que se pueda actuar sobre él.
 *
 * Cuando Node intenta conectarse a un nombre que resuelve a varias direcciones
 * y todas fallan, junta los fallos en un AggregateError cuyo `.message` está
 * VACÍO. Imprimir solo el mensaje deja al operador con "no se pudo preparar la
 * base:" y nada más — que fue exactamente lo que pasó la primera vez.
 */
function describirError(error) {
  if (Array.isArray(error?.errors) && error.errors.length) {
    return error.errors.map((e) => e.code || e.message || e.name).join(' · ');
  }
  if (error?.code) return `${error.code}${error.message ? `: ${error.message}` : ''}`;
  return error?.message || error?.name || 'error sin descripción';
}

/**
 * Espera a que la base conteste.
 *
 * La red privada del hospedaje tarda un momento en levantar después de que
 * arranca el contenedor. Si la aplicación se conecta en el primer instante, el
 * nombre del servidor todavía no resuelve y el despliegue muere — aunque la
 * base esté perfectamente bien y un segundo después responda.
 */
async function esperarALaBase({ intentos = 15, esperaMs = 2000 } = {}) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      await query('SELECT 1');
      if (i > 1) console.log(`[nube] La base respondió en el intento ${i}.`);
      return;
    } catch (error) {
      const detalle = describirError(error);
      if (i === intentos) {
        throw new Error(`la base no respondió tras ${intentos} intentos (${detalle})`);
      }
      console.log(`[nube] La base aún no responde (${detalle}). `
                + `Reintento ${i}/${intentos - 1} en ${esperaMs / 1000}s...`);
      await new Promise((seguir) => { setTimeout(seguir, esperaMs); });
    }
  }
}

async function main() {
  console.log('[nube] Revisando la base antes de arrancar...');

  const pool = await obtenerPool();
  await esperarALaBase();

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
    console.error('\n[nube] No se pudo preparar la base:', describirError(error));
    console.error('[nube] Revisa que DATABASE_URL apunte al PostgreSQL del proyecto');
    console.error('[nube] y que el servicio de base de datos esté en línea.');
    await cerrarPool().catch(() => {});
    // Salir con error evita que el servidor arranque contra una base rota:
    // más vale que el despliegue falle a que la gente entre y no funcione.
    process.exit(1);
  });
