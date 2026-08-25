/**
 * Controlador de autenticación.
 *  POST /api/auth/login  -> valida credenciales y devuelve JWT
 *  GET  /api/auth/yo     -> perfil del usuario del token
 */
import bcrypt from 'bcryptjs';
import { query, queryUno } from '../config/db.js';
import { firmarToken } from '../middleware/auth.js';
import { badRequest, unauthorized } from '../utils/errors.js';

const PERFIL = `
  SELECT u.id, u.nombre, u.email, u.rol, u.sucursal_id, u.ultimo_acceso,
         su.nombre AS sucursal_nombre, su.clave AS sucursal_clave
  FROM      dbo.usuarios u
  LEFT JOIN dbo.sucursales su ON su.id = u.sucursal_id`;

export async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (!email || !password) throw badRequest('Se requieren email y password');

  const usuario = await queryUno(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.sucursal_id, u.activo,
            su.nombre AS sucursal_nombre, su.clave AS sucursal_clave
     FROM      dbo.usuarios u
     LEFT JOIN dbo.sucursales su ON su.id = u.sucursal_id
     WHERE     LOWER(u.email) = LOWER(@email)`,
    { email },
  );

  // Mensaje genérico a propósito: no revelamos si el correo existe.
  if (!usuario || !usuario.activo) throw unauthorized('Credenciales inválidas');

  const coincide = await bcrypt.compare(password, usuario.password_hash);
  if (!coincide) throw unauthorized('Credenciales inválidas');

  await query(
    'UPDATE dbo.usuarios SET ultimo_acceso = SYSUTCDATETIME() WHERE id = @id',
    { id: usuario.id },
  );

  delete usuario.password_hash; // nunca sale del servidor
  delete usuario.activo;

  res.json({
    ok: true,
    token: firmarToken(usuario),
    usuario,
  });
}

export async function yo(req, res) {
  const usuario = await queryUno(`${PERFIL} WHERE u.id = @id`, { id: req.usuario.id });
  res.json({ ok: true, usuario });
}
