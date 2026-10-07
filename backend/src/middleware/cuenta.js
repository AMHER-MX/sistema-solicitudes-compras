/**
 * Verificación del estado de la cuenta en cada petición protegida.
 *
 * El token JWT es una foto del momento en que la persona entró: dice quién es
 * y con qué rol, pero no se entera de lo que pase después. Sin esta revisión,
 * desactivar a alguien no surtiría efecto hasta que su token expirara (8 horas),
 * y restablecerle la contraseña tampoco lo obligaría a cambiarla si ya tenía
 * la sesión abierta.
 *
 * Por eso, en cada petición se consulta el renglón del usuario:
 *   · cuenta desactivada       -> 401, se acabó la sesión
 *   · contraseña temporal      -> 403 con codigo PASSWORD_TEMPORAL
 *   · empresa y alcance        -> se refrescan en req.usuario
 *
 * Lo último es de seguridad, no de comodidad: el alcance decide si alguien ve
 * los documentos de la empresa hermana. Si viniera del token —una foto de hace
 * hasta ocho horas— quitarle a alguien ese permiso no surtiría efecto hasta
 * que caducara. Aquí surte efecto en el siguiente clic.
 *
 * Es una búsqueda por llave primaria sobre una tabla de decenas de renglones:
 * en la práctica no se nota, y compra mucho control.
 *
 * Uso:
 *   router.use(autenticar, cuentaVigente);
 *
 * NO se aplica a /api/auth/yo ni a /api/auth/cambiar-password: son justo las
 * dos cosas que alguien con contraseña temporal necesita poder hacer.
 */
import { queryUno } from '../config/db.js';
import { asyncHandler, forbidden, unauthorized } from '../utils/errors.js';

/** Código que el frontend usa para mandar al usuario a la pantalla de cambio. */
export const CODIGO_PASSWORD_TEMPORAL = 'PASSWORD_TEMPORAL';

// Va envuelto en asyncHandler: sin eso, si la consulta falla, Express 4 no se
// entera del rechazo y la petición se queda colgada hasta el timeout.
export const cuentaVigente = asyncHandler(async (req, _res, next) => {
  if (!req.usuario) return next(unauthorized());

  const fila = await queryUno(
    `SELECT u.activo, u.debe_cambiar_password, u.id_empresa, u.alcance,
            e.clave AS empresa_clave, e.nombre AS empresa_nombre
     FROM      usuarios u
     LEFT JOIN empresas e ON e.id = u.id_empresa
     WHERE     u.id = @id`,
    { id: req.usuario.id },
  );

  if (!fila) return next(unauthorized('La cuenta ya no existe'));
  if (!fila.activo) return next(unauthorized('La cuenta está desactivada'));

  // El alcance SIEMPRE se toma de la base, pisando lo que trajera el token.
  req.usuario.id_empresa = fila.id_empresa;
  req.usuario.alcance = fila.alcance;
  req.usuario.empresa_clave = fila.empresa_clave;
  req.usuario.empresa_nombre = fila.empresa_nombre;

  // Un usuario sin empresa no puede operar: no se sabe de quién sería lo que
  // capture. Pasa solo si su sucursal quedó sin clasificar en la migración.
  if (!fila.id_empresa) {
    return next(forbidden('Tu cuenta no tiene empresa asignada. '
                        + 'Pídele a un Gerente que te la asigne en la pantalla Usuarios.'));
  }

  if (fila.debe_cambiar_password) {
    const error = forbidden('Debes cambiar tu contraseña temporal antes de continuar');
    error.codigo = CODIGO_PASSWORD_TEMPORAL;
    return next(error);
  }

  return next();
});
