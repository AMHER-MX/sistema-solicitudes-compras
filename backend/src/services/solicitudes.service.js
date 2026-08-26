/**
 * Capa de acceso a datos de las solicitudes de compra (PostgreSQL).
 * Aquí vive todo el SQL; los controladores solo validan y responden.
 *
 * Reglas que se respetan en todo el archivo:
 *   - Todo valor variable viaja como parámetro (@nombre), nunca concatenado.
 *     Lo único que se interpola son nombres de parámetro que genera el propio
 *     código (@est0, @est1, ...), jamás algo que venga del usuario.
 *   - Las escrituras que deben ser atómicas van dentro de withTransaction.
 */
import { query, queryUno, withTransaction } from '../config/db.js';
import {
  DIAS_VIGENCIA_DEFAULT, ESTATUS, ESTATUS_FINALES, TIPOS,
  estatusInicialCotizacion, puedeConvertir, puedeConvertirlo,
} from '../utils/estatus.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { consultarExistencias, existenciaDeSku, precioConfiable } from './erp/index.js';

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
    s.tipo,
    s.enviada_en,
    s.vence_en,
    s.convertida_en,
    s.dias_vigencia,
    -- Días que le quedan a la cotización antes de vencer. Negativo = ya pasó
    -- su plazo y el vigía todavía no la alcanza. NULL en todo lo que no sea
    -- una cotización enviada, para que la interfaz no tenga que adivinar.
    CASE WHEN s.vence_en IS NULL THEN NULL
         ELSE FLOOR(EXTRACT(EPOCH FROM (s.vence_en - NOW())) / 86400.0)
    END AS dias_para_vencer,
    s.id_vendedor,
    s.id_sucursal,
    s.id_cliente,
    s.prioridad,
    s.estatus_actual,
    s.observaciones,
    s.fecha_creacion,
    TO_CHAR(s.fecha_promesa_entrega, 'YYYY-MM-DD') AS fecha_promesa_entrega,
    s.fecha_cierre,
    s.id_comprador_asignado,
    s.actualizado_en,
    u.nombre    AS vendedor_nombre,
    su.nombre   AS sucursal_nombre,
    su.clave    AS sucursal_clave,
    c.nombre    AS cliente_nombre,
    comp.nombre AS comprador_nombre`;

const FROM_CABECERA = `
  FROM      solicitudes_compras s
  JOIN      usuarios   u    ON u.id    = s.id_vendedor
  JOIN      sucursales su   ON su.id   = s.id_sucursal
  LEFT JOIN clientes   c    ON c.id    = s.id_cliente
  LEFT JOIN usuarios   comp ON comp.id = s.id_comprador_asignado`;

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
    dias_vigencia = DIAS_VIGENCIA_DEFAULT,
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

  // Todo nace como Cotización, y el estatus depende de una sola cosa: si algo
  // de lo que pidió el cliente no hay en existencia, Compras tiene que
  // conseguir precio y tiempo de entrega antes de que esto se pueda mandar.
  // Si todo hay, el vendedor no espera a nadie.
  const hayFaltantes = itemsConExistencia.some(
    (it) => Number(it.existencia_real_almacen) < Number(it.cantidad_solicitada),
  );
  const estatusInicial = estatusInicialCotizacion(hayFaltantes);

  return withTransaction(async (ejecutar) => {
    // 1) Encabezado. El folio lo genera el DEFAULT de la columna, y es el que
    //    va a conservar toda su vida: si el cliente aprueba, este mismo
    //    renglón se vuelve Pedido sin cambiar de folio.
    const [cabecera] = await ejecutar(
      `INSERT INTO solicitudes_compras
         (tipo, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
          observaciones, dias_vigencia)
              VALUES (@tipo, @vendedor, @sucursal, @cliente::int, @prioridad, @estatus,
                      @observaciones::text, @vigencia)
       RETURNING *`,
      {
        tipo: TIPOS.COTIZACION,
        vendedor: id_vendedor,
        sucursal: id_sucursal,
        cliente: id_cliente,
        prioridad,
        estatus: estatusInicial,
        observaciones: observaciones,
        vigencia: Number(dias_vigencia) || DIAS_VIGENCIA_DEFAULT,
      },
    );

    // 2) Partidas.
    const detalle = [];
    for (const it of itemsConExistencia) {
      const [fila] = await ejecutar(
        // precio_cotizado nace igual al estimado, pero son cosas distintas:
        // mientras la cotización no se haya enviado, el precio se puede
        // refrescar. En el momento de enviarla se congela y ya no se toca.
        `INSERT INTO solicitudes_detalle
           (id_solicitud, sku_producto, descripcion, cantidad_solicitada,
            existencia_real_almacen, precio_estimado, precio_cotizado,
            precio_lista_actual, precio_actualizado_en)
                  VALUES (@solicitud, @sku, @descripcion, @cantidad, @existencia,
                          @precio::numeric, @precio::numeric, @precio::numeric, NOW())
         RETURNING *`,
        {
          solicitud: cabecera.id,
          sku: it.sku_producto,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad_solicitada),
          existencia: Number(it.existencia_real_almacen),
          precio: it.precio_estimado ?? null,
        },
      );
      detalle.push(fila);
    }

    // 3) Primer movimiento del historial.
    await ejecutar(
      `INSERT INTO solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES (@solicitud, @usuario, NULL, @estatus, @comentario)`,
      {
        solicitud: cabecera.id,
        usuario: id_vendedor,
        estatus: estatusInicial,
        comentario: hayFaltantes
          ? 'Cotización creada. Hay faltantes: pasa a Compras para precio y tiempo de entrega.'
          : 'Cotización creada. Todo en existencia: lista para enviar al cliente.',
      },
    );

    return { ...cabecera, detalle, hay_faltantes: hayFaltantes };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PRECIOS: EL CONGELADO Y EL VIVO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consulta en Quiter el precio de hoy de una lista de SKUs.
 *
 * Devuelve un Map sku(minúsculas) -> precio. Los SKUs que la API no reconozca
 * simplemente no aparecen: se prefiere no saber a inventar un precio.
 *
 * Va de uno en uno porque el endpoint de existencias es por término de
 * búsqueda; son cotizaciones de pocas partidas, no catálogos completos, y el
 * ERP ya trae caché de 30 segundos delante.
 */
async function preciosDeHoy(skus) {
  const precios = new Map();

  await Promise.all([...new Set(skus)].map(async (sku) => {
    try {
      const { articulos, origen } = await consultarExistencias({ termino: sku });
      // Si hay un ERP de verdad configurado pero no contestó, NO se toca nada:
      // pisar un precio real con uno de respaldo lo dejaría guardado como
      // bueno y nadie se enteraría.
      if (!precioConfiable(origen)) return;

      const exacto = articulos.find(
        (a) => a.sku.toLowerCase() === String(sku).toLowerCase(),
      );
      if (exacto && Number.isFinite(Number(exacto.precio_lista))) {
        precios.set(String(sku).toLowerCase(), Number(exacto.precio_lista));
      }
    } catch {
      // Un SKU que no se pudo consultar no debe tumbar a los demás.
    }
  }));

  return precios;
}

/**
 * Refresca el precio de Quiter en las partidas de un documento.
 *
 * Lo que hace depende de si el cliente ya vio la cotización o no:
 *
 *   NO enviada  -> se actualiza el precio de trabajo (precio_estimado y
 *                  precio_cotizado). Todavía no hay nada prometido.
 *   YA enviada  -> se actualiza ÚNICAMENTE precio_lista_actual. El precio
 *                  cotizado no se toca nunca: es lo que trae el cliente en la
 *                  mano. Lo que se gana es poder avisar que subió.
 *
 * @returns {Promise<{partidas:number, cambios:Array}>}
 */
export async function refrescarPrecios(id) {
  const cabecera = await queryUno(
    'SELECT id, tipo, estatus_actual FROM solicitudes_compras WHERE id = @id',
    { id: Number(id) },
  );
  if (!cabecera) throw notFound(`No existe el documento ${id}`);

  const partidas = await query(
    `SELECT id, sku_producto, descripcion, precio_cotizado, precio_lista_actual
     FROM   solicitudes_detalle WHERE id_solicitud = @id ORDER BY id`,
    { id: Number(id) },
  );
  if (!partidas.length) return { partidas: 0, cambios: [] };

  const congelado = yaSeCongelo(cabecera);
  const precios = await preciosDeHoy(partidas.map((p) => p.sku_producto));

  const cambios = [];
  for (const partida of partidas) {
    const nuevo = precios.get(partida.sku_producto.toLowerCase());
    if (nuevo === undefined) continue;

    const cotizado = partida.precio_cotizado === null ? null : Number(partida.precio_cotizado);

    await query(
      congelado
        // Ya enviada: solo la columna del precio vivo.
        ? `UPDATE solicitudes_detalle
              SET precio_lista_actual = @precio, precio_actualizado_en = NOW()
            WHERE id = @id`
        // Todavía no enviada: se mueve también el precio de trabajo.
        : `UPDATE solicitudes_detalle
              SET precio_lista_actual = @precio,
                  precio_estimado     = @precio,
                  precio_cotizado     = @precio,
                  precio_actualizado_en = NOW()
            WHERE id = @id`,
      { precio: nuevo, id: partida.id },
    );

    if (cotizado !== null && Math.abs(nuevo - cotizado) >= 0.01) {
      cambios.push({
        id_partida: partida.id,
        sku_producto: partida.sku_producto,
        descripcion: partida.descripcion,
        precio_cotizado: cotizado,
        precio_actual: nuevo,
        diferencia: Number((nuevo - cotizado).toFixed(2)),
        porcentaje: cotizado === 0 ? null
          : Number((((nuevo - cotizado) / cotizado) * 100).toFixed(1)),
      });
    }
  }

  return { partidas: partidas.length, cambios, congelado };
}

/**
 * ¿Este documento ya tiene su precio comprometido con el cliente?
 * Una cotización enviada, y cualquier pedido (que nació de una enviada).
 */
const yaSeCongelo = (documento) =>
  documento?.tipo === TIPOS.PEDIDO || documento?.estatus_actual === ESTATUS.ENVIADA;

// ─────────────────────────────────────────────────────────────────────────────
// ENVIAR AL CLIENTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca la cotización como enviada al cliente.
 *
 * Aquí pasan las tres cosas que definen el resto de su vida:
 *   1. Se congela el precio: lo que el cliente vea es lo que se le respeta.
 *   2. Arranca el reloj: `vence_en` = hoy + los días de vigencia.
 *   3. Deja de ser editable.
 *
 * Antes de congelar se vuelve a preguntar a Quiter. Si el precio cambió desde
 * que el vendedor armó la cotización, NO se envía: se le avisa y decide él.
 * Mandarle al cliente un precio que ya no existe —o corregírselo en silencio
 * por debajo— son las dos peores salidas, y las dos son fáciles de escribir
 * por accidente.
 *
 * @param {object} opciones
 * @param {boolean} [opciones.confirmar]  enviar aunque el precio haya cambiado
 */
export async function enviarAlCliente({ id, id_usuario, dias_vigencia, confirmar = false }) {
  const cabecera = await queryUno(
    `SELECT id, folio, tipo, estatus_actual, id_vendedor, dias_vigencia
     FROM   solicitudes_compras WHERE id = @id`,
    { id: Number(id) },
  );
  if (!cabecera) throw notFound(`No existe la cotización ${id}`);

  if (cabecera.tipo !== TIPOS.COTIZACION) {
    throw conflict(`El folio ${cabecera.folio} ya es un Pedido: no se puede volver a enviar como cotización.`);
  }
  if (cabecera.estatus_actual === ESTATUS.ENVIADA) {
    throw conflict(`La cotización ${cabecera.folio} ya está enviada.`);
  }
  if (![ESTATUS.BORRADOR, ESTATUS.CON_COMPRAS].includes(cabecera.estatus_actual)) {
    throw conflict(`Una cotización ${cabecera.estatus_actual} ya no se puede enviar.`);
  }

  // Última consulta a Quiter antes de comprometer el precio.
  const { cambios } = await refrescarPrecios(id);
  if (cambios.length && !confirmar) {
    throw conflict(
      'El precio de Quiter cambió desde que armaste la cotización. Revísalo antes de enviarla.',
      cambios,
    );
  }

  const dias = Number(dias_vigencia) || Number(cabecera.dias_vigencia) || DIAS_VIGENCIA_DEFAULT;

  return withTransaction(async (ejecutar) => {
    // El precio vivo que se acaba de traer pasa a ser el precio prometido, y
    // a partir de este segundo las dos columnas viven vidas separadas.
    await ejecutar(
      `UPDATE solicitudes_detalle
          SET precio_cotizado = COALESCE(precio_lista_actual, precio_cotizado, precio_estimado)
        WHERE id_solicitud = @id`,
      { id: Number(id) },
    );

    const [enviada] = await ejecutar(
      `UPDATE solicitudes_compras
          SET estatus_actual = @estatus,
              enviada_en     = NOW(),
              dias_vigencia  = @dias::int,
              -- El ::int no es adorno: sin él, PostgreSQL deduce un tipo para
              -- @dias en la asignación de arriba (entero) y otro distinto en
              -- esta multiplicación, y se niega a ejecutar la consulta.
              vence_en       = NOW() + (@dias::int * INTERVAL '1 day'),
              actualizado_en = NOW()
        WHERE id = @id
    RETURNING id, folio, tipo, estatus_actual, enviada_en, vence_en, dias_vigencia`,
      { estatus: ESTATUS.ENVIADA, dias, id: Number(id) },
    );

    await ejecutar(
      `INSERT INTO solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES (@id, @usuario, @anterior, @nuevo, @comentario)`,
      {
        id: Number(id),
        usuario: id_usuario,
        anterior: cabecera.estatus_actual,
        nuevo: ESTATUS.ENVIADA,
        comentario: `Cotización enviada al cliente. Precios congelados, vigencia de ${dias} días.`,
      },
    );

    return enviada;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERTIR EN PEDIDO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El cliente aprobó: la cotización se vuelve Pedido.
 *
 * No se copia a ningún lado. Es el MISMO renglón, con el mismo id y el mismo
 * folio, que cambia de tipo — que es justo lo que se pidió. El efecto de lado
 * bueno es que la bitácora queda de un solo hilo: se puede leer la vida entera
 * del folio, desde que se cotizó hasta que se recibió, sin brincar de un
 * documento a otro.
 *
 * El precio cotizado NO se toca: es lo que se le prometió al cliente y es lo
 * que se le va a cobrar, haya subido lo que haya subido en Quiter.
 */
export async function convertirAPedido({ id, usuario, comentario }) {
  return withTransaction(async (ejecutar) => {
    const [cotizacion] = await ejecutar(
      `SELECT id, folio, tipo, estatus_actual, id_vendedor
       FROM   solicitudes_compras
       WHERE  id = @id
       FOR UPDATE`,
      { id: Number(id) },
    );
    if (!cotizacion) throw notFound(`No existe la cotización ${id}`);

    if (!puedeConvertir(cotizacion)) {
      throw conflict(
        cotizacion.tipo === TIPOS.PEDIDO
          ? `El folio ${cotizacion.folio} ya es un Pedido.`
          : `Solo se puede convertir una cotización que ya se envió al cliente. `
            + `${cotizacion.folio} está en "${cotizacion.estatus_actual}".`,
      );
    }

    if (!puedeConvertirlo(usuario, cotizacion)) {
      throw forbidden(
        `La cotización ${cotizacion.folio} es de otro vendedor. `
        + 'La puede cerrar quien la levantó, o cualquier Comprador.',
      );
    }

    // Un pedido recién aprobado entra al flujo de Compras como Pendiente.
    const [pedido] = await ejecutar(
      `UPDATE solicitudes_compras
          SET tipo           = @tipo,
              estatus_actual = @estatus,
              convertida_en  = NOW(),
              actualizado_en = NOW()
        WHERE id = @id
    RETURNING id, folio, tipo, estatus_actual, enviada_en, vence_en, convertida_en,
              id_vendedor, id_sucursal, id_cliente, prioridad, fecha_creacion`,
      { tipo: TIPOS.PEDIDO, estatus: ESTATUS.PENDIENTE, id: Number(id) },
    );

    await ejecutar(
      `INSERT INTO solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES (@id, @usuario, @anterior, @nuevo, @comentario)`,
      {
        id: Number(id),
        usuario: usuario.id,
        anterior: ESTATUS.ENVIADA,
        nuevo: ESTATUS.PENDIENTE,
        comentario: comentario
          || `Cliente aprobó la cotización. Mismo folio ${cotizacion.folio}, ahora Pedido.`,
      },
    );

    return pedido;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VENCIMIENTO AUTOMÁTICO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vence las cotizaciones enviadas cuyo plazo ya pasó.
 *
 * La usa el vigía, pero está aquí y no allá para que sea una sola instrucción:
 * el UPDATE selecciona y escribe a la vez, así que dos vigías corriendo al
 * mismo tiempo no pueden vencer la misma cotización dos veces ni dejar la
 * bitácora con movimientos repetidos.
 *
 * @param {number} [limite] tope por corrida, para no atorar la base
 */
export async function vencerCotizacionesCaducadas(limite = 500) {
  const vencidas = await query(
    `UPDATE solicitudes_compras
        SET estatus_actual = @vencida,
            fecha_cierre   = NOW(),
            actualizado_en = NOW()
      WHERE id IN (
            SELECT id FROM solicitudes_compras
             WHERE tipo           = @tipo
               AND estatus_actual = @enviada
               AND vence_en IS NOT NULL
               AND vence_en <= NOW()
             ORDER BY vence_en
             LIMIT @limite
             FOR UPDATE SKIP LOCKED
      )
  RETURNING id, folio, id_vendedor, vence_en, dias_vigencia`,
    {
      vencida: ESTATUS.VENCIDA, tipo: TIPOS.COTIZACION,
      enviada: ESTATUS.ENVIADA, limite: Number(limite),
    },
  );

  // La bitácora se firma con el vendedor de cada cotización: no hay un usuario
  // "sistema" en la tabla de usuarios, y el historial exige un id real. Queda
  // claro de todas formas por el comentario.
  for (const v of vencidas) {
    await query(
      `INSERT INTO solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES (@id, @usuario, @anterior, @nuevo, @comentario)`,
      {
        id: v.id,
        usuario: v.id_vendedor,
        anterior: ESTATUS.ENVIADA,
        nuevo: ESTATUS.VENCIDA,
        comentario: `Vencida automáticamente: pasaron ${v.dias_vigencia} días sin respuesta del cliente.`,
      },
    );
  }

  return vencidas;
}

/**
 * Ids de los documentos a los que vale la pena refrescarles el precio.
 *
 * Solo lo que sigue vivo: cotizaciones sin responder y pedidos que aún no se
 * reciben. Una cotización vencida o un pedido cerrado ya no le importan a
 * nadie, y consultarlos sería castigar al ERP de a gratis.
 */
export async function documentosParaRefrescarPrecio(limite = 200) {
  return query(
    `SELECT id, folio, tipo, estatus_actual
     FROM   solicitudes_compras
     WHERE  estatus_actual IN (@borrador, @conCompras, @enviada, @pendiente, @conProveedor, @autorizada)
     ORDER BY actualizado_en DESC
     LIMIT  @limite`,
    {
      borrador: ESTATUS.BORRADOR,
      conCompras: ESTATUS.CON_COMPRAS,
      enviada: ESTATUS.ENVIADA,
      pendiente: ESTATUS.PENDIENTE,
      conProveedor: ESTATUS.CON_PROVEEDOR,
      autorizada: ESTATUS.AUTORIZADA,
      limite: Number(limite),
    },
  );
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
    tipo, id_vendedor, prioridad, estatus, sucursal,
    desde, hasta, busqueda,
    limite = 50, pagina = 1,
  } = filtros;

  const where = [];
  const params = {};

  // Sin tipo se devuelve todo, que es lo que quiere el buscador por folio: el
  // mismo número puede ser cotización hoy y pedido mañana, y quien lo teclea
  // no debería tener que acordarse de en qué pestaña anda.
  if (tipo)        { params.tipo = tipo;                    where.push('s.tipo = @tipo'); }
  if (id_vendedor) { params.vendedor = Number(id_vendedor); where.push('s.id_vendedor = @vendedor'); }
  if (sucursal)    { params.sucursal = Number(sucursal);    where.push('s.id_sucursal = @sucursal'); }
  if (prioridad)   { params.prioridad = prioridad;          where.push('s.prioridad = @prioridad'); }
  if (desde)       { params.desde = new Date(desde); where.push('s.fecha_creacion >= @desde'); }
  if (hasta)       { params.hasta = new Date(hasta); where.push('s.fecha_creacion <= @hasta'); }

  // Búsqueda libre por folio o nombre de cliente.
  if (busqueda) {
    params.busqueda = `%${busqueda}%`;
    // ILIKE, no LIKE: en PostgreSQL, LIKE distingue mayúsculas de minúsculas.
    // Quien busca "norte" espera encontrar "Transportes del Norte".
    where.push('(s.folio ILIKE @busqueda OR c.nombre ILIKE @busqueda)');
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
           COALESCE(SUM(d.cantidad_solicitada), 0)                              AS total_piezas,
           -- El monto se calcula con el precio COTIZADO, no con el vivo: es lo
           -- que se le va a cobrar al cliente, que es lo que se quiere sumar.
           COALESCE(SUM(d.cantidad_solicitada * COALESCE(d.precio_cotizado, d.precio_estimado, 0)), 0) AS monto_estimado,
           -- Cuántas partidas subieron de precio en Quiter desde que se cotizó.
           -- Con esto la lista puede pintar el aviso amarillo sin abrir el
           -- documento uno por uno.
           COUNT(*) FILTER (
             WHERE d.precio_lista_actual IS NOT NULL
               AND d.precio_cotizado     IS NOT NULL
               AND d.precio_lista_actual > d.precio_cotizado + 0.01
           ) AS partidas_con_alza,
           -- Días transcurridos desde el alta (resalta las solicitudes añejas)
           ROUND((EXTRACT(EPOCH FROM (NOW() - s.fecha_creacion)) / 86400.0)::NUMERIC, 1) AS dias_abierta
    ${FROM_CABECERA}
    LEFT JOIN solicitudes_detalle d ON d.id_solicitud = s.id
    ${clausula}
    GROUP BY s.id, s.folio, s.tipo, s.enviada_en, s.vence_en, s.convertida_en,
             s.dias_vigencia, s.id_vendedor, s.id_sucursal, s.id_cliente, s.prioridad,
             s.estatus_actual, s.observaciones, s.fecha_creacion, s.fecha_promesa_entrega,
             s.fecha_cierre, s.id_comprador_asignado, s.actualizado_en,
             u.nombre, su.nombre, su.clave, c.nombre, comp.nombre
    ORDER BY -- Urgente primero, luego lo más viejo arriba
             CASE s.prioridad WHEN 'Urgente' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
             s.fecha_creacion ASC
    LIMIT @limite OFFSET @offset
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
      `SELECT * FROM solicitudes_detalle
       WHERE id_solicitud = @id ORDER BY id`,
      { id: Number(id) },
    ),
    query(
      `SELECT h.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM      solicitud_historial h
       JOIN      usuarios u ON u.id = h.id_usuario
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
 * El SELECT lleva FOR UPDATE: reserva el renglón hasta que termine la
 * transacción, para que dos compradores no muevan el mismo folio al mismo
 * tiempo. Sin eso, los dos leerían "Pendiente", los dos verían la transición
 * como válida, y el segundo pisaría al primero dejando el historial con un
 * movimiento que nunca ocurrió.
 */
export async function cambiarEstatus({ id, id_usuario, estatus_nuevo, comentario, fecha_promesa_entrega, asignarme }) {
  return withTransaction(async (ejecutar) => {
    const [actual] = await ejecutar(
      `SELECT id, estatus_actual
       FROM   solicitudes_compras
       WHERE  id = @id
       FOR UPDATE`,
      { id: Number(id) },
    );
    if (!actual) throw notFound(`No existe la solicitud ${id}`);

    const estatus_anterior = actual.estatus_actual;

    // Al cerrar la solicitud sellamos la fecha de cierre: alimenta el KPI
    // de tiempo promedio de atención.
    const cierra = ESTATUS_FINALES.includes(estatus_nuevo);

    const [actualizada] = await ejecutar(
      `UPDATE solicitudes_compras
          SET estatus_actual        = @estatus,
              fecha_promesa_entrega = COALESCE(@promesa::date, fecha_promesa_entrega),
              fecha_cierre          = CASE WHEN @cierra THEN NOW() ELSE fecha_cierre END,
              id_comprador_asignado = CASE WHEN @asignar THEN @usuario ELSE id_comprador_asignado END,
              actualizado_en        = NOW()
        WHERE id = @id
    RETURNING id, folio, id_vendedor, id_sucursal, id_cliente, prioridad,
              estatus_actual, observaciones, fecha_creacion,
              TO_CHAR(fecha_promesa_entrega, 'YYYY-MM-DD') AS fecha_promesa_entrega,
              fecha_cierre, id_comprador_asignado, actualizado_en`,
      {
        estatus: estatus_nuevo,
        promesa: fecha_promesa_entrega || null,
        cierra: cierra,
        asignar: Boolean(asignarme),
        usuario: id_usuario,
        id: Number(id),
      },
    );

    await ejecutar(
      `INSERT INTO solicitud_historial
         (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
       VALUES (@id, @usuario, @anterior::text, @nuevo, @comentario::text)`,
      {
        id: Number(id),
        usuario: id_usuario,
        anterior: estatus_anterior,
        nuevo: estatus_nuevo,
        comentario: comentario || null,
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

  const ventana = `s.fecha_creacion >= NOW() - (@dias * INTERVAL '1 day')${filtroSucursal}`;

  // 1) Conteo por estatus
  const porEstatus = query(`
    SELECT s.estatus_actual AS estatus, COUNT(*) AS total
    FROM   solicitudes_compras s
    WHERE  ${ventana}
    GROUP BY s.estatus_actual
    ORDER BY total DESC`, params);

  // 2) Conteo por prioridad
  const porPrioridad = query(`
    SELECT s.prioridad, COUNT(*) AS total
    FROM   solicitudes_compras s
    WHERE  ${ventana}
    GROUP BY s.prioridad`, params);

  // 3) Productos más solicitados SIN existencia al momento de pedirlos
  const topFaltantes = query(`
    SELECT
           d.sku_producto,
           MIN(d.descripcion)          AS descripcion,
           COUNT(DISTINCT s.id)        AS veces_solicitado,
           SUM(d.cantidad_solicitada)  AS piezas_solicitadas,
           COUNT(DISTINCT s.id_sucursal) AS sucursales_afectadas
    FROM   solicitudes_detalle d
    JOIN   solicitudes_compras s ON s.id = d.id_solicitud
    WHERE  d.existencia_real_almacen <= 0 AND ${ventana}
    GROUP BY d.sku_producto
    ORDER BY veces_solicitado DESC, piezas_solicitadas DESC`, params);

  // 4) Tiempo promedio de atención (solo solicitudes cerradas)
  const tiempos = query(`
    SELECT ROUND((AVG(EXTRACT(EPOCH FROM (s.fecha_cierre - s.fecha_creacion))) / 3600.0)::NUMERIC, 1)  AS horas_promedio,
           ROUND((AVG(EXTRACT(EPOCH FROM (s.fecha_cierre - s.fecha_creacion))) / 86400.0)::NUMERIC, 1) AS dias_promedio,
           COUNT(*) AS solicitudes_cerradas
    FROM   solicitudes_compras s
    WHERE  s.fecha_cierre IS NOT NULL AND ${ventana}`, params);

  // 5) Totales e indicadores de riesgo
  const totales = query(`
    SELECT COUNT(*) AS total_solicitudes,
           SUM(CASE WHEN s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS abiertas,
           SUM(CASE WHEN s.prioridad = 'Urgente'
                     AND s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS urgentes_abiertas,
           SUM(CASE WHEN s.fecha_promesa_entrega < CURRENT_DATE
                     AND s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS vencidas,
           COALESCE(SUM(sub.monto), 0) AS monto_estimado_total
    FROM   solicitudes_compras s
    LEFT JOIN (
      SELECT id_solicitud, SUM(cantidad_solicitada * COALESCE(precio_estimado, 0)) AS monto
      FROM   solicitudes_detalle GROUP BY id_solicitud
    ) sub ON sub.id_solicitud = s.id
    WHERE  ${ventana}`, params);

  // 6) Carga por sucursal
  const porSucursal = query(`
    SELECT su.clave, su.nombre,
           COUNT(*) AS total,
           SUM(CASE WHEN s.estatus_actual NOT IN ${CERRADOS_SQL} THEN 1 ELSE 0 END) AS abiertas
    FROM   solicitudes_compras s
    JOIN   sucursales su ON su.id = s.id_sucursal
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
