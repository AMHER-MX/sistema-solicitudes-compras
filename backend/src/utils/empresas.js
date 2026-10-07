/**
 * Alcance por empresa: quién puede ver qué.
 *
 * El sistema atiende a dos empresas hermanas —CATOSA y CADUSA— que comparten
 * el mismo Quiter y los mismos almacenes a la vista, pero NO sus documentos.
 * Un vendedor de CATOSA no debe ver una sola cotización de CADUSA.
 *
 * DE DÓNDE SALE EL ALCANCE, Y POR QUÉ IMPORTA
 *   De la base en CADA petición (ver `middleware/cuenta.js`), nunca del token.
 *   El token es una foto del momento en que la persona entró y vive 8 horas.
 *   Si un Gerente le quita a alguien el alcance de grupo, o lo cambia de
 *   empresa, eso tiene que surtir efecto en el siguiente clic — no al día
 *   siguiente. Confiar en el token aquí sería dejar una puerta abierta durante
 *   ocho horas, y es justo la puerta que separa a una empresa de la otra.
 *
 * DÓNDE SE APLICA
 *   En el SERVIDOR, dentro de la consulta. No escondiendo botones: una
 *   pantalla se puede saltar escribiendo una dirección, una cláusula WHERE no.
 */

/** Ve las dos empresas. Es el único alcance que cruza la frontera. */
export const ALCANCE_GRUPO = 'GRUPO';

/** Ve únicamente la suya. Es el valor por omisión y el de casi todos. */
export const ALCANCE_EMPRESA = 'EMPRESA';

export const ALCANCES = [ALCANCE_EMPRESA, ALCANCE_GRUPO];

export const esAlcanceValido = (a) => ALCANCES.includes(a);

/** ¿Esta persona ve más de una empresa? */
export const veTodasLasEmpresas = (usuario) => usuario?.alcance === ALCANCE_GRUPO;

/**
 * A qué empresa hay que limitar una consulta para este usuario.
 *
 * Devuelve `null` cuando NO hay que limitar (alcance de grupo). Que el caso
 * "sin límite" sea null y no un valor especial es a propósito: obliga a quien
 * escribe la consulta a decidir qué hacer con él, en lugar de que un
 * identificador de empresa inventado se cuele silenciosamente en un WHERE.
 *
 * @param {{ id_empresa?: number, alcance?: string }} usuario
 * @param {number|string} [empresaPedida] empresa que la pantalla quiere ver
 * @returns {number|null}
 */
export function empresaParaConsulta(usuario, empresaPedida) {
  if (!veTodasLasEmpresas(usuario)) {
    // Quien ve una sola empresa SIEMPRE queda limitado a la suya, sin importar
    // qué pida. Pedir otra no es un error que valga la pena reportar: es un
    // parámetro que simplemente no se respeta.
    return Number(usuario?.id_empresa) || null;
  }

  // Alcance de grupo: puede pedir una empresa concreta, o no pedir ninguna y
  // verlas todas.
  if (empresaPedida === undefined || empresaPedida === null || empresaPedida === '') return null;
  const id = Number(empresaPedida);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * ¿Este usuario puede trabajar sobre un documento o recurso de esta empresa?
 *
 * Se usa en todo endpoint que recibe un :id, porque el id lo pone quien llama
 * y nada impide que teclee el de la otra empresa.
 */
export function puedeConEmpresa(usuario, idEmpresaDelRecurso) {
  if (veTodasLasEmpresas(usuario)) return true;
  if (idEmpresaDelRecurso === null || idEmpresaDelRecurso === undefined) return false;
  return Number(usuario?.id_empresa) === Number(idEmpresaDelRecurso);
}
