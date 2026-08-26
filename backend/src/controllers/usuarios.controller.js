/**
 * Administración de usuarios (solo Gerente).
 *
 *   GET    /api/usuarios              -> lista con filtros
 *   GET    /api/usuarios/:id          -> una cuenta
 *   POST   /api/usuarios              -> alta con contraseña temporal
 *   PATCH  /api/usuarios/:id          -> nombre, rol, sucursal, activo
 *   POST   /api/usuarios/:id/password -> restablecer contraseña
 *
 * La contraseña temporal viaja en la respuesta del alta y del restablecimiento,
 * y en ningún otro lado: no se guarda en claro ni se escribe en los logs.
 */
import * as servicio from '../services/usuarios.service.js';
import { badRequest } from '../utils/errors.js';

/** Convierte '1'/'true'/'0'/'false' de la query string a booleano, o undefined. */
function aBooleano(valor) {
  if (valor === undefined || valor === '') return undefined;
  const texto = String(valor).toLowerCase();
  if (['1', 'true', 'si', 'sí'].includes(texto)) return true;
  if (['0', 'false', 'no'].includes(texto)) return false;
  return undefined;
}

/** Valida el :id de la ruta antes de tocar la base. */
function idDeRuta(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('El id del usuario no es válido');
  return id;
}

export async function listar(req, res) {
  const usuarios = await servicio.listarUsuarios({
    q: req.query.q,
    rol: req.query.rol,
    activo: aBooleano(req.query.activo),
  });
  res.json({ ok: true, total: usuarios.length, usuarios });
}

export async function detalle(req, res) {
  const usuario = await servicio.obtenerUsuario(idDeRuta(req));
  res.json({ ok: true, usuario });
}

export async function crear(req, res) {
  const { usuario, passwordTemporal } = await servicio.crearUsuario(req.body ?? {}, req.usuario.id);

  res.status(201).json({
    ok: true,
    usuario,
    passwordTemporal,
    aviso: 'Anota o copia esta contraseña ahora: no se vuelve a mostrar. '
         + 'La persona deberá cambiarla la primera vez que entre.',
  });
}

export async function actualizar(req, res) {
  const usuario = await servicio.actualizarUsuario(idDeRuta(req), req.body ?? {}, req.usuario.id);
  res.json({ ok: true, usuario });
}

export async function restablecer(req, res) {
  const { usuario, passwordTemporal } = await servicio.restablecerPassword(idDeRuta(req), req.usuario.id);

  res.json({
    ok: true,
    usuario,
    passwordTemporal,
    aviso: 'Anota o copia esta contraseña ahora: no se vuelve a mostrar. '
         + 'La persona deberá cambiarla la próxima vez que entre.',
  });
}
