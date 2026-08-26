/**
 * El padrón de clientes.
 *
 * Los clientes son de Quiter, no de este sistema: aquí solo se guarda una copia
 * para poder buscarlos rápido y para que un folio viejo siga sabiendo a quién
 * se le vendió aunque el ERP cambie.
 *
 * POR QUÉ UNA COPIA Y NO CONSULTA EN VIVO
 *   La API devuelve el padrón COMPLETO —no acepta filtro de búsqueda—, así que
 *   buscar en vivo significaría bajar cientos de renglones en cada tecla que
 *   teclea el vendedor. Con la copia local, el buscador responde al instante,
 *   sigue funcionando si el ERP se cae, y la llave foránea de las cotizaciones
 *   apunta siempre a un renglón que existe.
 *
 * QUÉ TAN FRESCA ESTÁ
 *   El vigía la refresca cada hora. Un cliente dado de alta en Quiter esta
 *   mañana aparece aquí a más tardar en una hora.
 */
import { query, withTransaction } from '../config/db.js';
import { clientesDelErp } from './erp/index.js';

/** Cuántos clientes puede devolver el buscador de un jalón. */
const TOPE_BUSQUEDA = 50;

/**
 * Sincroniza el padrón local con el del ERP.
 *
 * Reglas, en orden de importancia:
 *
 *  1. Si el ERP no contesta, NO SE TOCA NADA. `clientesDelErp()` devuelve null
 *     en ese caso —distinto de una lista vacía— justamente para que un ERP
 *     caído no pueda vaciar el padrón. Sin esa distinción, un rato sin red
 *     dejaría a todos los vendedores sin clientes a quién cotizar.
 *
 *  2. Los clientes NO se borran, se desactivan. Uno que ya no está en Quiter
 *     puede seguir firmando cotizaciones del año pasado.
 *
 *  3. Los ficticios del seed se apagan aquí, y solo aquí: en el momento en que
 *     por primera vez entran clientes de verdad. Así una instalación nueva
 *     puede demostrarse con ellos, y una instalación real deja de verlos sin
 *     que nadie tenga que acordarse de apagarlos.
 *
 * @returns {Promise<{ok:boolean, total?:number, nuevos?:number, desactivados?:number, motivo?:string}>}
 */
export async function sincronizarClientes() {
  const delErp = await clientesDelErp();

  if (delErp === null) {
    return { ok: false, motivo: 'sin respuesta del ERP' };
  }
  if (delErp.length === 0) {
    // El ERP contestó, pero con el padrón vacío. Es tan improbable que lo más
    // sano es tratarlo como una respuesta sospechosa y no hacer nada.
    return { ok: false, motivo: 'el ERP devolvió un padrón vacío' };
  }

  return withTransaction(async (ejecutar) => {
    // Qué códigos ya conocíamos, para poder decir cuántos son altas de verdad.
    // Contar renglones antes y después no sirve: en la misma vuelta puede haber
    // altas y bajas, y la resta daría cero aunque hayan entrado clientes nuevos.
    const yaConocidos = new Set(
      (await ejecutar("SELECT codigo_erp FROM clientes WHERE origen = 'QUITER'"))
        .map((f) => f.codigo_erp),
    );

    for (const c of delErp) {
      await ejecutar(
        `INSERT INTO clientes (codigo_erp, nombre, ciudad, estado, origen, activo, sincronizado_en)
              VALUES (@codigo, @nombre, @ciudad::text, @estado::text, 'QUITER', TRUE, NOW())
         ON CONFLICT (codigo_erp) DO UPDATE
            SET nombre          = EXCLUDED.nombre,
                ciudad          = EXCLUDED.ciudad,
                estado          = EXCLUDED.estado,
                origen          = 'QUITER',
                -- Reactivar a propósito: si un cliente volvió a aparecer en
                -- Quiter, es que volvió a ser cliente.
                activo          = TRUE,
                sincronizado_en = NOW()`,
        { codigo: c.codigo, nombre: c.nombre, ciudad: c.ciudad, estado: c.estado },
      );
    }

    // Los que ya no vienen en el padrón: se apagan, no se borran.
    //
    // Se reconocen por la marca de tiempo. Dentro de una transacción, NOW()
    // vale lo mismo de principio a fin, así que todos los renglones que acaban
    // de sincronizarse tienen EXACTAMENTE ese valor y los que no vinieron
    // conservan el de la vuelta anterior. Comparar contra NOW() es exacto y no
    // necesita arrastrar los cientos de códigos en un IN gigante.
    const bajas = await ejecutar(
      `UPDATE clientes
          SET activo = FALSE
        WHERE origen = 'QUITER'
          AND activo
          AND sincronizado_en IS DISTINCT FROM NOW()
      RETURNING id, nombre`,
    );

    // Y los inventados del seed, en cuanto hay clientes de verdad.
    const ficticios = await ejecutar(
      "UPDATE clientes SET activo = FALSE WHERE origen = 'DEMO' AND activo RETURNING id, nombre",
    );
    if (ficticios.length) {
      console.log(`[clientes] Se apagaron ${ficticios.length} cliente(s) de demostración: `
                + `${ficticios.map((f) => f.nombre).join(', ')}. `
                + 'Sus cotizaciones históricas no se tocaron.');
    }

    return {
      ok: true,
      total: delErp.length,
      nuevos: delErp.filter((c) => !yaConocidos.has(c.codigo)).length,
      desactivados: bajas.length + ficticios.length,
    };
  });
}

/**
 * Buscador de clientes.
 *
 * Busca por nombre o por código, sin importar mayúsculas. Sin texto devuelve
 * los primeros por orden alfabético, que es lo que hace útil abrir la lista
 * sin escribir nada.
 *
 * @param {string} q texto libre
 */
export async function buscarClientes(q = '') {
  const texto = String(q).trim();

  const filas = await query(
    `SELECT id, codigo_erp, nombre, ciudad, estado
     FROM   clientes
     WHERE  activo
       AND (@q = '' OR nombre ILIKE @patron OR codigo_erp ILIKE @patron)
     ORDER BY
       -- Lo que EMPIEZA con lo tecleado va primero: quien escribe "trans"
       -- busca "Transportes...", no "Grupo Industrial de Transportes".
       CASE WHEN @q <> '' AND nombre ILIKE @prefijo THEN 0 ELSE 1 END,
       nombre
     LIMIT @tope`,
    { q: texto, patron: `%${texto}%`, prefijo: `${texto}%`, tope: TOPE_BUSQUEDA },
  );

  const [conteo] = await query(
    `SELECT COUNT(*) AS total
     FROM   clientes
     WHERE  activo
       AND (@q = '' OR nombre ILIKE @patron OR codigo_erp ILIKE @patron)`,
    { q: texto, patron: `%${texto}%` },
  );

  return {
    clientes: filas,
    total: Number(conteo.total),
    // La interfaz lo usa para decir "hay 120 más, sigue escribiendo" en vez de
    // dejar creer que esos 50 son todos.
    hay_mas: Number(conteo.total) > filas.length,
  };
}

/** Cuántos clientes hay y de dónde salieron. Lo reporta /api/health. */
export async function estadoPadron() {
  const [fila] = await query(`
    SELECT COUNT(*) FILTER (WHERE activo AND origen = 'QUITER') AS de_quiter,
           COUNT(*) FILTER (WHERE activo AND origen = 'DEMO')   AS de_demo,
           MAX(sincronizado_en)                                 AS ultima_sincronizacion
    FROM   clientes
  `);

  return {
    de_quiter: Number(fila.de_quiter),
    de_demo: Number(fila.de_demo),
    ultima_sincronizacion: fila.ultima_sincronizacion,
  };
}
