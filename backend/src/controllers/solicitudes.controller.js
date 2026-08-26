/**
 * Controlador de solicitudes de compra.
 *
 *  POST   /api/solicitudes
 *  GET    /api/solicitudes            (filtros: id_vendedor, prioridad, estatus, sucursal)
 *  GET    /api/solicitudes/:id
 *  PATCH  /api/solicitudes/:id/estatus
 */
import {
  cambiarEstatus, convertirAPedido, crearSolicitud, enviarAlCliente,
  listarSolicitudes, obtenerSolicitud, refrescarPrecios,
} from '../services/solicitudes.service.js';
import {
  DIAS_VIGENCIA_DEFAULT, ESTATUS, PRIORIDADES, ROLES, TIPOS,
  esEstatusValido, esTipoValido, puedeConvertir, puedeConvertirlo,
  siguientesEstatus, transicionPermitida,
} from '../utils/estatus.js';
import { badRequest, conflict, forbidden } from '../utils/errors.js';

/**
 * Un Vendedor solo puede ver y mover lo suyo. Compras y Gerencia, todo.
 * Se usa en cada endpoint que recibe un :id, porque el id lo pone quien llama.
 */
function exigirAcceso(usuario, documento) {
  if (usuario.rol === ROLES.VENDEDOR && documento.id_vendedor !== usuario.id) {
    throw forbidden('Solo puedes trabajar con tus propias cotizaciones y pedidos');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/solicitudes
// ─────────────────────────────────────────────────────────────────────────────
export async function crear(req, res) {
  const {
    id_cliente = null, prioridad = 'Normal', observaciones = null,
    items, id_sucursal, almacen_erp, dias_vigencia = DIAS_VIGENCIA_DEFAULT,
  } = req.body ?? {};

  // --- Validaciones de entrada ---------------------------------------------
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('La solicitud debe incluir al menos una partida en `items`');
  }
  if (!PRIORIDADES.includes(prioridad)) {
    throw badRequest(`Prioridad inválida. Opciones: ${PRIORIDADES.join(', ')}`);
  }

  const vigencia = Number(dias_vigencia);
  if (!Number.isInteger(vigencia) || vigencia < 1 || vigencia > 365) {
    throw badRequest('`dias_vigencia` debe ser un número entero de 1 a 365 días');
  }

  items.forEach((it, i) => {
    if (!it.sku_producto) throw badRequest(`items[${i}]: falta sku_producto`);
    if (!it.descripcion)  throw badRequest(`items[${i}]: falta descripcion`);
    const cant = Number(it.cantidad_solicitada);
    if (!Number.isFinite(cant) || cant <= 0) {
      throw badRequest(`items[${i}]: cantidad_solicitada debe ser mayor a 0`);
    }
  });

  // El vendedor siempre levanta la solicitud a su nombre y sucursal.
  // Un Gerente/Comprador sí puede capturar a nombre de otra sucursal.
  const sucursalFinal = req.usuario.rol === ROLES.VENDEDOR
    ? req.usuario.sucursal_id
    : (id_sucursal ?? req.usuario.sucursal_id);

  if (!sucursalFinal) {
    throw badRequest('El usuario no tiene sucursal asignada; envía `id_sucursal`');
  }

  const solicitud = await crearSolicitud({
    id_vendedor: req.usuario.id,
    id_sucursal: sucursalFinal,
    id_cliente,
    prioridad,
    observaciones,
    items,
    almacen_erp,
    dias_vigencia: vigencia,
  });

  res.status(201).json({
    ok: true,
    solicitud,
    // La UI decide con esto si mostrar "Enviar al cliente" ya, o el aviso de
    // que Compras tiene que conseguir precio de los faltantes primero.
    aviso: solicitud.hay_faltantes
      ? 'Hay partidas sin existencia. La cotización pasó a Compras para conseguir precio y tiempo de entrega.'
      : 'Todo en existencia. Ya puedes enviarla al cliente.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/solicitudes
// ─────────────────────────────────────────────────────────────────────────────
export async function listar(req, res) {
  if (req.query.tipo && !esTipoValido(req.query.tipo)) {
    throw badRequest(`Tipo inválido. Opciones: ${Object.values(TIPOS).join(', ')}`);
  }

  const filtros = {
    tipo:        req.query.tipo,
    id_vendedor: req.query.id_vendedor,
    prioridad:   req.query.prioridad,
    estatus:     req.query.estatus,
    sucursal:    req.query.sucursal,
    desde:       req.query.desde,
    hasta:       req.query.hasta,
    busqueda:    req.query.busqueda,
    limite:      req.query.limite,
    pagina:      req.query.pagina,
  };

  // Regla de negocio: un Vendedor solo ve sus propias solicitudes,
  // aunque intente mandar otro id_vendedor en la query.
  if (req.usuario.rol === ROLES.VENDEDOR) {
    filtros.id_vendedor = req.usuario.id;
  }

  const solicitudes = await listarSolicitudes(filtros);
  res.json({ ok: true, total: solicitudes.length, solicitudes });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/solicitudes/:id
// ─────────────────────────────────────────────────────────────────────────────
export async function detalle(req, res) {
  const solicitud = await obtenerSolicitud(Number(req.params.id));
  exigirAcceso(req.usuario, solicitud);

  res.json({
    ok: true,
    solicitud,
    // La UI usa esto para poblar el select de cambio de estatus.
    estatus_disponibles: siguientesEstatus(solicitud.estatus_actual),
    // ...y estos dos para decidir qué botones dibuja. Se calculan aquí, con
    // las mismas reglas que aplica el servidor al ejecutarlos, para que la
    // pantalla nunca ofrezca un botón que va a acabar en error.
    acciones: {
      puede_enviar: solicitud.tipo === TIPOS.COTIZACION
        && [ESTATUS.BORRADOR, ESTATUS.CON_COMPRAS].includes(solicitud.estatus_actual),
      puede_convertir: puedeConvertir(solicitud) && puedeConvertirlo(req.usuario, solicitud),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/solicitudes/:id/enviar   -> la cotización se va al cliente
// ─────────────────────────────────────────────────────────────────────────────
export async function enviar(req, res) {
  const id = Number(req.params.id);
  const { dias_vigencia, confirmar = false } = req.body ?? {};

  const actual = await obtenerSolicitud(id);
  exigirAcceso(req.usuario, actual);

  if (dias_vigencia !== undefined) {
    const v = Number(dias_vigencia);
    if (!Number.isInteger(v) || v < 1 || v > 365) {
      throw badRequest('`dias_vigencia` debe ser un número entero de 1 a 365 días');
    }
  }

  // El servicio lanza 409 con la lista de partidas si el precio cambió y no
  // se confirmó. Ese 409 es información, no un fallo: la UI lo muestra y
  // vuelve a llamar con confirmar:true si el vendedor acepta.
  const cotizacion = await enviarAlCliente({
    id,
    id_usuario: req.usuario.id,
    dias_vigencia,
    confirmar: Boolean(confirmar),
  });

  res.json({
    ok: true,
    cotizacion,
    aviso: `Cotización ${cotizacion.folio} enviada. Los precios quedaron congelados `
         + `y vence en ${cotizacion.dias_vigencia} días si el cliente no responde.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/solicitudes/:id/convertir  -> el cliente aprobó: se vuelve Pedido
// ─────────────────────────────────────────────────────────────────────────────
export async function convertir(req, res) {
  const id = Number(req.params.id);
  const { comentario } = req.body ?? {};

  const pedido = await convertirAPedido({ id, usuario: req.usuario, comentario });

  res.json({
    ok: true,
    pedido,
    aviso: `El folio ${pedido.folio} ya es un Pedido y entró a la mesa de Compras. `
         + 'Es el mismo folio y el mismo precio que se le cotizó al cliente.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/solicitudes/:id/precios  -> vuelve a preguntarle a Quiter
// ─────────────────────────────────────────────────────────────────────────────
export async function actualizarPrecios(req, res) {
  const id = Number(req.params.id);

  const actual = await obtenerSolicitud(id);
  exigirAcceso(req.usuario, actual);

  const resultado = await refrescarPrecios(id);

  res.json({
    ok: true,
    ...resultado,
    aviso: resultado.congelado
      ? 'Los precios cotizados no se tocaron: es lo que se le prometió al cliente. '
        + 'Lo que se actualizó es la referencia de lo que cuesta hoy.'
      : 'Precios actualizados con lo que Quiter dice hoy.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/solicitudes/:id/estatus
// ─────────────────────────────────────────────────────────────────────────────
export async function actualizarEstatus(req, res) {
  const id = Number(req.params.id);
  const { estatus, comentario, fecha_promesa_entrega, asignarme = true } = req.body ?? {};

  if (!estatus) throw badRequest('Falta el campo `estatus`');
  if (!esEstatusValido(estatus)) {
    throw badRequest(`Estatus inválido. Opciones: ${Object.values(ESTATUS).join(', ')}`);
  }

  const actual = await obtenerSolicitud(id);
  exigirAcceso(req.usuario, actual);

  // Un Vendedor manda en su cotización, no en el pedido. Puede mandarla a
  // Compras, regresarla a borrador o cancelarla; el flujo de surtido —quién
  // consigue la pieza y cuándo llega— es de Compras y no se le mueve desde
  // el piso de venta.
  if (req.usuario.rol === ROLES.VENDEDOR && actual.tipo !== TIPOS.COTIZACION) {
    throw forbidden(
      `El folio ${actual.folio} ya es un Pedido. El avance lo registra Compras.`,
    );
  }

  // Validamos la transición contra la máquina de estados.
  if (!transicionPermitida(actual.estatus_actual, estatus)) {
    throw conflict(
      `No se permite pasar de "${actual.estatus_actual}" a "${estatus}"`,
      { permitidos: siguientesEstatus(actual.estatus_actual) },
    );
  }

  // Al poner una solicitud En Transito exigimos fecha de compromiso:
  // es el dato que el vendedor le promete al cliente.
  const promesa = fecha_promesa_entrega || actual.fecha_promesa_entrega;
  if (estatus === ESTATUS.EN_TRANSITO && !promesa) {
    throw badRequest('Para marcar "En Transito" se requiere `fecha_promesa_entrega`');
  }

  const solicitud = await cambiarEstatus({
    id,
    id_usuario: req.usuario.id,
    estatus_nuevo: estatus,
    comentario,
    fecha_promesa_entrega,
    asignarme: Boolean(asignarme) && req.usuario.rol !== ROLES.VENDEDOR,
  });

  res.json({
    ok: true,
    solicitud,
    estatus_disponibles: siguientesEstatus(solicitud.estatus_actual),
  });
}
