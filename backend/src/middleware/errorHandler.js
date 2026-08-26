/**
 * Manejo centralizado de errores y de rutas inexistentes.
 * Traduce además los errores más comunes de PostgreSQL a mensajes que el
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

// Código SQLSTATE de PostgreSQL -> [status HTTP, mensaje]
const ERRORES_POSTGRES = {
  '23505': [409, 'Registro duplicado: ya existe un valor igual en un campo único'],
  '23503': [400, 'Referencia inexistente: apunta a un registro que no existe'],
  '23502': [400, 'Falta un campo obligatorio'],
  '23514': [400, 'Valor no permitido por las reglas de la base (CHECK)'],
  '22001': [400, 'Un texto es más largo de lo que permite la columna'],
  '22P02': [400, 'Formato de dato inválido'],
  '42703': [500, 'La base no tiene una columna que el sistema espera: falta correr las migraciones'],
  '42P01': [500, 'La base no tiene una tabla que el sistema espera: falta instalar el esquema'],
};

// Fallas de red/conexión, que no traen SQLSTATE.
const ERRORES_CONEXION = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'];

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

  // 2) Errores conocidos de PostgreSQL.
  const mapeado = ERRORES_POSTGRES[err.code];
  if (mapeado) {
    const [status, mensaje] = mapeado;
    console.error('[SQL]', err.code, err.message, err.detail ? `- ${err.detail}` : '');
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
