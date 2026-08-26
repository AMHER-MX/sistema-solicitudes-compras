/**
 * Pruebas de la administración de usuarios, sin necesidad de un servidor.
 *
 *   cd backend && npm run test:usuarios
 *
 * Dos partes:
 *   1. Las contraseñas: que la temporal sea sólida y que la validación de la
 *      que elige el usuario rechace lo que tiene que rechazar.
 *   2. Los seguros: que nadie pueda quitarse el acceso a sí mismo ni dejar el
 *      sistema sin Gerentes. Esto se prueba en modo ensayo (SGC_DRY_RUN=1),
 *      donde las consultas se fingen en vez de ejecutarse.
 *
 * Lo que NO se prueba aquí: que SQL Server acepte el SQL. Eso lo cubren
 * `npm run test:sql` (forma del SQL) y correrlo de verdad contra la base.
 */
process.env.SGC_DRY_RUN = '1';

const { definirRespuestaEnsayo } = await import('../src/config/db.js');
const { generarPasswordTemporal, revisarPassword, LARGO_MINIMO } =
  await import('../src/utils/password.js');
const usuarios = await import('../src/services/usuarios.service.js');
const bcrypt = (await import('bcryptjs')).default;

let fallos = 0;
const check = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✓' : '  ✗'} ${nombre}${extra ? ` ${extra}` : ''}`);
  if (!condicion) fallos += 1;
};

/**
 * Corre algo que debe fallar y devuelve el error.
 * Si NO falla, la prueba se marca como fallida: un seguro que no detiene nada
 * es peor que no tenerlo, porque da confianza falsa.
 */
async function debeFallar(nombre, fn, fragmentoEsperado) {
  try {
    await fn();
    check(nombre, false, '(no lanzó ningún error)');
    return null;
  } catch (error) {
    const texto = `${error.message} ${JSON.stringify(error.detalles ?? '')}`.toLowerCase();
    const coincide = !fragmentoEsperado || texto.includes(fragmentoEsperado.toLowerCase());
    check(nombre, coincide, coincide ? '' : `(dijo: "${error.message}")`);
    return error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n== Contraseña temporal ==');

const muestras = Array.from({ length: 500 }, () => generarPasswordTemporal());

check('Mide 14 caracteres', muestras.every((p) => p.length === 14));
check('Solo letras y números', muestras.every((p) => /^[A-Za-z0-9]+$/.test(p)));
check('Sin caracteres que se confunden al dictarla (0 O 1 l I)',
  muestras.every((p) => !/[0O1lI]/.test(p)));
check('No se repite', new Set(muestras).size === muestras.length);

// Si el generador estuviera roto (siempre la misma letra, o un alfabeto de
// tres caracteres), esto lo delata: en 500 muestras deben salir casi todos
// los caracteres posibles.
const usados = new Set(muestras.join(''));
check('Usa todo el alfabeto disponible', usados.size >= 50, `(${usados.size} distintos)`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n== Validación de la contraseña que elige el usuario ==');

const datos = { nombre: 'Ana Ríos', email: 'ana.rios@amher.com.mx' };
const acepta = (p) => revisarPassword(p, datos).length === 0;

check('Acepta una razonable', acepta('Refac2026Torreon'));
check('Rechaza las cortas', !acepta('Abc12'));
check(`Exige ${LARGO_MINIMO} caracteres`, !acepta('Abc12345'));
check('Rechaza sin números', !acepta('SolamenteLetras'));
check('Rechaza sin letras', !acepta('1234567890123'));
check('Rechaza las obvias', !acepta('password12345'));
check('Rechaza demo1234', !acepta('demo1234aaaa'));
check('Rechaza la que contiene el correo', !acepta('ana.rios2026!'));
check('Rechaza la que contiene el nombre', !acepta('AnaSegura2026'));
check('Rechaza espacios al inicio o al final', !acepta(' Refac2026Torreon '));
check('No truena con null', revisarPassword(null, datos).length > 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n== Altas: qué datos se rechazan ==');

// Escenario base: el correo está libre, la sucursal existe, hay 3 Gerentes.
const CORREO_LIBRE = (sql) => {
  if (/FROM\s+dbo\.usuarios\s+WHERE\s+email\s*=\s*@email/i.test(sql)) return [];
  if (/COUNT\(\*\)\s+AS\s+total/i.test(sql)) return [{ total: 3 }];
  if (/FROM\s+dbo\.sucursales\s+WHERE\s+id\s*=\s*@id/i.test(sql)) return [{ id: 1 }];
  if (/FROM\s+dbo\.usuarios\s+u/i.test(sql)) {
    return [{ id: 7, nombre: 'Ana Ríos', email: 'ana.rios@amher.com.mx', rol: 'Vendedor', activo: true }];
  }
  return undefined;
};
definirRespuestaEnsayo(CORREO_LIBRE);

const alta = (extra) => usuarios.crearUsuario(
  { nombre: 'Ana Ríos', email: 'ana.rios@amher.com.mx', rol: 'Vendedor', sucursal_id: 1, ...extra },
  1,
);

await debeFallar('Rechaza el nombre vacío', () => alta({ nombre: '' }), 'nombre');
await debeFallar('Rechaza el correo mal escrito', () => alta({ email: 'ana.rios' }), 'correo');
await debeFallar('Rechaza un rol inventado', () => alta({ rol: 'Director' }), 'rol');
await debeFallar('Rechaza un Vendedor sin sucursal', () => alta({ sucursal_id: null }), 'sucursal');

const { usuario: creado, passwordTemporal } = await alta({});
check('El alta devuelve una contraseña temporal', typeof passwordTemporal === 'string' && passwordTemporal.length === 14);
check('El alta devuelve el usuario', Boolean(creado?.id));

// Un Comprador o un Gerente sí pueden ir sin sucursal: no capturan solicitudes
// a nombre de una agencia.
const sinSucursal = await alta({ rol: 'Comprador', sucursal_id: null });
check('Un Comprador puede ir sin sucursal', Boolean(sinSucursal.usuario));

// Correo ocupado.
definirRespuestaEnsayo((sql) => {
  if (/FROM\s+dbo\.usuarios\s+WHERE\s+email\s*=\s*@email/i.test(sql)) return [{ id: 3, activo: true }];
  return CORREO_LIBRE(sql);
});
await debeFallar('Rechaza un correo ya registrado', () => alta({}), 'ya hay una cuenta');

definirRespuestaEnsayo((sql) => {
  if (/FROM\s+dbo\.usuarios\s+WHERE\s+email\s*=\s*@email/i.test(sql)) return [{ id: 3, activo: false }];
  return CORREO_LIBRE(sql);
});
const errorInactivo = await debeFallar('Avisa si el correo es de una cuenta desactivada', () => alta({}), 'desactivada');
check('...y sugiere reactivarla en vez de duplicarla',
  Boolean(errorInactivo?.message.toLowerCase().includes('reactív')));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n== Seguros: no quedarse fuera del sistema ==');

// El usuario 7 es un Gerente activo y es quien está haciendo los cambios.
const GERENTE_7 = (gerentesRestantes) => (sql) => {
  if (/COUNT\(\*\)\s+AS\s+total/i.test(sql)) return [{ total: gerentesRestantes }];
  if (/FROM\s+dbo\.sucursales\s+WHERE\s+id\s*=\s*@id/i.test(sql)) return [{ id: 1 }];
  if (/FROM\s+dbo\.usuarios\s+u/i.test(sql)) {
    return [{ id: 7, nombre: 'Jorge Treviño', email: 'jorge@amher.com.mx', rol: 'Gerente', activo: true }];
  }
  return undefined;
};

definirRespuestaEnsayo(GERENTE_7(2));
await debeFallar('Un Gerente no puede cambiarse su propio rol',
  () => usuarios.actualizarUsuario(7, { rol: 'Vendedor' }, 7), 'tu propio rol');
await debeFallar('Un Gerente no puede desactivar su propia cuenta',
  () => usuarios.actualizarUsuario(7, { activo: false }, 7), 'tu propia cuenta');

const renombrado = await usuarios.actualizarUsuario(7, { nombre: 'Jorge Treviño Sáenz' }, 7);
check('Pero sí puede cambiarse el nombre', Boolean(renombrado));

// Ahora el objetivo es OTRO Gerente y no queda ninguno más.
definirRespuestaEnsayo(GERENTE_7(0));
await debeFallar('No se puede desactivar al último Gerente',
  () => usuarios.actualizarUsuario(7, { activo: false }, 1), 'único gerente');
await debeFallar('No se le puede cambiar el rol al último Gerente',
  () => usuarios.actualizarUsuario(7, { rol: 'Comprador' }, 1), 'único gerente');

definirRespuestaEnsayo(GERENTE_7(2));
const degradado = await usuarios.actualizarUsuario(7, { rol: 'Comprador' }, 1);
check('Con otro Gerente disponible, el cambio de rol sí pasa', Boolean(degradado));

await debeFallar('Rechaza un rol inventado al editar',
  () => usuarios.actualizarUsuario(7, { rol: 'Superusuario' }, 1), 'rol');

// Editar sin mandar ningún cambio no debe romper nada.
const sinCambios = await usuarios.actualizarUsuario(7, {}, 1);
check('Editar sin cambios no truena', Boolean(sinCambios));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n== Restablecer contraseña ==');

definirRespuestaEnsayo((sql) => {
  if (/FROM\s+dbo\.usuarios\s+u/i.test(sql)) {
    return [{ id: 9, nombre: 'Luis Márquez', email: 'luis@amher.com.mx', rol: 'Vendedor', activo: false }];
  }
  return undefined;
});
await debeFallar('No se restablece la contraseña de una cuenta desactivada',
  () => usuarios.restablecerPassword(9, 1), 'desactivada');

definirRespuestaEnsayo((sql) => {
  if (/FROM\s+dbo\.usuarios\s+u/i.test(sql)) {
    return [{ id: 9, nombre: 'Luis Márquez', email: 'luis@amher.com.mx', rol: 'Vendedor', activo: true }];
  }
  return undefined;
});
const reset = await usuarios.restablecerPassword(9, 1);
check('El restablecimiento devuelve una contraseña temporal nueva',
  typeof reset.passwordTemporal === 'string' && reset.passwordTemporal.length === 14);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n== Cambio de contraseña por el propio usuario ==');

const ACTUAL = 'ClaveTemporal77';
const HASH = await bcrypt.hash(ACTUAL, 4); // 4 rondas: esto es una prueba

definirRespuestaEnsayo((sql) => {
  if (/password_hash\s+FROM\s+dbo\.usuarios/i.test(sql)) {
    return [{ id: 9, nombre: 'Luis Márquez', email: 'luis@amher.com.mx', password_hash: HASH }];
  }
  if (/FROM\s+dbo\.usuarios\s+u/i.test(sql)) {
    return [{ id: 9, nombre: 'Luis Márquez', email: 'luis@amher.com.mx', rol: 'Vendedor', activo: true }];
  }
  return undefined;
});

await debeFallar('Rechaza si la contraseña actual no coincide',
  () => usuarios.cambiarPasswordPropia(9, 'otraCosa123', 'Refac2026Torreon'), 'actual no es correcta');
await debeFallar('Rechaza una contraseña nueva débil',
  () => usuarios.cambiarPasswordPropia(9, ACTUAL, 'abc'), 'requisitos');
await debeFallar('Rechaza repetir la misma contraseña',
  () => usuarios.cambiarPasswordPropia(9, ACTUAL, ACTUAL), 'distinta');

const cambiado = await usuarios.cambiarPasswordPropia(9, ACTUAL, 'Refac2026Torreon');
check('Acepta una contraseña nueva válida', Boolean(cambiado));

// Cuenta desactivada: la consulta del servicio filtra por activo = 1, así que
// no encuentra el renglón.
definirRespuestaEnsayo((sql) => {
  if (/password_hash\s+FROM\s+dbo\.usuarios/i.test(sql)) return [];
  return undefined;
});
await debeFallar('Una cuenta desactivada no puede cambiar su contraseña',
  () => usuarios.cambiarPasswordPropia(9, ACTUAL, 'Refac2026Torreon'), 'no encontrado');

definirRespuestaEnsayo(null);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n== Freno a los intentos de adivinar contraseñas ==');

const limite = await import('../src/middleware/limiteIntentos.js');

limite.reiniciarIntentos();
const VICTIMA = 'ana.rios@amher.com.mx';

// Los primeros 7 fallos no bloquean: la gente se equivoca al teclear.
for (let i = 0; i < 7; i += 1) {
  await limite.revisarIntentos(VICTIMA);
  limite.registrarFallo(VICTIMA);
}
let pasoElSeptimo = true;
try { await limite.revisarIntentos(VICTIMA); } catch { pasoElSeptimo = false; }
check('Siete errores de dedo no bloquean la cuenta', pasoElSeptimo);

limite.registrarFallo(VICTIMA); // el octavo
const bloqueo = await debeFallar('Al octavo fallo, la cuenta queda bloqueada',
  () => limite.revisarIntentos(VICTIMA), 'demasiados intentos');
check('...responde 429, no 401', bloqueo?.status === 429);
check('...dice cuántos minutos hay que esperar', /\d+ minuto/.test(bloqueo?.message ?? ''));
check('...y trae un código que el frontend puede distinguir', bloqueo?.codigo === 'DEMASIADOS_INTENTOS');

// El bloqueo es por cuenta, no para todo el sistema: si tumbara a todos, el
// ataque más fácil sería dejar sin sistema a la empresa entera.
let otroEntra = true;
try { await limite.revisarIntentos('sofia.cardenas@amher.com.mx'); } catch { otroEntra = false; }
check('Bloquear una cuenta no afecta a las demás', otroEntra);

// Quien sí sabe su contraseña nunca se topa con el freno.
limite.reiniciarIntentos();
for (let i = 0; i < 7; i += 1) limite.registrarFallo(VICTIMA);
limite.limpiarIntentos(VICTIMA);
limite.registrarFallo(VICTIMA);
let entraTrasAcertar = true;
try { await limite.revisarIntentos(VICTIMA); } catch { entraTrasAcertar = false; }
check('Entrar bien borra el historial de fallos', entraTrasAcertar);

// El correo se normaliza: cambiar mayúsculas no reinicia el contador.
limite.reiniciarIntentos();
for (let i = 0; i < 8; i += 1) limite.registrarFallo('  Ana.Rios@AMHER.com.MX  ');
await debeFallar('Cambiar mayúsculas o espacios no esquiva el bloqueo',
  () => limite.revisarIntentos(VICTIMA), 'demasiados intentos');

// Un correo vacío no debe crear entradas basura.
limite.reiniciarIntentos();
limite.registrarFallo('');
limite.registrarFallo(null);
check('Un correo vacío no ocupa memoria', limite.estadoIntentos().cuentas_vigiladas === 0);

limite.reiniciarIntentos();

console.log(`\n${fallos === 0 ? 'USUARIOS: TODAS LAS PRUEBAS PASARON ✓' : `${fallos} PRUEBA(S) FALLARON ✗`}\n`);
process.exit(fallos === 0 ? 0 : 1);
