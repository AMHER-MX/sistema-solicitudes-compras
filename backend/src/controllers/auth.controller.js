/**
 * Controlador de autenticación.
 *  POST /api/auth/login  -> valida credenciales y devuelve JWT
 *  GET  /api/auth/yo     -> perfil del usuario del token
 */
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { firmarToken } from '../middleware/auth.js';
import { badRequest, unauthorized } from '../utils/errors.js';

export async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (!email || !password) throw badRequest('Se requieren email y password');

  const { rows: [usuario] } = await query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.sucursal_id, u.activo,
            su.nombre AS sucursal_nombre, su.clave AS sucursal_clave
     FROM      usuarios u
     LEFT JOIN sucursales su ON su.id = u.sucursal_id
     WHERE     LOWER(u.email) = LOWER($1)`,
    [email],
  );

  // Mensaje genérico a propósito: no revelamos si el correo existe.
  if (!usuario || !usuario.activo) throw unauthorized('Credenciales inválidas');

  const coincide = await bcrypt.compare(password, usuario.password_hash);
  if (!coincide) throw unauthorized('Credenciales inválidas');

  await query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1', [usuario.id]);

  delete usuario.password_hash; // nunca sale del servidor

  res.json({
    ok: true,
    token: firmarToken(usuario),
    usuario,
  });
}

export async function yo(req, res) {
  const { rows: [usuario] } = await query(
    `SELECT u.id, u.nombre, u.email, u.rol, u.sucursal_id, u.ultimo_acceso,
            su.nombre AS sucursal_nombre, su.clave AS sucursal_clave
     FROM      usuarios u
     LEFT JOIN sucursales su ON su.id = u.sucursal_id
     WHERE     u.id = $1`,
    [req.usuario.id],
  );
  res.json({ ok: true, usuario });
}
