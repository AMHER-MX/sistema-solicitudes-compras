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

const { sqlEmitido } = await import('../src/config/db.js');
const servicio = await import('../src/services/solicitudes.service.js');

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

console.log(`  ${sqlEmitido.length} consultas capturadas`);
check('Se generó SQL para todas las operaciones', sqlEmitido.length >= 15);

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
