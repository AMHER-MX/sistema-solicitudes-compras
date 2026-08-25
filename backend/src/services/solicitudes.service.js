/**
 * Capa de acceso a datos de las solicitudes de compra (SQL Server).
 * Aquí vive todo el SQL; los controladores solo validan y responden.
 *
 * Reglas que se respetan en todo el archivo:
 *   - Todo valor variable viaja como parámetro (@nombre), nunca concatenado.
 *     Lo único que se interpola son nombres de parámetro que genera el propio
 *     código (@est0, @est1, ...), jamás algo que venga del usuario.
 *   - Las escrituras que deben ser atómicas van dentro de withTransaction.
 */
import { T, query, queryUno, withTransaction } from '../config/db.js';
import { ESTATUS, ESTATUS_FINALES } from '../utils/estatus.js';
import { notFound } from '../utils/errors.js';
import { existenciaDeSku } from './erp/index.js';

/**
 * Columnas del encabezado con sus datos relacionados, reutilizadas en listado
 * y detalle. Se listan una por una a propósito, en vez de usar `s.*`, por
 * `fecha_promesa_entrega`:
 *
 * es una columna DATE, y el driver la entrega como medianoche UTC. Al
 * formatearla un navegador en México (UTC-6) mostraría el día ANTERIOR — una
 * promesa de entrega corrida un día es justo el tipo de error que nadie nota
 * hasta que el cliente reclama. Se convierte a texto 'YYYY-MM-DD' aquí, donde
 * no hay zona horaria que la desplace.
 */
const SELECT_CABECERA = `
    s.id,
    s.folio,
    s.id_vendedor,
    s.id_sucursal,
    s.id_cliente,
    s.prioridad,
    s.estatus_actual,
    s.observaciones,
    s.fecha_creacion,
    CONVERT(VARCHAR(10), s.fecha_promesa_entrega, 23) AS fecha_promesa_entrega,
    s.fecha_cierre,
    s.id_comprador_asignado,
    s.actualizado_en,
    u.nombre    AS vendedor_nombre,
    su.nombre   AS sucursal_nombre,
    su.clave    AS sucursal_clave,
    c.nombre    AS cliente_nombre,
    comp.nombre AS comprador_nombre`;

const FROM_CABECERA = `
  FROM      dbo.solicitudes_compras s
  JOIN      dbo.usuarios   u    ON u.id    = s.id_vendedor
  JOIN      dbo.sucursales su   ON su.id   = s.id_sucursal
  LEFT JOIN dbo.clientes   c    ON c.id    = s.id_cliente
  LEFT JOIN dbo.usuarios   comp ON comp.id = s.id_comprador_asignado`;

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
  // Se hace ANTES de abrir la transacción para no mantener locks abiertos
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

  return withTransaction(async (ejecutar) => {
    // 1) Encabezado. El folio lo genera el DEFAULT de la columna.
    const [cabecera] = await ejecutar(
      `INSERT INTO dbo.solicitudes_compras
         (id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual, observaciones)
       OUTPUT INSERTED.*
       VALUES (@vendedor, @sucursal, @cliente, @prioridad, @estatus, @observaciones)`,
      {
        vendedor: id_vendedor,
        sucursal: id_sucursal,
        cliente: { tipo: T.Int, valor: id_cliente },
        prioridad,
        estatus: ESTATUS.PENDIENTE,
        observaciones: { tipo: T.NVarChar, valor: observaciones },
      },
    );

    // 2) Partidas.
    const detalle = [];
    for (const it of itemsConExistencia) {
      const [fila] = await ejecutar(
        `INSERT INTO dbo.solicitudes_detalle
           (id_solicitud, sku_producto, descripcion, cantidad_solicitada,
            existencia_real_almacen, precio_estimado)
         OUTPUT INSERTED.*
         VALUES (@solicitud, @sku, @descripcion, @cantidad, @existencia, @precio)`,
        {
          solicitud: cabecera.id,
          sku: it.sku_producto,
          descripcion: it.descripcion,
          cantidad: { tipo: T.Decimal(12, 2), valor: Number(it.cantidad_solicitada) },
          existencia: { tipo: T.Decimal(12, 2), valor: Number(it.existencia_real_almacen) },
          precio: { tipo: T.Decimal(12, 2), valor: it.precio_estimado ?? null },
        },
      );
      detalle.push(fila);
    }

    // 3) Primer movimiento del historial: nace en 'Pendiente'.
    await ejecutar(
      `INSERT INTO dbo.solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES (@solicitud, @usuario, NULL, @estatus, @comentario)`,
      {
        solicitud: cabecera.id,
        usuario: id_vendedor,
        estatus: ESTATUS.PENDIENTE,
        comentario: 'Solicitud creada por el vendedor.',
      },
    );

    return { ...cabecera, detalle };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Listado con filtros opcionales y paginación.
 * Los filtros se arman dinámicamente pero SIEMPRE con parámetros.
 */
export async function listarSolicitudes(filtros = {}) {
  const {
    id_vendedor, prioridad, estatus, sucursal,
    desde, hasta, busqueda,
    limite = 50, pagina = 1,
  } = filtros;

  const where = [];
  const params = {};

  if (id_vendedor) { params.vendedor = Number(id_vendedor); where.push('s.id_vendedor = @vendedor'); }
  if (sucursal)    { params.sucursal = Number(sucursal);    where.push('s.id_sucursal = @sucursal'); }
  if (prioridad)   { params.prioridad = prioridad;          where.push('s.prioridad = @prioridad'); }
  if (desde)       { params.desde = { tipo: T.DateTime2, valor: new Date(desde) }; where.push('s.fecha_creacion >= @desde'); }
  if (hasta)       { params.hasta = { tipo: T.DateTime2, valor: new Date(hasta) }; where.push('s.fecha_creacion <= @hasta'); }

  // Búsqueda libre por folio o nombre de cliente.
  if (busqueda) {
    params.busqueda = `%${busqueda}%`;
    where.push('(s.folio LIKE @busqueda OR c.nombre LIKE @busqueda)');
  }

  // `estatus` acepta uno o varios separados por coma: ?estatus=Pendiente,Autorizada
  if (estatus) {
    const lista = String(estatus).split(',').map((e) => e.trim()).filter(Boolean);
    if (lista.length) {
      // Solo se interpolan nombres de parámetro que genera este código.
      const nombres = lista.map((valor, i) => {
        params[`est${i}`] = valor;
        return `@est${i}`;
      });
      where.push(`s.estatus_actual IN (${nombres.join(', ')})`);
    }
  }

  const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const lim = Math.min(Number(limite) || 50, 200);
  const off = (Math.max(Number(pagina) || 1, 1) - 1) * lim;
  params.limite = lim;
  params.offset = off;

  return query(`
    SELECT ${SELECT_CABECERA},
           COUNT(d.id)                                                        AS total_partidas,
           ISNULL(SUM(d.cantidad_solicitada), 0)                              AS total_piezas,
           ISNULL(SUM(d.cantidad_solicitada * ISNULL(d.precio_estimado, 0)), 0) AS monto_estimado,
           -- Días transcurridos desde el alta (resalta las solicitudes añejas)
           ROUND(DATEDIFF(SECOND, s.fecha_creacion, SYSUTCDATETIME()) / 86400.0, 1) AS dias_abierta
    ${FROM_CABECERA}
    LEFT JOIN dbo.solicitudes_detalle d ON d.id_solicitud = s.id
    ${clausula}
    GROUP BY s.id, s.folio, s.id_vendedor, s.id_sucursal, s.id_cliente, s.prioridad,
             s.estatus_actual, s.observaciones, s.fecha_creacion, s.fecha_promesa_entrega,
             s.fecha_cierre, s.id_comprador_asignado, s.actualizado_en,
             u.nombre, su.nombre, su.clave, c.nombre, comp.nombre
    ORDER BY -- Urgente primero, luego lo más viejo arriba
             CASE s.prioridad WHEN 'Urgente' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
             s.fecha_creacion ASC
    OFFSET @offset ROWS FETCH NEXT @limite ROWS ONLY
  `, params);
}

/** Solicitud completa: encabezado + partidas + bitácora. */
export async function obtenerSolicitud(id) {
  const cabecera = await queryUno(
    `SELECT ${SELECT_CABECERA} ${FROM_CABECERA} WHERE s.id = @id`,
    { id: Number(id) },
  );

  if (!cabecera) throw notFound(`No existe la solicitud ${id}`);

  const [detalle, historial] = await Promise.all([
    query(
      `SELECT * FROM dbo.solicitudes_detalle
       WHERE id_solicitud = @id ORDER BY id`,
      { id: Number(id) },
    ),
    query(
      `SELECT h.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM      dbo.solicitud_historial h
       JOIN      dbo.usuarios u ON u.id = h.id_usuario
       WHERE     h.id_solicitud = @id
       ORDER BY  h.fecha_movimiento ASC, h.id ASC`,
      { id: Number(id) },
    ),
  ]);

  return { ...cabecera, detalle, historial };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMBIO DE ESTATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Actualiza el estatus, la fecha promesa y deja constancia en el historial.
 *
 * El SELECT lleva WITH (UPDLOCK, ROWLOCK): reserva el renglón hasta que
 * termine la transacción, para que dos compradores no muevan el mismo folio
 * al mismo tiempo.
 */
export async function cambiarEstatus({ id, id_usuario, estatus_nuevo, comentario, fecha_promesa_entrega, asignarme }) {
  return withTransaction(async (ejecutar) => {
    const [actual] = await ejecutar(
      `SELECT id, estatus_actual
       FROM   dbo.solicitudes_compras WITH (UPDLOCK, ROWLOCK)
       WHERE  id = @id`,
      { id: Number(id) },
    );
    if (!actual) throw notFound(`No existe la solicitud ${id}`);

    const estatus_anterior = actual.estatus_actual;

    // Al cerrar la solicitud sellamos la fecha de cierre: alimenta el KPI
    // de tiempo promedio de atención.
    const cierra = ESTATUS_FINALES.includes(estatus_nuevo);

    const [actualizada] = await ejecutar(
      `UPDATE dbo.solicitudes_compras
          SET estatus_actual        = @estatus,
              fecha_promesa_entrega = ISNULL(@promesa, fecha_promesa_entrega),
              fecha_cierre          = CASE WHEN @cierra = 1 THEN SYSUTCDATETIME() ELSE fecha_cierre END,
              id_comprador_asignado = CASE WHEN @asignar = 1 THEN @usuario ELSE id_comprador_asignado END,
              actualizado_en        = SYSUTCDATETIME()
        OUTPUT INSERTED.id, INSERTED.folio, INSERTED.id_vendedor, INSERTED.id_sucursal,
               INSERTED.id_cliente, INSERTED.prioridad, INSERTED.estatus_actual,
               INSERTED.observaciones, INSERTED.fecha_creacion,
               CONVERT(VARCHAR(10), INSERTED.fecha_promesa_entrega, 23) AS fecha_promesa_entrega,
               INSERTED.fecha_cierre, INSERTED.id_comprador_asignado, INSERTED.actualizado_en
        WHERE id = @id`,
      {
        estatus: estatus_nuevo,
        promesa: { tipo: T.Date, valor: fecha_promesa_entrega || null },
        cierra: { tipo: T.Bit, valor: cierra },
        asignar: { tipo: T.Bit, valor: Boolean(asignarme) },
        usuario: id_usuario,
        id: Number(id),
      },
    );

    await ejecutar(
      `INSERT INTO dbo.solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES (@id, @usuario, @anterior, @nuevo, @comentario)`,
      {
        id: Number(id),
        usuario: id_usuario,
        anterior: { tipo: T.NVarChar, valor: estatus_anterior },
        nuevo: estatus_nuevo,
        comentario: { tipo: T.NVarChar, valor: comentario || null },
      },
    );

    return { ...actualizada, estatus_anterior };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MÉTRICAS PARA EL DASHBOARD GERENCIAL
// ─────────────────────────────────────────────────────────────────────────────

// Estados que ya cerraron: se repiten en varios agregados del tablero.
const CERRADOS_SQL = `('Recibido','Cancelada','Rechazada')`;

/**
 * @param {object} filtros
 * @param {number} [filtros.dias]     ventana de análisis (default 30)
 * @param {number} [filtros.sucursal] limitar a una sucursal
 */
export async function metricasGerencia({ dias = 30, sucursal } = {}) {
  const params = { dias: Number(dias) };
  let filtroSucursal = '';
  if (sucursal) {
    params.sucursal = Number(sucursal);
    filtroSucursal = ' AND s.id_sucursal = @sucursal';
  }

  const ventana = `s.fecha_creacion >= DATEADD(DAY, -@dias, SYSUTCDATETIME())${filtroSucursal}`;

  // 1) Conteo por estatus
  const porEstatus = query(`
    SELECT s.estatus_actual AS estatus, COUNT(*) AS total
    FROM   dbo.solicitudes_compras s
    WHERE  ${ventana}
    GROUP BY s.estatus_actual
    ORDER BY total DESC`, params);

  // 2) Conteo por prioridad
  const porPrioridad = query(`
    SELECT s.prioridad, COUNT(*) AS total
    FROM   dbo.solicitudes_compras s
    WHERE  ${ventana}
    GROUP BY s.prioridad`, params);

  // 3) Productos más solicitados SIN existencia al momento de pedirlos
  const topFaltantes = query(`
    SELECT TOP (10)
           d.sku_producto,
           MIN(d.descripcion)          AS descripcion,
           COUNT(DISTINCT s.id)        AS veces_solicitado,
           SUM(d.cantidad_solicitada)  AS piezas_solicitadas,
           COUNT(DISTINCT s.id_sucursal) AS sucursales_afectadas
    FROM   dbo.solicitudes_detalle d
    JOIN   dbo.solicitudes_compras s ON s.id = d.id_solicitud
    WHERE  d.existencia_real_almacen <= 0 AND ${ventana}
    GROUP BY d.sku_producto
    ORDER BY veces_solicitado DESC, piezas_solicitadas DESC`, params);

  // 4) Tiempo promedio de atención (solo solicitudes cerradas)
  const tiempos = query(`
    SELECT ROUND(AVG(CAST(DATEDIFF(SECOND, s.fecha_creacion, s.fecha_cierre) AS DECIMAL(18,4))) / 3600.0, 1)  AS horas_promedio,
           ROUND(AVG(CAST(DATEDIFF(SECOND, s.fecha_creacion, s.fecha_cierre) AS DECIMAL(18,4))) / 86400.0, 1) AS dias_promedio,
           COUNT(*) AS solicitudes_cerradas
    FROM   dbo.solicitudes_compras s
    WHERE  s.fecha_cierre IS NOT NULL AND ${ventana}`, params);

  // 5) Totales e indicadores de riesgo
  const totales = query(`
    SELECT COUNT(*) AS total_solicitudes,
           SUM(CASE WHEN s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS abiertas,
           SUM(CASE WHEN s.prioridad = 'Urgente'
                     AND s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS urgentes_abiertas,
           SUM(CASE WHEN s.fecha_promesa_entrega < CAST(SYSUTCDATETIME() AS DATE)
                     AND s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS vencidas,
           ISNULL(SUM(sub.monto), 0) AS monto_estimado_total
    FROM   dbo.solicitudes_compras s
    LEFT JOIN (
      SELECT id_solicitud, SUM(cantidad_solicitada * ISNULL(precio_estimado, 0)) AS monto
      FROM   dbo.solicitudes_detalle GROUP BY id_solicitud
    ) sub ON sub.id_solicitud = s.id
    WHERE  ${ventana}`, params);

  // 6) Carga por sucursal
  const porSucursal = query(`
    SELECT su.clave, su.nombre,
           COUNT(*) AS total,
           SUM(CASE WHEN s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS abiertas
    FROM   dbo.solicitudes_compras s
    JOIN   dbo.sucursales su ON su.id = s.id_sucursal
    WHERE  ${ventana}
    GROUP BY su.clave, su.nombre
    ORDER BY total DESC`, params);

  const [e, p, f, t, tot, suc] = await Promise.all([
    porEstatus, porPrioridad, topFaltantes, tiempos, totales, porSucursal,
  ]);

  // SQL Server devuelve DECIMAL como string en algunos casos; se normaliza
  // aquí para que el frontend siempre reciba números.
  const num = (v) => (v === null || v === undefined ? null : Number(v));

  return {
    ventana_dias: Number(dias),
    totales: {
      total_solicitudes: num(tot[0]?.total_solicitudes) ?? 0,
      abiertas: num(tot[0]?.abiertas) ?? 0,
      urgentes_abiertas: num(tot[0]?.urgentes_abiertas) ?? 0,
      vencidas: num(tot[0]?.vencidas) ?? 0,
      monto_estimado_total: num(tot[0]?.monto_estimado_total) ?? 0,
    },
    tiempo_atencion: {
      horas_promedio: num(t[0]?.horas_promedio),
      dias_promedio: num(t[0]?.dias_promedio),
      solicitudes_cerradas: num(t[0]?.solicitudes_cerradas) ?? 0,
    },
    por_estatus: e.map((r) => ({ estatus: r.estatus, total: num(r.total) })),
    por_prioridad: p.map((r) => ({ prioridad: r.prioridad, total: num(r.total) })),
    por_sucursal: suc.map((r) => ({
      clave: r.clave, nombre: r.nombre, total: num(r.total), abiertas: num(r.abiertas),
    })),
    top_faltantes: f.map((r) => ({
      sku_producto: r.sku_producto,
      descripcion: r.descripcion,
      veces_solicitado: num(r.veces_solicitado),
      piezas_solicitadas: num(r.piezas_solicitadas),
      sucursales_afectadas: num(r.sucursales_afectadas),
    })),
  };
}
