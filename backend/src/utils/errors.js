/**
 * Errores HTTP tipados + helper para controladores asíncronos.
 */

export class ApiError extends Error {
  constructor(status, mensaje, detalles = undefined) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

export const badRequest   = (msg, det) => new ApiError(400, msg, det);
export const unauthorized = (msg = 'No autenticado')       => new ApiError(401, msg);
export const forbidden    = (msg = 'No autorizado')        => new ApiError(403, msg);
export const notFound     = (msg = 'Recurso no encontrado')=> new ApiError(404, msg);
export const conflict     = (msg, det) => new ApiError(409, msg, det);

/**
 * Evita el try/catch repetido en cada controlador:
 *   router.get('/', asyncHandler(controlador))
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
