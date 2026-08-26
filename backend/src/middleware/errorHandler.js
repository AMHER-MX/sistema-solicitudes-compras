/**
 * Manejo centralizado de errores y de rutas inexistentes.
 * Traduce además los errores más comunes de SQL Server a mensajes que el
 * frontend puede mostrar tal cual, en lugar de un 500 sin explicación.
 */
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

export function rutaNoEncontrada(req, res) {
  res.status(404).json({
    ok: false,
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

// Número de error de SQL Server -> [status HTTP, mensaje]
const ERRORES_SQLSERVER = {
  2627: [409, 'Registro duplicado: ya existe un valor igual en un campo único'],
  2601: [409, 'Registro duplicado: ya existe un valor igual en un índice único'],
  547:  [400, 'El dato viola una regla de la base (llave foránea o restricción CHECK)'],
  515:  [400, 'Falta un campo obligatorio'],
  8152: [400, 'Un texto es más largo de lo que permite la columna'],
  2628: [400, 'Un texto es más largo de lo que permite la columna'],
  245:  [400, 'Formato de dato inválido'],
  8114: [400, 'Formato de dato inválido'],
};

// Fallas de red/conexión, que no traen número de SQL Server.
const ERRORES_CONEXION = ['ECONNREFUSED', 'ETIMEOUT', 'ETIMEDOUT', 'ESOCKET', 'ELOGIN'];

export function manejadorErrores(err, _req, res, _next) {
  // 1) Errores que lanzamos nosotros a propósito.
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      ok: false,
      error: err.message,
      // `codigo` permite al frontend reaccionar sin comparar textos
      // (por ejemplo PASSWORD_TEMPORAL -> pantalla de cambio de contraseña).
      ...(err.codigo ? { codigo: err.codigo } : {}),
      ...(err.detalles ? { detalles: err.detalles } : {}),
    });
  }

  // 2) Errores conocidos de SQL Server. mssql los entrega envueltos, así que
  //    el número puede venir en el error o en su causa original.
  const numero = err.number ?? err.originalError?.info?.number ?? err.originalError?.number;
  const mapeado = ERRORES_SQLSERVER[numero];
  if (mapeado) {
    const [status, mensaje] = mapeado;
    console.error('[SQL]', numero, err.message);
    return res.status(status).json({ ok: false, error: mensaje });
  }

  if (ERRORES_CONEXION.includes(err.code)) {
    console.error('[BD]', err.code, err.message);
    return res.status(503).json({ ok: false, error: 'No hay conexión con la base de datos' });
  }

  // 3) Cualquier otra cosa: 500 y log completo en servidor.
  console.error('[ERROR]', err);
  return res.status(500).json({
    ok: false,
    error: 'Error interno del servidor',
    // El stack solo se expone fuera de producción.
    ...(env.nodeEnv !== 'production' ? { stack: err.stack } : {}),
  });
}
