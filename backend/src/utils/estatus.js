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

/**
 * Cómo va el trabajo de Compras SOBRE una cotización.
 *
 * Es un eje aparte de `ESTATUS`, y la diferencia importa:
 *
 *   ESTATUS          dónde va el documento      -> lo lee el vendedor y el cliente
 *   ESTATUS_COMPRAS  cómo va el trabajo interno -> lo lleva el comprador
 *
 * Un mismo folio puede estar 'Con Compras' (para el vendedor) y 'Cotizacion
 * Parcial' (para el comprador) al mismo tiempo, y las dos frases son ciertas.
 * Fundirlas en una sola columna obligaría al vendedor a aprenderse el
 * vocabulario de Compras para saber si ya puede mandarle algo a su cliente.
 */
export const ESTATUS_COMPRAS = {
  EN_COTIZACION: 'En Cotizacion',      // pidiendo precios a proveedores
  PARCIAL:       'Cotizacion Parcial', // consiguió unas partidas, otras no
  COMPLETADA:    'Completada',         // todo tiene precio y tiempo de entrega
  CANCELADA:     'Cancelada',          // no se consigue; el vendedor decide qué hacer
};

export const ESTATUS_COMPRAS_VALIDOS = Object.values(ESTATUS_COMPRAS);

/**
 * Compras puede moverse libremente entre sus cuatro estados.
 *
 * A diferencia del documento, aquí NO hay máquina de estados con transiciones
 * prohibidas, y es a propósito: conseguir precios no es un proceso lineal. Un
 * proveedor cancela y hay que volver a cotizar; llega un precio que faltaba y
 * lo Parcial se vuelve Completada. Ponerle candados a eso solo lograría que el
 * comprador dejara el estatus en el primero que le tocó y lo administrara por
 * WhatsApp, que es exactamente lo que este sistema vino a quitar.
 */
export const esEstatusComprasValido = (e) =>
  e === null || e === undefined || ESTATUS_COMPRAS_VALIDOS.includes(e);

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
 * ¿Se puede editar / recotizar este documento?
 *
 * Sí mientras sea una Cotización que todavía no se volvió Pedido. Incluidas la
 * Enviada y la Vencida: recotizar es precisamente lo que se hace con ellas.
 *
 * Un Pedido NO: ahí ya hay una orden de compra puesta con un proveedor, y
 * cambiarle las partidas por debajo dejaría el papel y el sistema diciendo
 * cosas distintas. Si un pedido cambia, se cancela y se levanta otro.
 */
export const puedeEditarse = (documento) =>
  documento?.tipo === TIPOS.COTIZACION
  && documento?.estatus_actual !== ESTATUS.CANCELADA;

/**
 * ¿Editar este documento obliga a recotizar (subir de versión)?
 *
 * Solo si el cliente ya lo vio. Corregir un borrador que nadie ha mirado no es
 * una recotización, es seguir capturando; contarlo como versión 2 llenaría la
 * bitácora de ruido y le quitaría significado al número justo cuando importa.
 */
export const requiereNuevaVersion = (documento) =>
  [ESTATUS.ENVIADA, ESTATUS.VENCIDA].includes(documento?.estatus_actual);

/**
 * A dónde regresa una cotización cuando se recotiza.
 *
 * Vuelve a manos de quien tenga que trabajarla y —esto es lo importante— deja
 * de estar Enviada: el reloj de vencimiento se reinicia cuando se vuelva a
 * mandar, no antes. Si se quedara Enviada, el cliente tendría en la mano un
 * papel que ya no coincide con el sistema y nadie se enteraría.
 */
export const estatusAlRecotizar = (hayPendientesDeCompras) =>
  (hayPendientesDeCompras ? ESTATUS.CON_COMPRAS : ESTATUS.BORRADOR);

/** ¿Quién puede tocar las partidas y los precios de este documento? */
export function puedeEditarlo(usuario, documento) {
  if (!usuario || !puedeEditarse(documento)) return false;
  if (usuario.rol === ROLES.GERENTE)   return true;
  // El comprador es quien consigue el precio: tiene que poder capturarlo.
  if (usuario.rol === ROLES.COMPRADOR) return true;
  // El vendedor, solo lo suyo.
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

/**
 * De la cotización a Vencida solo se sale recotizando, así que 'Vencida' ya no
 * es del todo terminal: sigue sin admitir cambios de estatus, pero sí admite
 * que alguien la reviva con una versión nueva. Se deja documentado aquí porque
 * `ESTATUS_FINALES` se sigue usando para sellar la fecha de cierre y para el
 * KPI de atención, y ahí Vencida sí cuenta como cerrada.
 */
