/**
 * Capa de acceso a datos de las solicitudes de compra.
 * Aquí vive todo el SQL; los controladores solo validan y responden.
 */
import { query, withTransaction } from '../config/db.js';
import { ESTATUS, ESTATUS_FINALES } from '../utils/estatus.js';
import { notFound } from '../utils/errors.js';
import { existenciaDeSku } from './erp/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// ALTA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea el encabezado, sus partidas y el primer registro de historial
 * dentro de una sola transacción (o todo o nada).
 *
 * @param {object} datos
 * @param {number} datos.id_vendedor    usuario autenticado
 * @param {number} datos.id_sucursal
 * @param {number|null} datos.id_cliente
 * @param {'Urgente'|'Normal'|'Baja'} datos.prioridad
 * @param {string} [datos.observaciones]
 * @param {Array}  datos.items  [{ sku_producto, descripcion, cantidad_solicitada, precio_estimado, existencia_real_almacen? }]
 * @param {string} [datos.almacen_erp] clave de almacén para consultar existencia
 */
export async function crearSolicitud(datos) {
  const {
    id_vendedor, id_sucursal, id_cliente = null,
    prioridad = 'Normal', observaciones = null, items, almacen_erp,
  } = datos;

  // Si el frontend no mandó la existencia, la sellamos desde el ERP.
  // Se hace ANTES de abrir la transacción para no mantener el lock abierto
  // mientras esperamos una llamada de red.
  const itemsConExistencia = await Promise.all(
    items.map(async (it) => ({
      ...it,
      existencia_real_almacen:
        it.existencia_real_almacen !== undefined && it.existencia_real_almacen !== null
          ? Number(it.existencia_real_almacen)
          : await existenciaDeSku(it.sku_producto, almacen_erp).catch(() => 0),
    })),
  );

  return withTransaction(async (client) => {
    // 1) Encabezado. El folio lo genera el trigger tg_solicitudes_folio.
    const { rows: [cabecera] } = await client.query(
      `INSERT INTO solicitudes_compras
         (id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id_vendedor, id_sucursal, id_cliente, prioridad, ESTATUS.PENDIENTE, observaciones],
    );

    // 2) Partidas.
    const detalle = [];
    for (const it of itemsConExistencia) {
      const { rows: [fila] } = await client.query(
        `INSERT INTO solicitudes_detalle
           (id_solicitud, sku_producto, descripcion, cantidad_solicitada,
            existencia_real_almacen, precio_estimado)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          cabecera.id,
          it.sku_producto,
          it.descripcion,
          it.cantidad_solicitada,
          it.existencia_real_almacen,
          it.precio_estimado ?? null,
        ],
      );
      detalle.push(fila);
    }

    // 3) Primer movimiento del historial: nace en 'Pendiente'.
    await client.query(
      `INSERT INTO solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES ($1, $2, NULL, $3, $4)`,
      [cabecera.id, id_vendedor, ESTATUS.PENDIENTE, 'Solicitud creada por el vendedor.'],
    );

    return { ...cabecera, detalle };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Listado con filtros opcionales y paginación.
 * Los filtros se arman dinámicamente con parámetros ($1, $2, ...) para
 * evitar cualquier riesgo de inyección SQL.
 */
export async function listarSolicitudes(filtros = {}) {
  const {
    id_vendedor, prioridad, estatus, sucursal,
    desde, hasta, busqueda,
    limite = 50, pagina = 1,
  } = filtros;

  const where = [];
  const params = [];
  const add = (sql, valor) => {
    params.push(valor);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (id_vendedor) add('s.id_vendedor = ?', Number(id_vendedor));
  if (sucursal)    add('s.id_sucursal = ?', Number(sucursal));
  if (prioridad)   add('s.prioridad = ?', prioridad);
  if (desde)       add('s.fecha_creacion >= ?', desde);
  if (hasta)       add('s.fecha_creacion <= ?', hasta);
  // Búsqueda libre por folio o nombre de cliente (usa el mismo parámetro dos veces).
  if (busqueda) {
    params.push(`%${busqueda}%`);
    where.push(`(s.folio ILIKE $${params.length} OR c.nombre ILIKE $${params.length})`);
  }

  // `estatus` acepta uno o varios separados por coma: ?estatus=Pendiente,Autorizada
  if (estatus) {
    const lista = String(estatus).split(',').map((e) => e.trim()).filter(Boolean);
    if (lista.length) {
      params.push(lista);
      where.push(`s.estatus_actual = ANY($${params.length})`);
    }
  }

  const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const lim = Math.min(Number(limite) || 50, 200);
  const off = (Math.max(Number(pagina) || 1, 1) - 1) * lim;
  params.push(lim, off);

  const sql = `
    SELECT  s.*,
            u.nombre  AS vendedor_nombre,
            su.nombre AS sucursal_nombre,
            su.clave  AS sucursal_clave,
            c.nombre  AS cliente_nombre,
            comp.nombre AS comprador_nombre,
            COUNT(d.id)::int AS total_partidas,
            COALESCE(SUM(d.cantidad_solicitada), 0)::float AS total_piezas,
            COALESCE(SUM(d.cantidad_solicitada * COALESCE(d.precio_estimado, 0)), 0)::float AS monto_estimado,
            -- Días transcurridos desde el alta (para resaltar solicitudes añejas)
            ROUND(EXTRACT(EPOCH FROM (NOW() - s.fecha_creacion)) / 86400.0, 1)::float AS dias_abierta
    FROM        solicitudes_compras s
    JOIN        usuarios   u    ON u.id  = s.id_vendedor
    JOIN        sucursales su    ON su.id = s.id_sucursal
    LEFT JOIN   clientes   c     ON c.id  = s.id_cliente
    LEFT JOIN   usuarios   comp  ON comp.id = s.id_comprador_asignado
    LEFT JOIN   solicitudes_detalle d ON d.id_solicitud = s.id
    ${clausula}
    GROUP BY    s.id, u.nombre, su.nombre, su.clave, c.nombre, comp.nombre
    ORDER BY    -- Urgente primero, luego lo más viejo arriba
                CASE s.prioridad WHEN 'Urgente' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
                s.fecha_creacion ASC
    LIMIT  $${params.length - 1}
    OFFSET $${params.length}
  `;

  const { rows } = await query(sql, params);
  return rows;
}

/** Solicitud completa: encabezado + partidas + bitácora. */
export async function obtenerSolicitud(id) {
  const { rows: [cabecera] } = await query(
    `SELECT  s.*,
             u.nombre  AS vendedor_nombre,
             su.nombre AS sucursal_nombre,
             su.clave  AS sucursal_clave,
             c.nombre  AS cliente_nombre,
             comp.nombre AS comprador_nombre
     FROM      solicitudes_compras s
     JOIN      usuarios   u   ON u.id  = s.id_vendedor
     JOIN      sucursales su  ON su.id = s.id_sucursal
     LEFT JOIN clientes   c   ON c.id  = s.id_cliente
     LEFT JOIN usuarios   comp ON comp.id = s.id_comprador_asignado
     WHERE     s.id = $1`,
    [id],
  );

  if (!cabecera) throw notFound(`No existe la solicitud ${id}`);

  const [{ rows: detalle }, { rows: historial }] = await Promise.all([
    query(
      `SELECT * FROM solicitudes_detalle
       WHERE id_solicitud = $1 ORDER BY id`,
      [id],
    ),
    query(
      `SELECT h.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM      solicitud_historial h
       JOIN      usuarios u ON u.id = h.id_usuario
       WHERE     h.id_solicitud = $1
       ORDER BY  h.fecha_movimiento ASC, h.id ASC`,
      [id],
    ),
  ]);

  return { ...cabecera, detalle, historial };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMBIO DE ESTATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actualiza el estatus, la fecha promesa y deja constancia en el historial.
 * Bloquea la fila con SELECT ... FOR UPDATE para evitar que dos compradores
 * muevan la misma solicitud al mismo tiempo.
 */
export async function cambiarEstatus({ id, id_usuario, estatus_nuevo, comentario, fecha_promesa_entrega, asignarme }) {
  return withTransaction(async (client) => {
    const { rows: [actual] } = await client.query(
      'SELECT id, estatus_actual FROM solicitudes_compras WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!actual) throw notFound(`No existe la solicitud ${id}`);

    const estatus_anterior = actual.estatus_actual;

    // Al cerrar la solicitud sellamos la fecha de cierre (alimenta el KPI
    // de tiempo promedio de atención).
    const cierra = ESTATUS_FINALES.includes(estatus_nuevo);

    const { rows: [actualizada] } = await client.query(
      `UPDATE solicitudes_compras
          SET estatus_actual        = $1,
              fecha_promesa_entrega = COALESCE($2, fecha_promesa_entrega),
              fecha_cierre          = CASE WHEN $3 THEN NOW() ELSE fecha_cierre END,
              id_comprador_asignado = CASE WHEN $4 THEN $5 ELSE id_comprador_asignado END
        WHERE id = $6
        RETURNING *`,
      [estatus_nuevo, fecha_promesa_entrega || null, cierra, Boolean(asignarme), id_usuario, id],
    );

    await client.query(
      `INSERT INTO solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, id_usuario, estatus_anterior, estatus_nuevo, comentario || null],
    );

    return { ...actualizada, estatus_anterior };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MÉTRICAS PARA EL DASHBOARD GERENCIAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} filtros
 * @param {number} [filtros.dias]     ventana de análisis (default 30)
 * @param {number} [filtros.sucursal] limitar a una sucursal
 */
export async function metricasGerencia({ dias = 30, sucursal } = {}) {
  const params = [Number(dias)];
  let filtroSucursal = '';
  if (sucursal) {
    params.push(Number(sucursal));
    filtroSucursal = ` AND s.id_sucursal = $${params.length}`;
  }

  const ventana = `s.fecha_creacion >= NOW() - ($1::int * INTERVAL '1 day')${filtroSucursal}`;

  // 1) Conteo por estatus
  const porEstatus = query(
    `SELECT s.estatus_actual AS estatus, COUNT(*)::int AS total
     FROM   solicitudes_compras s
     WHERE  ${ventana}
     GROUP BY s.estatus_actual
     ORDER BY total DESC`,
    params,
  );

  // 2) Conteo por prioridad
  const porPrioridad = query(
    `SELECT s.prioridad, COUNT(*)::int AS total
     FROM   solicitudes_compras s
     WHERE  ${ventana}
     GROUP BY s.prioridad`,
    params,
  );

  // 3) Productos más solicitados SIN existencia al momento de pedirlos
  const topFaltantes = query(
    `SELECT  d.sku_producto,
             MIN(d.descripcion)                       AS descripcion,
             COUNT(DISTINCT s.id)::int                AS veces_solicitado,
             SUM(d.cantidad_solicitada)::float        AS piezas_solicitadas,
             COUNT(DISTINCT s.id_sucursal)::int       AS sucursales_afectadas
     FROM    solicitudes_detalle d
     JOIN    solicitudes_compras s ON s.id = d.id_solicitud
     WHERE   d.existencia_real_almacen <= 0
       AND   ${ventana}
     GROUP BY d.sku_producto
     ORDER BY veces_solicitado DESC, piezas_solicitadas DESC
     LIMIT 10`,
    params,
  );

  // 4) Tiempo promedio de atención (solo solicitudes cerradas)
  const tiempos = query(
    `SELECT  ROUND(AVG(EXTRACT(EPOCH FROM (s.fecha_cierre - s.fecha_creacion)) / 3600.0)::numeric, 1)::float AS horas_promedio,
             ROUND(AVG(EXTRACT(EPOCH FROM (s.fecha_cierre - s.fecha_creacion)) / 86400.0)::numeric, 1)::float AS dias_promedio,
             COUNT(*)::int AS solicitudes_cerradas
     FROM    solicitudes_compras s
     WHERE   s.fecha_cierre IS NOT NULL AND ${ventana}`,
    params,
  );

  // 5) Totales / indicadores de riesgo
  const totales = query(
    `SELECT  COUNT(*)::int AS total_solicitudes,
             COUNT(*) FILTER (WHERE s.estatus_actual NOT IN ('Recibido','Cancelada','Rechazada'))::int AS abiertas,
             COUNT(*) FILTER (WHERE s.prioridad = 'Urgente'
                              AND s.estatus_actual NOT IN ('Recibido','Cancelada','Rechazada'))::int AS urgentes_abiertas,
             COUNT(*) FILTER (WHERE s.fecha_promesa_entrega < CURRENT_DATE
                              AND s.estatus_actual NOT IN ('Recibido','Cancelada','Rechazada'))::int AS vencidas,
             COALESCE(SUM(sub.monto), 0)::float AS monto_estimado_total
     FROM    solicitudes_compras s
     LEFT JOIN (
        SELECT id_solicitud, SUM(cantidad_solicitada * COALESCE(precio_estimado, 0)) AS monto
        FROM   solicitudes_detalle GROUP BY id_solicitud
     ) sub ON sub.id_solicitud = s.id
     WHERE   ${ventana}`,
    params,
  );

  // 6) Carga por sucursal
  const porSucursal = query(
    `SELECT  su.clave, su.nombre,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE s.estatus_actual NOT IN ('Recibido','Cancelada','Rechazada'))::int AS abiertas
     FROM    solicitudes_compras s
     JOIN    sucursales su ON su.id = s.id_sucursal
     WHERE   ${ventana}
     GROUP BY su.clave, su.nombre
     ORDER BY total DESC`,
    params,
  );

  const [e, p, f, t, tot, suc] = await Promise.all([
    porEstatus, porPrioridad, topFaltantes, tiempos, totales, porSucursal,
  ]);

  return {
    ventana_dias: Number(dias),
    totales: tot.rows[0],
    tiempo_atencion: t.rows[0],
    por_estatus: e.rows,
    por_prioridad: p.rows,
    por_sucursal: suc.rows,
    top_faltantes: f.rows,
  };
}
