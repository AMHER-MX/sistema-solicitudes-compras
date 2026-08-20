/**
 * Manejo centralizado de errores y de rutas inexistentes.
 * Traduce además los códigos de error de PostgreSQL más comunes
 * a mensajes que el frontend puede mostrar tal cual.
 */
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

export function rutaNoEncontrada(req, res) {
  res.status(404).json({
    ok: false,
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

// Códigos SQLSTATE de PostgreSQL -> [status HTTP, mensaje]
const ERRORES_PG = {
  '23505': [409, 'Registro duplicado: ya existe un valor igual en un campo único'],
  '23503': [400, 'Referencia inexistente: la llave foránea apunta a un registro que no existe'],
  '23502': [400, 'Falta un campo obligatorio'],
  '23514': [400, 'Valor no permitido por las reglas de la base de datos (CHECK)'],
  '22P02': [400, 'Formato de dato inválido'],
  ECONNREFUSED: [503, 'No hay conexión con la base de datos'],
};

export function manejadorErrores(err, _req, res, _next) {
  // 1) Errores que lanzamos nosotros a propósito.
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      ok: false,
      error: err.message,
      ...(err.detalles ? { detalles: err.detalles } : {}),
    });
  }

  // 2) Errores conocidos de PostgreSQL.
  const mapeado = ERRORES_PG[err.code];
  if (mapeado) {
    const [status, mensaje] = mapeado;
    return res.status(status).json({
      ok: false,
      error: mensaje,
      ...(err.detail || err.column ? { detalles: err.detail || err.column } : {}),
    });
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
