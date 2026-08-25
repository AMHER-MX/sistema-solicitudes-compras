/**
 * Catálogo simulado de refacciones.
 *
 * Sirve para desarrollar y demostrar el sistema SIN depender de Quiter.
 * En cuanto se configure la conexión a SQL Server (o una API de Quiter) en el
 * .env, el servicio deja de usar este archivo automáticamente
 * (ver services/erp/index.js).
 *
 * Las claves de almacén ('101' Torreón, '102' Gómez Palacio, '103' Monclova,
 * '104' Piedras Negras) son las reales de Quiter, para que el comportamiento en demo se parezca al de producción.
 */

export const CATALOGO_MOCK = [
  { sku: 'FLT-4520',  descripcion: 'Filtro de aceite motor diésel 4520',      linea: 'Filtros',     precio: 385.0,  existencias: { '101': 0,  '102': 3,  '103': 0, '104': 0 } },
  { sku: 'FLT-4521',  descripcion: 'Filtro de aire primario 4521',            linea: 'Filtros',     precio: 640.5,  existencias: { '101': 12, '102': 0,  '103': 4, '104': 0 } },
  { sku: 'BAL-8890',  descripcion: 'Balata delantera cerámica 8890',          linea: 'Frenos',      precio: 1250.0, existencias: { '101': 0,  '102': 0,  '103': 0, '104': 0 } },
  { sku: 'BAL-8891',  descripcion: 'Balata trasera semimetálica 8891',        linea: 'Frenos',      precio: 980.0,  existencias: { '101': 6,  '102': 2,  '103': 0, '104': 0 } },
  { sku: 'ACE-15W40', descripcion: 'Aceite motor 15W40 cubeta 19L',           linea: 'Lubricantes', precio: 2480.0, existencias: { '101': 2,  '102': 0,  '103': 8, '104': 0 } },
  { sku: 'ACE-5W30',  descripcion: 'Aceite sintético 5W30 litro',             linea: 'Lubricantes', precio: 289.0,  existencias: { '101': 45, '102': 30, '103': 22, '104': 0 } },
  { sku: 'BAT-N150',  descripcion: 'Batería 12V 150Ah libre mantenimiento',   linea: 'Eléctrico',   precio: 7350.0, existencias: { '101': 1,  '102': 0,  '103': 0, '104': 0 } },
  { sku: 'AMO-2210',  descripcion: 'Amortiguador delantero servicio pesado',  linea: 'Suspensión',  precio: 3190.0, existencias: { '101': 0,  '102': 1,  '103': 0, '104': 0 } },
  { sku: 'LLA-1100',  descripcion: 'Llanta 11R22.5 16 capas',                 linea: 'Llantas',     precio: 8900.0, existencias: { '101': 8,  '102': 4,  '103': 0, '104': 0 } },
  { sku: 'CLT-3300',  descripcion: 'Kit de clutch 330mm servicio pesado',     linea: 'Transmisión', precio: 15400.0,existencias: { '101': 0,  '102': 0,  '103': 1, '104': 0 } },
  { sku: 'MAN-7712',  descripcion: 'Manguera de radiador superior 7712',      linea: 'Enfriamiento',precio: 725.0,  existencias: { '101': 3,  '102': 0,  '103': 0, '104': 0 } },
  { sku: 'BOM-9080',  descripcion: 'Bomba de agua 9080',                      linea: 'Enfriamiento',precio: 4275.0, existencias: { '101': 0,  '102': 2,  '103': 0, '104': 0 } },
];

/** Normaliza texto para búsquedas tolerantes (sin acentos, minúsculas). */
const normalizar = (t = '') =>
  t.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Busca en el catálogo mock por SKU o por descripción.
 * @param {string} termino
 * @param {string} almacen clave de almacén ('101', '102', ...)
 */
export function buscarMock(termino, almacen) {
  const q = normalizar(termino);
  if (!q) return [];

  return CATALOGO_MOCK.filter(
    (p) => normalizar(p.sku).includes(q) || normalizar(p.descripcion).includes(q),
  ).map((p) => ({
    sku: p.sku,
    descripcion: p.descripcion,
    linea: p.linea,
    precio_lista: p.precio,
    almacen,
    existencia: p.existencias[almacen] ?? 0,
    // Útil para que el vendedor sepa si otra sucursal puede surtir.
    existencia_otras_sucursales: Object.entries(p.existencias)
      .filter(([clave, cant]) => clave !== almacen && cant > 0)
      .map(([clave, cant]) => ({ almacen: clave, existencia: cant })),
  }));
}
