/**
 * Autenticación con JWT + autorización por rol.
 *
 * Uso:
 *   router.get('/privado', autenticar, controlador);
 *   router.patch('/x', autenticar, permitirRoles('Comprador', 'Gerente'), controlador);
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/** Firma el token que consume el frontend. */
export function firmarToken(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      sucursal_id: usuario.sucursal_id,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn },
  );
}

/** Verifica el header `Authorization: Bearer <token>` y llena req.usuario. */
export function autenticar(req, _res, next) {
  const header = req.headers.authorization || '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next(unauthorized('Falta el token de acceso (Authorization: Bearer ...)'));
  }

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.usuario = {
      id: payload.sub,
      nombre: payload.nombre,
      email: payload.email,
      rol: payload.rol,
      sucursal_id: payload.sucursal_id,
    };
    return next();
  } catch {
    return next(unauthorized('Token inválido o expirado'));
  }
}

/** Restringe el acceso a los roles indicados. */
export const permitirRoles = (...roles) => (req, _res, next) => {
  if (!req.usuario) return next(unauthorized());
  if (!roles.includes(req.usuario.rol)) {
    return next(forbidden(`Se requiere rol: ${roles.join(' o ')}`));
  }
  return next();
};
