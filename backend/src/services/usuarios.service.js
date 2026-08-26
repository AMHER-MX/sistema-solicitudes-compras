/**
 * Administración de cuentas de usuario (PostgreSQL).
 *
 * Solo el Gerente llega aquí, salvo `cambiarPasswordPropia`, que es para
 * cualquiera que ya inició sesión.
 *
 * Reglas de la casa:
 *   · Las cuentas NO se borran, se desactivan. Un usuario aparece firmado en
 *     solicitudes e historial; borrarlo dejaría huecos en la bitácora — que es
 *     justo lo que la bitácora existe para evitar.
 *   · La contraseña en claro nunca se guarda ni se registra en un log: se
 *     genera, se devuelve una sola vez y se olvida.
 *   · Nadie puede dejar el sistema sin Gerentes activos, ni quitarse a sí mismo
 *     el acceso por accidente.
 */
import bcrypt from 'bcryptjs';
import { query, queryUno } from '../config/db.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { ROLES } from '../utils/estatus.js';
import { generarPasswordTemporal, revisarPassword } from '../utils/password.js';

/** Costo de bcrypt. 10 es el equilibrio usual entre seguridad y tiempo. */
const RONDAS_BCRYPT = 10;

export const ROLES_VALIDOS = Object.values(ROLES);

/**
 * Columnas que sí pueden salir del servidor.
 * `password_hash` NUNCA se incluye: si no se selecciona, no se puede filtrar
 * por accidente en una respuesta.
 */
const SELECT_USUARIO = `
    u.id,
    u.nombre,
    u.email,
    u.rol,
    u.sucursal_id,
    u.activo,
    u.debe_cambiar_password,
    u.ultimo_acceso,
    u.creado_en,
    u.creado_por,
    u.password_actualizado_en,
    su.nombre AS sucursal_nombre,
    su.clave  AS sucursal_clave,
    quien.nombre AS creado_por_nombre`;

const FROM_USUARIO = `
  FROM      usuarios u
  LEFT JOIN sucursales su   ON su.id    = u.sucursal_id
  LEFT JOIN usuarios   quien ON quien.id = u.creado_por`;

/** Normaliza el correo: sin espacios y en minúsculas, siempre. */
const normalizarEmail = (email) => String(email ?? '').trim().toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// LECTURA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista de usuarios para la pantalla de administración.
 * @param {{ q?: string, rol?: string, activo?: boolean }} filtros
 */
export async function listarUsuarios({ q = '', rol = '', activo } = {}) {
  const texto = String(q).trim();

  return query(
    `SELECT ${SELECT_USUARIO}
     ${FROM_USUARIO}
     WHERE (@q   = '' OR u.nombre ILIKE @patron OR u.email ILIKE @patron)
       AND (@rol = '' OR u.rol = @rol)
       AND (@activo::boolean IS NULL OR u.activo = @activo::boolean)
     ORDER BY u.activo DESC, u.rol, u.nombre`,
    {
      q: texto,
      patron: `%${texto}%`,
      rol: String(rol).trim(),
      activo: activo === undefined ? null : activo,
    },
  );
}

/** Un usuario por id, sin el hash. Lanza 404 si no existe. */
export async function obtenerUsuario(id) {
  const usuario = await queryUno(
    `SELECT ${SELECT_USUARIO} ${FROM_USUARIO} WHERE u.id = @id`,
    { id: Number(id) },
  );
  if (!usuario) throw notFound('Usuario no encontrado');
  return usuario;
}

/**
 * Cuántos Gerentes activos hay, excluyendo opcionalmente a uno.
 * Es la consulta que evita que el sistema se quede sin administrador.
 */
async function contarGerentesActivos(excluirId = null) {
  const fila = await queryUno(
    `SELECT COUNT(*) AS total
     FROM   usuarios
     WHERE  rol = @rol AND activo
       AND  (@excluir::int IS NULL OR id <> @excluir::int)`,
    { rol: ROLES.GERENTE, excluir: excluirId },
  );
  return Number(fila?.total ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALTA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Da de alta una cuenta con contraseña temporal.
 *
 * Devuelve `{ usuario, passwordTemporal }`. Esa contraseña es la ÚNICA vez que
 * el sistema la muestra: después solo existe su hash. Quien la crea tiene que
 * entregarla a la persona, y la persona está obligada a cambiarla al entrar.
 *
 * @param {{ nombre: string, email: string, rol: string, sucursal_id?: number|null }} datos
 * @param {number} creadoPor  id del Gerente que la está creando
 */
export async function crearUsuario(datos, creadoPor) {
  const nombre = String(datos?.nombre ?? '').trim();
  const email = normalizarEmail(datos?.email);
  const rol = String(datos?.rol ?? '').trim();
  const sucursalId = datos?.sucursal_id === '' || datos?.sucursal_id == null
    ? null
    : Number(datos.sucursal_id);

  const problemas = [];
  if (nombre.length < 3) problemas.push('El nombre debe tener al menos 3 caracteres.');
  if (nombre.length > 120) problemas.push('El nombre es demasiado largo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problemas.push('El correo no tiene un formato válido.');
  if (email.length > 160) problemas.push('El correo es demasiado largo.');
  if (!ROLES_VALIDOS.includes(rol)) problemas.push(`El rol debe ser: ${ROLES_VALIDOS.join(', ')}.`);
  if (sucursalId !== null && !Number.isInteger(sucursalId)) problemas.push('La sucursal no es válida.');

  // Un Vendedor sin sucursal no puede levantar solicitudes: su sucursal es la
  // que se graba en cada una. Mejor detenerlo aquí que descubrirlo después.
  if (rol === ROLES.VENDEDOR && sucursalId === null) {
    problemas.push('Un Vendedor necesita una sucursal asignada.');
  }

  if (problemas.length) throw badRequest('Revisa los datos de la cuenta', problemas);

  if (sucursalId !== null) {
    const sucursal = await queryUno('SELECT id FROM sucursales WHERE id = @id', { id: sucursalId });
    if (!sucursal) throw badRequest('La sucursal indicada no existe');
  }

  const yaExiste = await queryUno(
    'SELECT id, activo FROM usuarios WHERE email = @email',
    { email },
  );
  if (yaExiste) {
    throw conflict(yaExiste.activo
      ? 'Ya hay una cuenta con ese correo.'
      : 'Ya hay una cuenta con ese correo, pero está desactivada. Reactívala en lugar de crear otra.');
  }

  const passwordTemporal = generarPasswordTemporal();
  const hash = await bcrypt.hash(passwordTemporal, RONDAS_BCRYPT);

  const [fila] = await query(
    `INSERT INTO usuarios
        (nombre, email, password_hash, rol, sucursal_id, activo, debe_cambiar_password, creado_por)
     VALUES (@nombre, @email, @hash, @rol, @sucursal::int, TRUE, TRUE, @creadoPor::int)
     RETURNING id`,
    {
      nombre,
      email,
      hash,
      rol,
      sucursal: sucursalId,
      creadoPor: creadoPor ?? null,
    },
  );

  const usuario = await obtenerUsuario(fila.id);
  return { usuario, passwordTemporal };
}

// ─────────────────────────────────────────────────────────────────────────────
// EDICIÓN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cambia nombre, rol, sucursal o el estado activo/inactivo.
 * Solo toca los campos que vengan en `cambios`.
 *
 * @param {number} id       usuario a modificar
 * @param {object} cambios  { nombre?, rol?, sucursal_id?, activo? }
 * @param {number} actorId  quién está haciendo el cambio (el Gerente en sesión)
 */
export async function actualizarUsuario(id, cambios, actorId) {
  const objetivo = await obtenerUsuario(id);
  const esUnoMismo = Number(id) === Number(actorId);

  const asignaciones = [];
  const params = { id: Number(id) };
  const problemas = [];

  if (cambios.nombre !== undefined) {
    const nombre = String(cambios.nombre).trim();
    if (nombre.length < 3 || nombre.length > 120) {
      problemas.push('El nombre debe tener entre 3 y 120 caracteres.');
    } else {
      asignaciones.push('nombre = @nombre');
      params.nombre = nombre;
    }
  }

  if (cambios.rol !== undefined && cambios.rol !== objetivo.rol) {
    const rol = String(cambios.rol).trim();
    if (!ROLES_VALIDOS.includes(rol)) {
      problemas.push(`El rol debe ser: ${ROLES_VALIDOS.join(', ')}.`);
    } else if (esUnoMismo) {
      // Sin esto, un Gerente distraído se quita a sí mismo el acceso a esta
      // misma pantalla y ya no puede devolvérselo.
      problemas.push('No puedes cambiar tu propio rol. Pídeselo a otro Gerente.');
    } else {
      if (objetivo.rol === ROLES.GERENTE && await contarGerentesActivos(Number(id)) === 0) {
        problemas.push('Es el único Gerente activo: nombra otro antes de cambiarle el rol.');
      }
      asignaciones.push('rol = @rol');
      params.rol = rol;
    }
  }

  if (cambios.sucursal_id !== undefined) {
    const sucursalId = cambios.sucursal_id === '' || cambios.sucursal_id === null
      ? null
      : Number(cambios.sucursal_id);

    if (sucursalId !== null && !Number.isInteger(sucursalId)) {
      problemas.push('La sucursal no es válida.');
    } else {
      if (sucursalId !== null) {
        const sucursal = await queryUno('SELECT id FROM sucursales WHERE id = @id', { id: sucursalId });
        if (!sucursal) problemas.push('La sucursal indicada no existe.');
      }
      const rolFinal = params.rol ?? objetivo.rol;
      if (rolFinal === ROLES.VENDEDOR && sucursalId === null) {
        problemas.push('Un Vendedor necesita una sucursal asignada.');
      }
      asignaciones.push('sucursal_id = @sucursal::int');
      params.sucursal = sucursalId;
    }
  }

  if (cambios.activo !== undefined) {
    const activo = cambios.activo === true || cambios.activo === 1 || cambios.activo === '1';

    if (!activo && esUnoMismo) {
      problemas.push('No puedes desactivar tu propia cuenta.');
    } else if (!activo && objetivo.rol === ROLES.GERENTE && await contarGerentesActivos(Number(id)) === 0) {
      problemas.push('Es el único Gerente activo: no se puede desactivar.');
    } else {
      asignaciones.push('activo = @activo');
      params.activo = activo;
    }
  }

  if (problemas.length) throw badRequest('No se pudo guardar el cambio', problemas);
  if (asignaciones.length === 0) return objetivo; // nada que hacer

  await query(
    `UPDATE usuarios SET ${asignaciones.join(', ')} WHERE id = @id`,
    params,
  );

  return obtenerUsuario(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRASEÑAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El Gerente restablece la contraseña de alguien más (o la suya).
 * Genera una temporal nueva y obliga al usuario a cambiarla al entrar.
 *
 * @returns {Promise<{ usuario: object, passwordTemporal: string }>}
 */
export async function restablecerPassword(id, actorId) {
  const objetivo = await obtenerUsuario(id);

  if (!objetivo.activo) {
    throw badRequest('La cuenta está desactivada. Actívala antes de restablecer su contraseña.');
  }

  const passwordTemporal = generarPasswordTemporal();
  const hash = await bcrypt.hash(passwordTemporal, RONDAS_BCRYPT);

  await query(
    `UPDATE usuarios
     SET    password_hash = @hash,
            debe_cambiar_password = TRUE,
            password_actualizado_en = NOW()
     WHERE  id = @id`,
    { hash, id: Number(id) },
  );

  // Deja constancia de quién restableció a quién, sin guardar la contraseña.
  console.log(`[usuarios] contraseña restablecida: usuario ${id} por usuario ${actorId}`);

  return { usuario: await obtenerUsuario(id), passwordTemporal };
}

/**
 * El propio usuario cambia su contraseña. Necesita la actual — incluso cuando
 * está en modo "cambio obligatorio", porque la actual es la temporal que le
 * acaban de dar y pedirla evita que alguien que le agarre la sesión abierta
 * se apodere de la cuenta.
 *
 * @param {number} id
 * @param {string} passwordActual
 * @param {string} passwordNueva
 */
export async function cambiarPasswordPropia(id, passwordActual, passwordNueva) {
  const fila = await queryUno(
    'SELECT id, nombre, email, password_hash FROM usuarios WHERE id = @id AND activo = 1',
    { id: Number(id) },
  );
  if (!fila) throw notFound('Usuario no encontrado');

  const coincide = await bcrypt.compare(String(passwordActual ?? ''), fila.password_hash);
  if (!coincide) throw badRequest('La contraseña actual no es correcta');

  const problemas = revisarPassword(passwordNueva, { nombre: fila.nombre, email: fila.email });
  if (problemas.length) throw badRequest('La contraseña nueva no cumple los requisitos', problemas);

  const igualALaAnterior = await bcrypt.compare(String(passwordNueva), fila.password_hash);
  if (igualALaAnterior) throw badRequest('La contraseña nueva debe ser distinta de la actual');

  const hash = await bcrypt.hash(String(passwordNueva), RONDAS_BCRYPT);

  await query(
    `UPDATE usuarios
     SET    password_hash = @hash,
            debe_cambiar_password = FALSE,
            password_actualizado_en = NOW()
     WHERE  id = @id`,
    { hash, id: Number(id) },
  );

  return obtenerUsuario(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// AVISO DE CUENTAS DEMO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca cuentas de demostración activas (las de @demo.mx que carga el seed).
 * El servidor lo revisa al arrancar para avisar si quedaron vivas en producción.
 */
export async function cuentasDemoActivas() {
  return query(
    `SELECT id, nombre, email, rol
     FROM   usuarios
     WHERE  activo AND email LIKE '%@demo.mx'
     ORDER BY rol, email`,
  );
}
