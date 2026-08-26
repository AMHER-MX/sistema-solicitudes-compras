/**
 * Controlador de autenticación.
 *  POST /api/auth/login             -> valida credenciales y devuelve JWT
 *  GET  /api/auth/yo                -> perfil del usuario del token
 *  POST /api/auth/cambiar-password  -> el usuario cambia su propia contraseña
 *
 * Las dos últimas rutas NO pasan por `cuentaVigente` a propósito: son las
 * únicas que alguien con contraseña temporal necesita poder usar.
 */
import bcrypt from 'bcryptjs';
import { query, queryUno } from '../config/db.js';
import { firmarToken } from '../middleware/auth.js';
import { limpiarIntentos, registrarFallo, revisarIntentos } from '../middleware/limiteIntentos.js';
import { cambiarPasswordPropia } from '../services/usuarios.service.js';
import { badRequest, unauthorized } from '../utils/errors.js';

const PERFIL = `
  SELECT u.id, u.nombre, u.email, u.rol, u.sucursal_id, u.ultimo_acceso,
         u.debe_cambiar_password,
         su.nombre AS sucursal_nombre, su.clave AS sucursal_clave
  FROM      usuarios u
  LEFT JOIN sucursales su ON su.id = u.sucursal_id`;

export async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (!email || !password) throw badRequest('Se requieren email y password');

  // Antes de tocar la base: si esta cuenta ya acumuló intentos fallidos, ni
  // siquiera se revisa la contraseña.
  await revisarIntentos(email);

  const usuario = await queryUno(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.sucursal_id, u.activo,
            u.debe_cambiar_password,
            su.nombre AS sucursal_nombre, su.clave AS sucursal_clave
     FROM      usuarios u
     LEFT JOIN sucursales su ON su.id = u.sucursal_id
     WHERE     LOWER(u.email) = LOWER(@email)`,
    { email },
  );

  // Mensaje genérico a propósito: no revelamos si el correo existe.
  if (!usuario || !usuario.activo) {
    registrarFallo(email);
    throw unauthorized('Credenciales inválidas');
  }

  const coincide = await bcrypt.compare(password, usuario.password_hash);
  if (!coincide) {
    registrarFallo(email);
    throw unauthorized('Credenciales inválidas');
  }

  // Entró bien: se le borra el historial de fallos.
  limpiarIntentos(email);

  await query(
    'UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = @id',
    { id: usuario.id },
  );

  delete usuario.password_hash; // nunca sale del servidor
  delete usuario.activo;

  // El driver entrega BIT como true/false; lo dejamos explícito para que el
  // frontend no tenga que adivinar con un 1 o un 0.
  usuario.debe_cambiar_password = Boolean(usuario.debe_cambiar_password);

  res.json({
    ok: true,
    token: firmarToken(usuario),
    usuario,
    // Si viene en true, la interfaz manda directo a cambiar la contraseña:
    // con esa bandera puesta, el resto de la API le responde 403.
    debeCambiarPassword: usuario.debe_cambiar_password,
  });
}

export async function yo(req, res) {
  const usuario = await queryUno(`${PERFIL} WHERE u.id = @id`, { id: req.usuario.id });
  if (!usuario) throw unauthorized('La cuenta ya no existe');

  usuario.debe_cambiar_password = Boolean(usuario.debe_cambiar_password);
  res.json({ ok: true, usuario });
}

/**
 * Cambio de contraseña por el propio usuario.
 * Sirve tanto para el cambio obligatorio de la primera entrada como para un
 * cambio voluntario más adelante.
 */
export async function cambiarPassword(req, res) {
  const { passwordActual, passwordNueva } = req.body ?? {};

  if (!passwordActual || !passwordNueva) {
    throw badRequest('Se requieren la contraseña actual y la nueva');
  }

  const usuario = await cambiarPasswordPropia(req.usuario.id, passwordActual, passwordNueva);

  // Token nuevo: el anterior sigue siendo válido hasta que expire, pero este
  // ya refleja la cuenta al día. La interfaz reemplaza el que tenía guardado.
  res.json({
    ok: true,
    mensaje: 'Contraseña actualizada',
    token: firmarToken(usuario),
    usuario,
  });
}
