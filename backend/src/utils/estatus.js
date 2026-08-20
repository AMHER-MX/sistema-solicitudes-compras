/**
 * Máquina de estados del flujo de compras.
 * Centralizar esto evita que la UI o un endpoint dejen la solicitud
 * en una combinación imposible (ej. de 'Recibido' de vuelta a 'Pendiente').
 */

export const ESTATUS = {
  PENDIENTE:     'Pendiente',
  EN_COTIZACION: 'En Cotizacion',
  AUTORIZADA:    'Autorizada',
  EN_TRANSITO:   'En Transito',
  RECIBIDO:      'Recibido',
  CANCELADA:     'Cancelada',
  RECHAZADA:     'Rechazada',
};

export const PRIORIDADES = ['Urgente', 'Normal', 'Baja'];

export const ROLES = {
  VENDEDOR:  'Vendedor',
  COMPRADOR: 'Comprador',
  GERENTE:   'Gerente',
};

/** Estados que ya no admiten movimientos (cierran la solicitud). */
export const ESTATUS_FINALES = [ESTATUS.RECIBIDO, ESTATUS.CANCELADA, ESTATUS.RECHAZADA];

/** Transiciones permitidas: origen -> [destinos válidos] */
export const TRANSICIONES = {
  [ESTATUS.PENDIENTE]:     [ESTATUS.EN_COTIZACION, ESTATUS.AUTORIZADA, ESTATUS.RECHAZADA, ESTATUS.CANCELADA],
  [ESTATUS.EN_COTIZACION]: [ESTATUS.AUTORIZADA, ESTATUS.EN_TRANSITO, ESTATUS.RECHAZADA, ESTATUS.CANCELADA],
  [ESTATUS.AUTORIZADA]:    [ESTATUS.EN_TRANSITO, ESTATUS.CANCELADA],
  [ESTATUS.EN_TRANSITO]:   [ESTATUS.RECIBIDO, ESTATUS.CANCELADA],
  [ESTATUS.RECIBIDO]:      [],
  [ESTATUS.CANCELADA]:     [],
  [ESTATUS.RECHAZADA]:     [],
};

export const esEstatusValido = (e) => Object.values(ESTATUS).includes(e);

/** ¿Se puede pasar de `actual` a `nuevo`? */
export const transicionPermitida = (actual, nuevo) =>
  Array.isArray(TRANSICIONES[actual]) && TRANSICIONES[actual].includes(nuevo);

/** Estados que la UI puede ofrecer desde el estatus actual. */
export const siguientesEstatus = (actual) => TRANSICIONES[actual] ?? [];
