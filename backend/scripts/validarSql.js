/**
 * Revisa el SQL que emite la aplicación SIN necesidad de un servidor.
 *
 *   cd backend && npm run test:sql
 *
 * Cómo funciona: arranca la app en modo ensayo (SGC_DRY_RUN=1), donde cada
 * consulta se registra en lugar de ejecutarse. Después se recorre cada consulta
 * capturada y se comprueban las reglas que sí se pueden verificar en frío:
 * que no haya valores concatenados, que se usen construcciones de SQL Server
 * y no de PostgreSQL, y que las escrituras vayan donde deben.
 *
 * OJO: esto NO sustituye correrlo contra un SQL Server de verdad. Detecta
 * errores de forma, no de fondo.
 */
process.env.SGC_DRY_RUN = '1';

const { sqlEmitido, definirRespuestaEnsayo } = await import('../src/config/db.js');
const servicio = await import('../src/services/solicitudes.service.js');
const usuarios = await import('../src/services/usuarios.service.js');
const bcrypt = (await import('bcryptjs')).default;

let fallos = 0;
const check = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✓' : '  ✗'} ${nombre}${extra ? ` ${extra}` : ''}`);
  if (!condicion) fallos += 1;
};

// ─── Se ejercitan todas las rutas que generan SQL ────────────────────────────
console.log('\n== Consultas capturadas ==');

await servicio.crearSolicitud({
  id_vendedor: 1, id_sucursal: 1, id_cliente: 2, prioridad: 'Urgente',
  observaciones: 'prueba', almacen_erp: '101',
  items: [
    { sku_producto: 'FLT-4520', descripcion: 'Filtro', cantidad_solicitada: 3, precio_estimado: 385, existencia_real_almacen: 0 },
    { sku_producto: 'BAL-8890', descripcion: 'Balata', cantidad_solicitada: 1, precio_estimado: null, existencia_real_almacen: 0 },
  ],
});

// Listado sin filtros y con todos los filtros a la vez.
await servicio.listarSolicitudes({});
await servicio.listarSolicitudes({
  id_vendedor: 1, prioridad: 'Urgente', estatus: 'Pendiente,En Cotizacion,Autorizada',
  sucursal: 2, desde: '2026-01-01', hasta: '2026-12-31', busqueda: "O'Brien",
  limite: 50, pagina: 2,
});

await servicio.obtenerSolicitud(1);

await servicio.cambiarEstatus({
  id: 1, id_usuario: 3, estatus_nuevo: 'En Transito',
  comentario: 'OC colocada', fecha_promesa_entrega: '2026-09-15', asignarme: true,
});

await servicio.metricasGerencia({ dias: 30 });
await servicio.metricasGerencia({ dias: 90, sucursal: 2 });

// ─── Administración de usuarios ─────────────────────────────────────────────
// Estas rutas deciden qué hacer según lo que devuelve una consulta previa
// ("¿ya existe el correo?", "¿cuántos Gerentes quedan?"), así que hay que
// darles respuestas creíbles o nunca llegarían al INSERT / UPDATE.
const PASSWORD_ACTUAL = 'ClaveTemporal77';
const HASH_ACTUAL = await bcrypt.hash(PASSWORD_ACTUAL, 4); // 4 rondas: es una prueba

definirRespuestaEnsayo((sql) => {
  if (/FROM\s+dbo\.usuarios\s+WHERE\s+email\s*=\s*@email/i.test(sql)) return [];          // el correo está libre
  if (/COUNT\(\*\)\s+AS\s+total/i.test(sql)) return [{ total: 3 }];                        // hay más Gerentes
  if (/FROM\s+dbo\.sucursales\s+WHERE\s+id\s*=\s*@id/i.test(sql)) return [{ id: 1 }];      // la sucursal existe
  if (/password_hash\s+FROM\s+dbo\.usuarios/i.test(sql)) {
    return [{ id: 7, nombre: 'Ana Ríos', email: 'ana.rios@amher.com.mx', password_hash: HASH_ACTUAL }];
  }
  if (/FROM\s+dbo\.usuarios\s+u/i.test(sql)) {
    return [{ id: 7, nombre: 'Ana Ríos', email: 'ana.rios@amher.com.mx', rol: 'Vendedor', activo: true }];
  }
  return undefined;
});

await usuarios.listarUsuarios({});
await usuarios.listarUsuarios({ q: "O'Brien", rol: 'Comprador', activo: true });
await usuarios.obtenerUsuario(7);
await usuarios.crearUsuario(
  { nombre: 'Ana Ríos', email: 'ana.rios@amher.com.mx', rol: 'Vendedor', sucursal_id: 1 },
  1,
);
await usuarios.actualizarUsuario(7, { nombre: 'Ana Ríos Vega', rol: 'Comprador', sucursal_id: 2, activo: false }, 1);
await usuarios.restablecerPassword(7, 1);
await usuarios.cambiarPasswordPropia(7, PASSWORD_ACTUAL, 'MiClaveNueva2026');
await usuarios.cuentasDemoActivas();

definirRespuestaEnsayo(null);

console.log(`  ${sqlEmitido.length} consultas capturadas`);
check('Se generó SQL para todas las operaciones', sqlEmitido.length >= 25);

// ─── Reglas que se pueden verificar en frío ─────────────────────────────────
console.log('\n== Seguridad ==');

// Un valor de usuario concatenado aparecería tal cual dentro del SQL.
const valoresDelUsuario = ["O'Brien", 'FLT-4520', 'OC colocada', '2026-09-15', 'prueba'];
const filtrado = sqlEmitido.filter((s) => valoresDelUsuario.some((v) => s.includes(v)));
check('Ningún valor del usuario acaba dentro del texto del SQL',
  filtrado.length === 0,
  filtrado.length ? `(${filtrado[0].slice(0, 90)}...)` : '');

check('Todas las consultas usan parámetros con @',
  sqlEmitido.every((s) => !/\b(SELECT|INSERT|UPDATE)\b/i.test(s) || /@\w+/.test(s) || /SYSUTCDATETIME/.test(s)));

console.log('\n== Contraseñas ==');

// Ni la contraseña ni su hash pueden acabar dentro del texto de una consulta:
// ahí quedarían en cualquier log de SQL Server que alguien active.
const secretos = [PASSWORD_ACTUAL, 'MiClaveNueva2026', HASH_ACTUAL, '$2a$', '$2b$'];
const conSecretos = sqlEmitido.filter((s) => secretos.some((v) => s.includes(v)));
check('Ninguna contraseña ni hash aparece en el texto del SQL',
  conSecretos.length === 0,
  conSecretos.length ? `(${conSecretos[0].slice(0, 90)}...)` : '');

// El listado de administración no debe traer el hash: si no se selecciona,
// no se puede filtrar por accidente en una respuesta JSON.
const lecturasDeUsuarios = sqlEmitido.filter((s) =>
  /^\s*SELECT/i.test(s) && /dbo\.usuarios\s+u\b/i.test(s));
check('El listado de usuarios no selecciona password_hash',
  lecturasDeUsuarios.length > 0 && !lecturasDeUsuarios.some((s) => /u\.password_hash/i.test(s)),
  `(${lecturasDeUsuarios.length} lecturas)`);

// Al cambiar o restablecer, siempre se escribe la bandera y la fecha junto
// con el hash. Si se olvidara, el usuario quedaría obligado a cambiar la
// contraseña para siempre —o nunca.
const cambiosDePassword = sqlEmitido.filter((s) => /UPDATE\s+dbo\.usuarios/i.test(s) && /password_hash\s*=/i.test(s));
check('Todo cambio de contraseña actualiza la bandera y la fecha',
  cambiosDePassword.length >= 2
  && cambiosDePassword.every((s) => /debe_cambiar_password\s*=/i.test(s) && /password_actualizado_en\s*=/i.test(s)),
  `(${cambiosDePassword.length} cambios)`);

console.log('\n== Dialecto: debe ser SQL Server, no PostgreSQL ==');

const rastrosPostgres = [
  [/\$\d/, 'parámetros estilo $1'],
  [/\bILIKE\b/i, 'ILIKE'],
  [/\bRETURNING\b/i, 'RETURNING'],
  [/\bLIMIT\b/i, 'LIMIT'],
  [/\bNOW\(\)/i, 'NOW()'],
  [/::\w+/, 'casts con ::'],
  [/\bFILTER\s*\(/i, 'agregados con FILTER'],
  [/\bEXTRACT\s*\(\s*EPOCH/i, 'EXTRACT(EPOCH'],
  [/\bON CONFLICT\b/i, 'ON CONFLICT'],
  [/\bFOR UPDATE\b/i, 'SELECT ... FOR UPDATE'],
  [/\bSERIAL\b/i, 'SERIAL'],
  [/\bTIMESTAMPTZ\b/i, 'TIMESTAMPTZ'],
];

for (const [patron, nombre] of rastrosPostgres) {
  const culpables = sqlEmitido.filter((s) => patron.test(s));
  check(`Sin ${nombre}`, culpables.length === 0,
    culpables.length ? `(${culpables[0].slice(0, 80).replace(/\s+/g, ' ')}...)` : '');
}

console.log('\n== Construcciones esperadas de SQL Server ==');

const alguna = (patron) => sqlEmitido.some((s) => patron.test(s));

check('Los INSERT devuelven la fila con OUTPUT INSERTED', alguna(/OUTPUT\s+INSERTED\./i));
check('La paginación usa OFFSET ... FETCH NEXT', alguna(/OFFSET\s+@offset\s+ROWS\s+FETCH\s+NEXT\s+@limite\s+ROWS\s+ONLY/i));
check('El bloqueo de renglón usa WITH (UPDLOCK, ROWLOCK)', alguna(/WITH\s*\(\s*UPDLOCK\s*,\s*ROWLOCK\s*\)/i));
check('Los tiempos se calculan con DATEDIFF', alguna(/DATEDIFF\s*\(\s*SECOND/i));
check('Las fechas usan SYSUTCDATETIME', alguna(/SYSUTCDATETIME\(\)/i));
check('El top de faltantes usa TOP (n)', alguna(/SELECT\s+TOP\s*\(\s*10\s*\)/i));
check('Los conteos condicionales usan SUM(CASE WHEN ...)', alguna(/SUM\s*\(\s*CASE\s+WHEN/i));

console.log('\n== Solo se escribe en las tablas propias ==');

// Ninguna consulta de este servicio debe tocar tablas del ERP.
const tablasQuiter = /\b(FTIGBI_PR|FTSABI_PR|FMCUBI_PR|FTPDCBI_PR)\b/i;
check('Ninguna consulta toca tablas de Quiter', !sqlEmitido.some((s) => tablasQuiter.test(s)));

const escrituras = sqlEmitido.filter((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s));
const tablasPropias = /dbo\.(solicitudes_compras|solicitudes_detalle|solicitud_historial|usuarios|clientes|sucursales)/i;
check('Toda escritura va a una tabla del sistema',
  escrituras.length > 0 && escrituras.every((s) => tablasPropias.test(s)),
  `(${escrituras.length} escrituras)`);

check('No hay DROP ni TRUNCATE en el código de la aplicación',
  !sqlEmitido.some((s) => /\b(DROP|TRUNCATE)\b/i.test(s)));

// Se guarda el SQL capturado por si hay que revisarlo a mano.
// La carpeta temporal se pregunta al sistema: en Windows no existe /tmp.
// Si por lo que sea no se puede escribir, no se cae la prueba: el volcado
// es una comodidad, no parte de la verificación.
let volcado = null;
try {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  volcado = path.join(os.tmpdir(), 'sgc-sql-emitido.sql');
  await fs.writeFile(volcado, sqlEmitido.join('\n\n-- ─────────────\n\n'), 'utf8');
} catch (error) {
  volcado = null;
  console.log(`\n(No se pudo guardar el volcado del SQL: ${error.message})`);
}

console.log(`\n${fallos === 0 ? 'SQL: TODAS LAS REVISIONES PASARON ✓' : `${fallos} REVISIÓN(ES) FALLARON ✗`}`);
if (volcado) console.log(`(El SQL capturado quedó en ${volcado})`);
console.log('');
process.exit(fallos === 0 ? 0 : 1);
