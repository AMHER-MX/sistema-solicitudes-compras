/**
 * Catálogo simulado de refacciones.
 *
 * Sirve para desarrollar y demostrar el sistema SIN depender de Quiter.
 * En cuanto se configure QUITER_BASE_URL en el .env, el servicio deja de
 * usar este archivo automáticamente (ver services/erp/index.js).
 */

export const CATALOGO_MOCK = [
  { sku: 'FLT-4520',  descripcion: 'Filtro de aceite motor diésel 4520',      linea: 'Filtros',     precio: 385.0,  existencias: { SUC01: 0,  SUC02: 3,  SUC03: 0 } },
  { sku: 'FLT-4521',  descripcion: 'Filtro de aire primario 4521',            linea: 'Filtros',     precio: 640.5,  existencias: { SUC01: 12, SUC02: 0,  SUC03: 4 } },
  { sku: 'BAL-8890',  descripcion: 'Balata delantera cerámica 8890',          linea: 'Frenos',      precio: 1250.0, existencias: { SUC01: 0,  SUC02: 0,  SUC03: 0 } },
  { sku: 'BAL-8891',  descripcion: 'Balata trasera semimetálica 8891',        linea: 'Frenos',      precio: 980.0,  existencias: { SUC01: 6,  SUC02: 2,  SUC03: 0 } },
  { sku: 'ACE-15W40', descripcion: 'Aceite motor 15W40 cubeta 19L',           linea: 'Lubricantes', precio: 2480.0, existencias: { SUC01: 2,  SUC02: 0,  SUC03: 8 } },
  { sku: 'ACE-5W30',  descripcion: 'Aceite sintético 5W30 litro',             linea: 'Lubricantes', precio: 289.0,  existencias: { SUC01: 45, SUC02: 30, SUC03: 22 } },
  { sku: 'BAT-N150',  descripcion: 'Batería 12V 150Ah libre mantenimiento',   linea: 'Eléctrico',   precio: 7350.0, existencias: { SUC01: 1,  SUC02: 0,  SUC03: 0 } },
  { sku: 'AMO-2210',  descripcion: 'Amortiguador delantero servicio pesado',  linea: 'Suspensión',  precio: 3190.0, existencias: { SUC01: 0,  SUC02: 1,  SUC03: 0 } },
  { sku: 'LLA-1100',  descripcion: 'Llanta 11R22.5 16 capas',                 linea: 'Llantas',     precio: 8900.0, existencias: { SUC01: 8,  SUC02: 4,  SUC03: 0 } },
  { sku: 'CLT-3300',  descripcion: 'Kit de clutch 330mm servicio pesado',     linea: 'Transmisión', precio: 15400.0,existencias: { SUC01: 0,  SUC02: 0,  SUC03: 1 } },
  { sku: 'MAN-7712',  descripcion: 'Manguera de radiador superior 7712',      linea: 'Enfriamiento',precio: 725.0,  existencias: { SUC01: 3,  SUC02: 0,  SUC03: 0 } },
  { sku: 'BOM-9080',  descripcion: 'Bomba de agua 9080',                      linea: 'Enfriamiento',precio: 4275.0, existencias: { SUC01: 0,  SUC02: 2,  SUC03: 0 } },
];

/** Normaliza texto para búsquedas tolerantes (sin acentos, minúsculas). */
const normalizar = (t = '') =>
  t.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Busca en el catálogo mock por SKU o por descripción.
 * @param {string} termino
 * @param {string} almacen clave de sucursal (SUC01, SUC02, ...)
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
