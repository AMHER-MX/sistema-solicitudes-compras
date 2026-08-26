/**
 * Máquina de estados del sistema.
 *
 * Hay DOS documentos, no dos tablas: una Cotización que el cliente aprueba se
 * vuelve Pedido conservando su id, su folio y su bitácora. Por eso el tipo es
 * un campo del mismo renglón y no una copia a otro lado.
 *
 * Centralizar esto evita que una pantalla o un endpoint dejen un documento en
 * una combinación imposible (un Pedido "Vencido", una Cotización "En Transito",
 * un 'Recibido' que regresa a 'Pendiente').
 *
 * SOBRE 'Con Proveedor'
 *   Antes se llamaba 'En Cotizacion' y nunca significó "cotización al cliente":
 *   significaba "Compras está pidiendo precio al proveedor". Al aparecer el
 *   documento Cotización había que elegir, porque la misma palabra para dos
 *   cosas distintas en la misma pantalla no la entiende nadie.
 */

export const TIPOS = {
  COTIZACION: 'Cotizacion',
  PEDIDO:     'Pedido',
};

export const ESTATUS = {
  // ── Cotización: lo que ve el cliente ──────────────────────────────────────
  BORRADOR:      'Borrador',      // el vendedor la está armando
  CON_COMPRAS:   'Con Compras',   // hay faltantes; Compras consigue precio y tiempo
  ENVIADA:       'Enviada',       // ya la tiene el cliente. Aquí corre el reloj.
  VENCIDA:       'Vencida',       // pasó su plazo sin respuesta

  // ── Pedido: lo que ya se está surtiendo ───────────────────────────────────
  PENDIENTE:     'Pendiente',
  CON_PROVEEDOR: 'Con Proveedor', // antes 'En Cotizacion'
  AUTORIZADA:    'Autorizada',
  EN_TRANSITO:   'En Transito',
  RECIBIDO:      'Recibido',

  // ── Terminales de ambos ───────────────────────────────────────────────────
  CANCELADA:     'Cancelada',
  RECHAZADA:     'Rechazada',
};

export const PRIORIDADES = ['Urgente', 'Normal', 'Baja'];

export const ROLES = {
  VENDEDOR:  'Vendedor',
  COMPRADOR: 'Comprador',
  GERENTE:   'Gerente',
};

/** Días que vive una cotización enviada si el cliente no contesta. */
export const DIAS_VIGENCIA_DEFAULT = 30;

/** Qué estatus puede tener cada tipo de documento. */
export const ESTATUS_POR_TIPO = {
  [TIPOS.COTIZACION]: [
    ESTATUS.BORRADOR, ESTATUS.CON_COMPRAS, ESTATUS.ENVIADA,
    ESTATUS.VENCIDA, ESTATUS.CANCELADA,
  ],
  [TIPOS.PEDIDO]: [
    ESTATUS.PENDIENTE, ESTATUS.CON_PROVEEDOR, ESTATUS.AUTORIZADA,
    ESTATUS.EN_TRANSITO, ESTATUS.RECIBIDO, ESTATUS.CANCELADA, ESTATUS.RECHAZADA,
  ],
};

/** Estados que ya no admiten movimientos. */
export const ESTATUS_FINALES = [
  ESTATUS.RECIBIDO, ESTATUS.CANCELADA, ESTATUS.RECHAZADA, ESTATUS.VENCIDA,
];

/**
 * Transiciones permitidas DENTRO de un mismo tipo: origen -> [destinos].
 *
 * Pasar de Cotización a Pedido NO está aquí a propósito: no es un cambio de
 * estatus sino una conversión, con sus propias reglas de quién puede hacerla,
 * y vive en `puedeConvertir`.
 */
export const TRANSICIONES = {
  // ── Cotización ────────────────────────────────────────────────────────────
  // Con Compras solo cuando hay faltantes; si todo hay en existencia, el
  // vendedor manda directo sin esperar a nadie.
  [ESTATUS.BORRADOR]:    [ESTATUS.CON_COMPRAS, ESTATUS.ENVIADA, ESTATUS.CANCELADA],
  [ESTATUS.CON_COMPRAS]: [ESTATUS.ENVIADA, ESTATUS.BORRADOR, ESTATUS.CANCELADA],
  // De Enviada se sale por conversión (el cliente aprobó), por vencimiento
  // (lo hace el vigía solo) o a mano.
  [ESTATUS.ENVIADA]:     [ESTATUS.VENCIDA, ESTATUS.CANCELADA],
  [ESTATUS.VENCIDA]:     [],

  // ── Pedido ────────────────────────────────────────────────────────────────
  [ESTATUS.PENDIENTE]:     [ESTATUS.CON_PROVEEDOR, ESTATUS.AUTORIZADA, ESTATUS.RECHAZADA, ESTATUS.CANCELADA],
  [ESTATUS.CON_PROVEEDOR]: [ESTATUS.AUTORIZADA, ESTATUS.EN_TRANSITO, ESTATUS.RECHAZADA, ESTATUS.CANCELADA],
  [ESTATUS.AUTORIZADA]:    [ESTATUS.EN_TRANSITO, ESTATUS.CANCELADA],
  [ESTATUS.EN_TRANSITO]:   [ESTATUS.RECIBIDO, ESTATUS.CANCELADA],
  [ESTATUS.RECIBIDO]:      [],

  // ── Terminales ────────────────────────────────────────────────────────────
  [ESTATUS.CANCELADA]:   [],
  [ESTATUS.RECHAZADA]:   [],
};

export const esTipoValido    = (t) => Object.values(TIPOS).includes(t);
export const esEstatusValido = (e) => Object.values(ESTATUS).includes(e);

/** ¿Ese estatus corresponde a ese tipo de documento? */
export const estatusCorrespondeATipo = (tipo, estatus) =>
  Array.isArray(ESTATUS_POR_TIPO[tipo]) && ESTATUS_POR_TIPO[tipo].includes(estatus);

/** ¿Se puede pasar de `actual` a `nuevo`? */
export const transicionPermitida = (actual, nuevo) =>
  Array.isArray(TRANSICIONES[actual]) && TRANSICIONES[actual].includes(nuevo);

/** Estados que la UI puede ofrecer desde el estatus actual. */
export const siguientesEstatus = (actual) => TRANSICIONES[actual] ?? [];

/**
 * ¿Este documento se puede convertir en Pedido?
 *
 * Solo una cotización que el cliente ya vio. Un borrador no: nadie lo ha
 * aprobado todavía, y una vencida tampoco: para eso se recotiza.
 */
export const puedeConvertir = (documento) =>
  documento?.tipo === TIPOS.COTIZACION && documento?.estatus_actual === ESTATUS.ENVIADA;

/**
 * ¿Este usuario puede convertir la cotización en pedido?
 *
 * Decisión del negocio: el vendedor que la levantó, o cualquier Comprador —
 * porque a veces el cliente le habla directo a Compras, o el vendedor anda de
 * vacaciones y el pedido no se puede quedar esperando. El Gerente puede todo.
 */
export function puedeConvertirlo(usuario, documento) {
  if (!usuario) return false;
  if (usuario.rol === ROLES.GERENTE)   return true;
  if (usuario.rol === ROLES.COMPRADOR) return true;
  return Number(documento?.id_vendedor) === Number(usuario.id);
}

/**
 * Estatus con el que arranca una cotización recién capturada.
 *
 * Si algo de lo que pide el cliente no hay en existencia, la cotización no se
 * puede mandar todavía: Compras tiene que conseguir precio y tiempo de entrega
 * de lo que falta. Si todo hay, el vendedor no espera a nadie.
 */
export const estatusInicialCotizacion = (hayFaltantes) =>
  (hayFaltantes ? ESTATUS.CON_COMPRAS : ESTATUS.BORRADOR);
