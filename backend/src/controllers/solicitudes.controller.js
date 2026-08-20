/**
 * Controlador de solicitudes de compra.
 *
 *  POST   /api/solicitudes
 *  GET    /api/solicitudes            (filtros: id_vendedor, prioridad, estatus, sucursal)
 *  GET    /api/solicitudes/:id
 *  PATCH  /api/solicitudes/:id/estatus
 */
import {
  cambiarEstatus, crearSolicitud, listarSolicitudes, obtenerSolicitud,
} from '../services/solicitudes.service.js';
import {
  ESTATUS, PRIORIDADES, ROLES, esEstatusValido, siguientesEstatus, transicionPermitida,
} from '../utils/estatus.js';
import { badRequest, conflict, forbidden } from '../utils/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/solicitudes
// ─────────────────────────────────────────────────────────────────────────────
export async function crear(req, res) {
  const {
    id_cliente = null, prioridad = 'Normal', observaciones = null,
    items, id_sucursal, almacen_erp,
  } = req.body ?? {};

  // --- Validaciones de entrada ---------------------------------------------
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('La solicitud debe incluir al menos una partida en `items`');
  }
  if (!PRIORIDADES.includes(prioridad)) {
    throw badRequest(`Prioridad inválida. Opciones: ${PRIORIDADES.join(', ')}`);
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
  });

  res.status(201).json({ ok: true, solicitud });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/solicitudes
// ─────────────────────────────────────────────────────────────────────────────
export async function listar(req, res) {
  const filtros = {
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

  if (req.usuario.rol === ROLES.VENDEDOR && solicitud.id_vendedor !== req.usuario.id) {
    throw forbidden('Solo puedes consultar tus propias solicitudes');
  }

  res.json({
    ok: true,
    solicitud,
    // La UI usa esto para poblar el select de cambio de estatus.
    estatus_disponibles: siguientesEstatus(solicitud.estatus_actual),
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
