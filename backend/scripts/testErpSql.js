/**
 * Pruebas del adaptador de SQL Server (Quiter) — sin necesidad de una base
 * de datos: verifican la consulta generada y el mapeo de resultados.
 *
 *   cd backend && npm run test:erp
 *
 * Las dos primeras pruebas son REGRESIONES de errores reales encontrados en
 * la app de Ventas de refacciones (catosa-api). Si alguien vuelve a
 * introducirlos aquí, estas pruebas fallan.
 */
import { agruparPorArticulo, construirSqlExistencias } from '../src/services/erp/sqlServerClient.js';

let fallos = 0;
const check = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✓' : '  ✗'} ${nombre}${extra ? ` ${extra}` : ''}`);
  if (!condicion) fallos += 1;
};

const ALMACENES = ['101', '102', '101LA', '102LA'];
const sql = construirSqlExistencias(ALMACENES);
// Versión sin comentarios, para que las aserciones no se confundan con el texto explicativo.
const sqlSinComentarios = sql.replace(/--.*$/gm, '');

console.log('\n== SQL generado ==');

// ── REGRESIÓN 1 ──────────────────────────────────────────────────────────────
// En catosa-api la condición era `i.ALMACEN = 101`: comparar la columna de
// texto contra un número obliga a SQL Server a convertir cada renglón a int y
// truena con "Conversion failed ... '102LA' to data type int".
check('No compara ALMACEN contra un número sin comillas',
  !/ALMACEN\s*=\s*\d/.test(sqlSinComentarios));

check('Filtra almacenes con una lista IN parametrizada',
  /ALMACEN\s+IN\s*\(@alm0,\s*@alm1,\s*@alm2,\s*@alm3\)/.test(sqlSinComentarios));

// ── REGRESIÓN 2 ──────────────────────────────────────────────────────────────
// En catosa-api faltaban los paréntesis: `AND a LIKE @b OR c LIKE @b` hace que
// el AND gane precedencia y la búsqueda por descripción se salga del filtro
// de almacén.
const condicionBusqueda = sqlSinComentarios.match(/AND\s*\((.*?)\)\s*GROUP BY/s);
check('Las condiciones OR de la búsqueda van entre paréntesis',
  Boolean(condicionBusqueda) &&
  condicionBusqueda[1].includes('OR') &&
  condicionBusqueda[1].includes('DES_ARTICULO LIKE @busqueda'));

// ── Inyección SQL ────────────────────────────────────────────────────────────
check('Ningún valor del usuario se interpola en el SQL',
  !sql.includes("'") || !/LIKE\s*'%/.test(sql));

check('Todo dato variable viaja como parámetro',
  ['@limite', '@exacto', '@busqueda', '@almacen'].every((p) => sql.includes(p)));

// Una lista de almacenes distinta debe producir tantos parámetros como claves.
const sqlDos = construirSqlExistencias(['101', '102']);
check('La lista de almacenes es configurable',
  sqlDos.includes('@alm0, @alm1') && !sqlDos.includes('@alm2'));

check('Solo lectura: la consulta no modifica nada',
  !/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|MERGE|EXEC)\b/i.test(sqlSinComentarios));

check('Consulta la tabla de inventario correcta (FTIGBI_PR)',
  (sqlSinComentarios.match(/FTIGBI_PR/g) || []).length === 2);

// ── Mapeo de resultados ──────────────────────────────────────────────────────
console.log('\n== Mapeo de renglones a artículos ==');

// Simula lo que devuelve SQL Server: un renglón por artículo + almacén.
const renglones = [
  { ARTICULO: 'FLT-4520', DES_ARTICULO: 'Filtro de aceite 4520', ALMACEN: '101',   EXIS_REALES: 0, COSTO_MEDIO: 385, UBICACION: 'A-12' },
  { ARTICULO: 'FLT-4520', DES_ARTICULO: 'Filtro de aceite 4520', ALMACEN: '102',   EXIS_REALES: 3, COSTO_MEDIO: 385, UBICACION: 'B-04' },
  { ARTICULO: 'FLT-4520', DES_ARTICULO: 'Filtro de aceite 4520', ALMACEN: '101LA', EXIS_REALES: 0, COSTO_MEDIO: 385, UBICACION: null },
  { ARTICULO: 'BAT-N150', DES_ARTICULO: 'Batería 12V 150Ah',     ALMACEN: '101',   EXIS_REALES: 2, COSTO_MEDIO: 7350, UBICACION: 'C-01' },
  { ARTICULO: 'BAT-N150', DES_ARTICULO: 'Batería 12V 150Ah',     ALMACEN: '102',   EXIS_REALES: 0, COSTO_MEDIO: 7350, UBICACION: null },
];

const articulos = agruparPorArticulo(renglones, '101');
const filtro = articulos.find((a) => a.sku === 'FLT-4520');
const bateria = articulos.find((a) => a.sku === 'BAT-N150');

check('Agrupa los renglones en un artículo por SKU', articulos.length === 2);
check('Toma la existencia del almacén consultado', filtro.existencia === 0);
check('Reporta qué otra sucursal sí tiene',
  filtro.existencia_otras_sucursales.length === 1 &&
  filtro.existencia_otras_sucursales[0].almacen === '102' &&
  filtro.existencia_otras_sucursales[0].existencia === 3);
check('No lista sucursales que también están en cero',
  !filtro.existencia_otras_sucursales.some((o) => o.existencia === 0));
check('Usa la ubicación del almacén propio', filtro.ubicacion === 'A-12');
check('Conserva descripción y costo', filtro.descripcion === 'Filtro de aceite 4520' && filtro.precio_lista === 385);
check('Artículo con existencia propia se reporta bien',
  bateria.existencia === 2 && bateria.existencia_otras_sucursales.length === 0);

// Caso borde: el mismo artículo repetido en el almacén consultado se suma.
const sumado = agruparPorArticulo([
  { ARTICULO: 'X', DES_ARTICULO: 'X', ALMACEN: '101', EXIS_REALES: 2, COSTO_MEDIO: 1, UBICACION: 'A' },
  { ARTICULO: 'X', DES_ARTICULO: 'X', ALMACEN: '101', EXIS_REALES: 5, COSTO_MEDIO: 1, UBICACION: 'A' },
], '101');
check('Suma renglones repetidos del mismo almacén', sumado[0].existencia === 7);

// Caso real: Quiter trae varios renglones del mismo articulo en el MISMO otro
// almacen. Deben sumarse en una sola entrada, no listarse repetidos.
const duplicados = agruparPorArticulo([
  { ARTICULO: 'Y', DES_ARTICULO: 'Y', ALMACEN: '101', NOM_ALMACEN: 'TORREON',  EXIS_REALES: 0, COSTO_MEDIO: 1 },
  { ARTICULO: 'Y', DES_ARTICULO: 'Y', ALMACEN: '201', NOM_ALMACEN: 'DURANGO',  EXIS_REALES: 2, COSTO_MEDIO: 1 },
  { ARTICULO: 'Y', DES_ARTICULO: 'Y', ALMACEN: '201', NOM_ALMACEN: 'DURANGO',  EXIS_REALES: 2, COSTO_MEDIO: 1 },
  { ARTICULO: 'Y', DES_ARTICULO: 'Y', ALMACEN: '102', NOM_ALMACEN: 'GOMEZ PALACIO', EXIS_REALES: 1, COSTO_MEDIO: 1 },
], '101');
const otras = duplicados[0].existencia_otras_sucursales;
check('Suma los renglones repetidos de otra sucursal en una sola entrada',
  otras.length === 2 && otras.find((o) => o.almacen === '201').existencia === 4);
check('Ordena las otras sucursales por existencia descendente',
  otras[0].almacen === '201' && otras[1].almacen === '102');
check('Incluye el nombre del almacen',
  otras[0].nombre === 'DURANGO');

check('Ignora renglones sin número de parte',
  agruparPorArticulo([{ ARTICULO: '  ', DES_ARTICULO: 'basura', ALMACEN: '101', EXIS_REALES: 9 }], '101').length === 0);

console.log(`\n${fallos === 0 ? 'ADAPTADOR SQL SERVER: TODAS LAS PRUEBAS PASARON ✓' : `${fallos} PRUEBA(S) FALLARON ✗`}\n`);
process.exit(fallos === 0 ? 0 : 1);
