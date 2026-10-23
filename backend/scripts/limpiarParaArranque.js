/**
 * Borra los folios de prueba y deja la numeración en cero, para arrancar en
 * limpio el día que el equipo empieza a usar el sistema de verdad.
 *
 *   cd backend
 *   node scripts/limpiarParaArranque.js            <- solo informa, no borra
 *   node scripts/limpiarParaArranque.js --borrar   <- borra
 *
 * SIN `--borrar` no toca nada. Es a propósito: correr esto por error es la
 * clase de descuido que no se deshace, así que la forma fácil de ejecutarlo
 * —sin argumentos— es también la inofensiva. Primero se mira el reporte, se
 * confirma que los números cuadran, y hasta entonces se repite con `--borrar`.
 *
 * QUÉ BORRA
 *   · solicitudes_compras   (los folios)
 *   · solicitudes_detalle   (sus partidas)
 *   · solicitud_historial   (su bitácora)
 *   · folio_consecutivo     (el contador: vuelve a 000001 por empresa y año)
 *
 * QUÉ NO TOCA, NUNCA
 *   · clientes    <- son los reales de Quiter; volverlos a bajar cuesta
 *   · usuarios    <- las cuentas y sus contraseñas
 *   · sucursales
 *   · empresas
 *
 * Al terminar vuelve a contar esas cuatro tablas y aborta la transacción si
 * alguna cambió. No debería poder pasar —no hay un DELETE que las nombre—,
 * pero la comprobación cuesta un segundo y el error que atraparía cuesta una
 * tarde de volver a capturar usuarios.
 */
import { cerrarPool, obtenerPool, query, withTransaction } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const BORRAR = process.argv.includes('--borrar');

/** Las tablas que sí se vacían, en orden de hija a madre (por las llaves foráneas). */
const A_BORRAR = ['solicitud_historial', 'solicitudes_detalle', 'solicitudes_compras'];

/** Las que tienen que quedar exactamente igual. */
const INTOCABLES = ['clientes', 'usuarios', 'sucursales', 'empresas'];

const contar = async (tablas) => {
  const filas = await Promise.all(tablas.map(async (t) => {
    const [fila] = await query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    return [t, fila.n];
  }));
  return Object.fromEntries(filas);
};

const linea = (etiqueta, valor) => console.log(`  ${etiqueta.padEnd(24)} ${valor}`);

async function main() {
  await obtenerPool();

  const destino = env.db.url ? '(DATABASE_URL)' : `${env.db.host}:${env.db.port}/${env.db.database}`;
  const [donde] = await query('SELECT current_database() AS base, host(inet_server_addr()) AS servidor');

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  ${BORRAR ? 'LIMPIEZA DE ARRANQUE' : 'REPORTE (no se va a borrar nada)'.padEnd(20)}`.padEnd(63) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  linea('Configuración:', destino);
  linea('Base:', `${donde.base}${donde.servidor ? ` en ${donde.servidor}` : ''}`);

  const antesBorrar = await contar(A_BORRAR);
  const antesIntactas = await contar(INTOCABLES);

  console.log('\nSe borraría:');
  for (const [t, n] of Object.entries(antesBorrar)) linea(t, n);

  console.log('\nNo se toca:');
  for (const [t, n] of Object.entries(antesIntactas)) linea(t, n);

  const [folio] = await query('SELECT COUNT(*)::int AS n FROM folio_consecutivo');
  console.log('');
  linea('contador de folios', `${folio.n} renglón(es) -> vuelve a 0`);

  if (!BORRAR) {
    console.log('\n→ Esto fue solo el reporte. Si los números cuadran, repite el');
    console.log('  comando agregando  --borrar  al final.\n');
    return;
  }

  // Un detalle que se agradece después: el último folio de cada empresa queda
  // escrito en la salida, por si alguien pregunta hasta dónde se había llegado.
  const ultimos = await query(`
    SELECT e.clave, MAX(s.folio) AS ultimo
    FROM      solicitudes_compras s
    JOIN      empresas e ON e.id = s.id_empresa
    GROUP BY  e.clave
    ORDER BY  e.clave`);
  if (ultimos.length) {
    console.log('\nÚltimo folio antes de limpiar (para el registro):');
    for (const f of ultimos) linea(f.clave, f.ultimo);
  }

  await withTransaction(async (q) => {
    for (const tabla of A_BORRAR) await q(`DELETE FROM ${tabla}`);
    await q('DELETE FROM folio_consecutivo');

    // Que los ids también empiecen en 1: un folio SC-CATOSA-2026-000001 cuyo
    // id interno es el 847 se ve raro en la barra de direcciones y hace dudar
    // de si de verdad se limpió.
    for (const tabla of A_BORRAR) {
      await q(`ALTER TABLE ${tabla} ALTER COLUMN id RESTART WITH 1`);
    }

    // La comprobación antes de confirmar: si algo tocó lo intocable, aquí se
    // deshace todo. Se consulta DENTRO de la transacción, con la misma
    // conexión; preguntarle al pool devolvería el estado de antes de empezar.
    for (const tabla of INTOCABLES) {
      const [ahora] = await q(`SELECT COUNT(*)::int AS n FROM ${tabla}`);
      if (ahora.n !== antesIntactas[tabla]) {
        throw new Error(
          `ABORTADO: ${tabla} pasó de ${antesIntactas[tabla]} a ${ahora.n} renglones. `
          + 'No se borró nada.',
        );
      }
    }
  });

  const despues = await contar([...A_BORRAR, ...INTOCABLES]);
  console.log('\nListo. Cómo quedó:');
  for (const [t, n] of Object.entries(despues)) {
    linea(t, `${n}${INTOCABLES.includes(t) ? '  (intacta)' : ''}`);
  }
  console.log('\nEl siguiente folio que se levante será SC-<EMPRESA>-'
            + `${new Date().getFullYear()}-000001.\n`);
}

main()
  .catch((error) => {
    console.error(`\n✗ ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => cerrarPool().catch(() => {}));
