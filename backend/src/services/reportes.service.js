/**
 * Consultas de los reportes que se bajan a Excel.
 *
 * Están aparte de solicitudes.service.js a propósito: un reporte no es una
 * pantalla. La pantalla muestra lo que cabe y pagina; el reporte se lleva todo
 * lo que el filtro abarque, con las columnas desplegadas para poder ordenar y
 * filtrar en Excel.
 *
 * Los cuatro reportes respetan los mismos filtros que la pantalla desde la que
 * se piden, para que lo que se baja sea exactamente lo que se está viendo.
 */
import { query } from '../config/db.js';
import { ESTATUS_FINALES } from '../utils/estatus.js';

/** Estatus que ya cerraron la solicitud, como lista para SQL. */
const CERRADOS = ESTATUS_FINALES.map((e) => `'${e}'`).join(', ');

/**
 * Arma el WHERE común de los reportes a partir de los filtros de la pantalla.
 * Devuelve el fragmento y los parámetros; nunca concatena valores.
 */
function armarFiltros(filtros = {}) {
  const { id_vendedor, sucursal, prioridad, estatus, desde, hasta, busqueda, dias } = filtros;
  const where = [];
  const params = {};

  if (id_vendedor) { params.vendedor = Number(id_vendedor); where.push('s.id_vendedor = @vendedor'); }
  if (sucursal)    { params.sucursal = Number(sucursal);    where.push('s.id_sucursal = @sucursal'); }
  if (prioridad)   { params.prioridad = prioridad;          where.push('s.prioridad = @prioridad'); }
  if (desde)       { params.desde = new Date(desde);        where.push('s.fecha_creacion >= @desde'); }
  if (hasta)       { params.hasta = new Date(hasta);        where.push('s.fecha_creacion <= @hasta'); }

  if (busqueda) {
    params.busqueda = `%${busqueda}%`;
    where.push('(s.folio ILIKE @busqueda OR c.nombre ILIKE @busqueda)');
  }

  if (estatus) {
    const lista = String(estatus).split(',').map((e) => e.trim()).filter(Boolean);
    if (lista.length) {
      const nombres = lista.map((valor, i) => {
        params[`est${i}`] = valor;
        return `@est${i}`;
      });
      where.push(`s.estatus_actual IN (${nombres.join(', ')})`);
    }
  }

  // `dias` es el filtro del tablero: los últimos N días.
  if (dias) {
    params.dias = Number(dias);
    where.push("s.fecha_creacion >= NOW() - (@dias * INTERVAL '1 day')");
  }

  return { clausula: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * 1) Solicitudes con su detalle: un renglón por pieza pedida.
 *
 * Se desnormaliza a propósito —el folio y el vendedor se repiten en cada
 * renglón— porque así cada fila se sostiene sola: en Excel se puede filtrar
 * por número de parte, ordenar por importe o hacer una tabla dinámica sin
 * tener que cruzar hojas.
 */
export async function solicitudesConDetalle(filtros) {
  const { clausula, params } = armarFiltros(filtros);

  return query(`
    SELECT s.folio,
           s.fecha_creacion,
           s.estatus_actual,
           s.prioridad,
           u.nombre    AS vendedor,
           su.clave    AS sucursal_clave,
           su.nombre   AS sucursal,
           c.nombre    AS cliente,
           d.sku_producto,
           d.descripcion,
           d.cantidad_solicitada,
           d.existencia_real_almacen,
           d.precio_estimado,
           d.cantidad_solicitada * COALESCE(d.precio_estimado, 0) AS importe_estimado,
           d.cantidad_surtida,
           comp.nombre AS comprador,
           TO_CHAR(s.fecha_promesa_entrega, 'YYYY-MM-DD') AS fecha_promesa_entrega,
           s.fecha_cierre,
           ROUND((EXTRACT(EPOCH FROM (COALESCE(s.fecha_cierre, NOW()) - s.fecha_creacion))
                  / 86400.0)::NUMERIC, 1) AS dias_abierta,
           s.observaciones
    FROM       solicitudes_compras s
    JOIN       solicitudes_detalle d ON d.id_solicitud = s.id
    JOIN       usuarios   u    ON u.id    = s.id_vendedor
    JOIN       sucursales su   ON su.id   = s.id_sucursal
    LEFT JOIN  clientes   c    ON c.id    = s.id_cliente
    LEFT JOIN  usuarios   comp ON comp.id = s.id_comprador_asignado
    ${clausula}
    ORDER BY s.fecha_creacion DESC, s.folio, d.id
  `, params);
}

/**
 * 2) Bitácora: quién movió cada folio, cuándo y de qué estatus a cuál.
 *
 * La columna `horas_desde_anterior` se calcula con LAG (el movimiento previo
 * del MISMO folio). Es el dato que responde "¿dónde se está atorando?": no
 * cuánto tardó la solicitud completa, sino qué tramo se comió el tiempo.
 */
export async function bitacoraPorFolio(filtros) {
  const { clausula, params } = armarFiltros(filtros);

  return query(`
    SELECT folio,
           fecha_movimiento,
           quien,
           rol,
           estatus_anterior,
           estatus_nuevo,
           comentario,
           ROUND((EXTRACT(EPOCH FROM (fecha_movimiento - anterior)) / 3600.0)::NUMERIC, 1)
             AS horas_desde_anterior
    FROM (
      SELECT s.folio,
             h.fecha_movimiento,
             uh.nombre AS quien,
             uh.rol,
             h.estatus_anterior,
             h.estatus_nuevo,
             h.comentario,
             LAG(h.fecha_movimiento) OVER (PARTITION BY h.id_solicitud
                                           ORDER BY h.fecha_movimiento) AS anterior,
             s.fecha_creacion
      FROM      solicitud_historial h
      JOIN      solicitudes_compras s ON s.id = h.id_solicitud
      JOIN      usuarios uh ON uh.id = h.id_usuario
      LEFT JOIN clientes  c  ON c.id = s.id_cliente
      ${clausula}
    ) AS movimientos
    ORDER BY fecha_creacion DESC, folio, fecha_movimiento
  `, params);
}

/**
 * 3) Concentrado de faltantes: qué se pide y no había en existencia.
 *
 * Es el reporte que contesta "¿qué nos conviene tener en piso?". Solo cuenta
 * las partidas donde la existencia era CERO al momento de pedirlas: si había
 * material, no fue un faltante aunque se haya comprado.
 */
export async function concentradoFaltantes(filtros) {
  const { clausula, params } = armarFiltros(filtros);
  const filtroFaltante = clausula
    ? `${clausula} AND d.existencia_real_almacen <= 0`
    : 'WHERE d.existencia_real_almacen <= 0';

  return query(`
    SELECT d.sku_producto,
           MAX(d.descripcion)                       AS descripcion,
           COUNT(*)                                 AS veces_pedido,
           COUNT(DISTINCT s.id)                     AS solicitudes,
           SUM(d.cantidad_solicitada)               AS piezas_pedidas,
           COUNT(DISTINCT s.id_sucursal)            AS sucursales_que_lo_piden,
           STRING_AGG(DISTINCT su.clave, ', ' ORDER BY su.clave) AS claves_sucursal,
           ROUND(AVG(d.precio_estimado), 2)         AS precio_promedio,
           SUM(d.cantidad_solicitada * COALESCE(d.precio_estimado, 0)) AS importe_estimado,
           MAX(s.fecha_creacion)                    AS ultimo_pedido,
           COUNT(*) FILTER (WHERE s.prioridad = 'Urgente') AS veces_urgente
    FROM      solicitudes_detalle d
    JOIN      solicitudes_compras s ON s.id = d.id_solicitud
    JOIN      sucursales su ON su.id = s.id_sucursal
    LEFT JOIN clientes   c  ON c.id  = s.id_cliente
    ${filtroFaltante}
    GROUP BY d.sku_producto
    ORDER BY piezas_pedidas DESC, veces_pedido DESC
  `, params);
}

/**
 * 4) Indicadores del tablero, en varios bloques.
 *
 * Devuelve un objeto con cada bloque por separado en lugar de una tabla plana:
 * el Excel los acomoda como secciones, que es como se leen.
 */
export async function indicadoresGerencia(filtros) {
  const { clausula, params } = armarFiltros(filtros);

  const [resumen] = await query(`
    SELECT COUNT(DISTINCT s.id)                                             AS solicitudes,
           COUNT(DISTINCT s.id) FILTER (WHERE s.estatus_actual NOT IN (${CERRADOS})) AS abiertas,
           COUNT(DISTINCT s.id) FILTER (WHERE s.prioridad = 'Urgente'
                                          AND s.estatus_actual NOT IN (${CERRADOS})) AS urgentes_abiertas,
           COUNT(DISTINCT s.id) FILTER (WHERE s.fecha_promesa_entrega < CURRENT_DATE
                                          AND s.estatus_actual NOT IN (${CERRADOS})) AS vencidas,
           COALESCE(SUM(d.cantidad_solicitada * COALESCE(d.precio_estimado, 0)), 0)  AS monto_estimado,
           COALESCE(SUM(d.cantidad_solicitada), 0)                          AS piezas
    FROM      solicitudes_compras s
    LEFT JOIN solicitudes_detalle d ON d.id_solicitud = s.id
    LEFT JOIN clientes c ON c.id = s.id_cliente
    ${clausula}
  `, params);

  const porEstatus = await query(`
    SELECT s.estatus_actual AS estatus, COUNT(*) AS solicitudes
    FROM      solicitudes_compras s
    LEFT JOIN clientes c ON c.id = s.id_cliente
    ${clausula}
    GROUP BY s.estatus_actual
    ORDER BY solicitudes DESC
  `, params);

  const porSucursal = await query(`
    SELECT su.clave, su.nombre AS sucursal,
           COUNT(DISTINCT s.id) AS solicitudes,
           COUNT(DISTINCT s.id) FILTER (WHERE s.estatus_actual NOT IN (${CERRADOS})) AS abiertas,
           COALESCE(SUM(d.cantidad_solicitada * COALESCE(d.precio_estimado, 0)), 0)  AS monto_estimado
    FROM      solicitudes_compras s
    JOIN      sucursales su ON su.id = s.id_sucursal
    LEFT JOIN solicitudes_detalle d ON d.id_solicitud = s.id
    LEFT JOIN clientes c ON c.id = s.id_cliente
    ${clausula}
    GROUP BY su.clave, su.nombre
    ORDER BY solicitudes DESC
  `, params);

  const porVendedor = await query(`
    SELECT u.nombre AS vendedor,
           COUNT(DISTINCT s.id) AS solicitudes,
           COUNT(DISTINCT s.id) FILTER (WHERE s.estatus_actual NOT IN (${CERRADOS})) AS abiertas,
           COALESCE(SUM(d.cantidad_solicitada * COALESCE(d.precio_estimado, 0)), 0)  AS monto_estimado
    FROM      solicitudes_compras s
    JOIN      usuarios u ON u.id = s.id_vendedor
    LEFT JOIN solicitudes_detalle d ON d.id_solicitud = s.id
    LEFT JOIN clientes c ON c.id = s.id_cliente
    ${clausula}
    GROUP BY u.nombre
    ORDER BY solicitudes DESC
  `, params);

  const [tiempos] = await query(`
    SELECT ROUND((AVG(EXTRACT(EPOCH FROM (s.fecha_cierre - s.fecha_creacion))) / 3600.0)::NUMERIC, 1) AS horas_promedio,
           ROUND((AVG(EXTRACT(EPOCH FROM (s.fecha_cierre - s.fecha_creacion))) / 86400.0)::NUMERIC, 1) AS dias_promedio,
           COUNT(*) AS cerradas
    FROM      solicitudes_compras s
    LEFT JOIN clientes c ON c.id = s.id_cliente
    ${clausula}${clausula ? ' AND' : 'WHERE'} s.fecha_cierre IS NOT NULL
  `, params);

  return { resumen, porEstatus, porSucursal, porVendedor, tiempos };
}
