/**
 * Cliente HTTP hacia la API interna de refacciones (catosa-api).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ORIGEN "SIN CREDENCIALES NUEVAS"
 * ─────────────────────────────────────────────────────────────────────────────
 * Ese servidor ya tiene la conexión a la base de datos de Quiter, así que este
 * sistema puede leer existencias sin abrir una segunda conexión al ERP ni pedir
 * un usuario de base de datos aparte.
 *
 * Requiere el endpoint `GET /api/existencias`, que devuelve la existencia
 * DESGLOSADA POR ALMACÉN. No sirve `/api/productos`: ese suma todos los
 * almacenes en una sola cifra y no permite saber si es MI sucursal la que está
 * en cero, que es justo lo que decide si se compra o se pide un traspaso.
 *
 * Configuración en el .env:
 *   QUITER_BASE_URL=https://api.catosaapps.lat
 */
import axios from 'axios';
import { env } from '../../config/env.js';

// Path del servicio de existencias por almacén.
const RUTA_EXISTENCIAS = '/api/existencias';

// Padrón de clientes. Devuelve la lista COMPLETA: no acepta filtro de
// búsqueda, así que no tiene caso llamarla en cada tecla del buscador. Por eso
// los clientes se sincronizan a la base local y ahí se buscan.
const RUTA_CLIENTES = '/api/clientes';

/** Instancia de axios reutilizable con timeout y credenciales opcionales. */
const http = axios.create({
  baseURL: env.erp.baseUrl || undefined,
  timeout: env.erp.timeoutMs,
  headers: {
    Accept: 'application/json',
    ...(env.erp.apiKey ? { Authorization: `Bearer ${env.erp.apiKey}` } : {}),
  },
});

/**
 * Normaliza un artículo al contrato interno del sistema.
 * Se aceptan varios nombres de campo para tolerar cambios en el otro extremo.
 */
function mapearArticulo(a, almacen) {
  const otras = Array.isArray(a.existencia_otras_sucursales)
    ? a.existencia_otras_sucursales
    : (a.otros_almacenes ?? []);

  return {
    sku: (a.sku ?? a.Parte ?? a.ARTICULO ?? '').toString().trim(),
    descripcion: (a.descripcion ?? a.Descripcion ?? a.DES_ARTICULO ?? '').toString().trim(),
    linea: a.linea ?? null,
    precio_lista: Number(a.precio_lista ?? a.Precio ?? a.COSTO_MEDIO ?? 0),
    ubicacion: a.ubicacion ?? a.Ubicacion ?? null,
    almacen: a.almacen ?? almacen,
    existencia: Number(a.existencia ?? a.Existencia ?? 0),
    existencia_otras_sucursales: otras
      .map((o) => ({
        almacen: (o.almacen ?? o.clave ?? '').toString().trim(),
        nombre: o.nombre ?? null,
        existencia: Number(o.existencia ?? o.stock ?? 0),
      }))
      .filter((o) => o.existencia > 0),
  };
}

/** ¿Está configurada la integración por HTTP? */
export const quiterConfigurado = () => Boolean(env.erp.baseUrl);

/**
 * Consulta existencias por número de parte o descripción.
 *
 * @param {string} termino  SKU o texto de búsqueda
 * @param {string} almacen  clave de almacén de la sucursal que consulta
 * @returns {Promise<Array>} artículos en el formato interno
 */
export async function consultarExistenciasQuiter(termino, almacen) {
  const { data } = await http.get(RUTA_EXISTENCIAS, {
    params: { sku: termino, almacen },
  });

  // Se acepta un arreglo directo o un objeto con la lista dentro.
  const articulos = Array.isArray(data)
    ? data
    : (data?.articulos ?? data?.data ?? data?.items ?? []);

  return articulos.map((a) => mapearArticulo(a, almacen));
}

/**
 * Normaliza un cliente del ERP al contrato interno.
 *
 * De todo lo que manda la API se toma SOLO lo que sirve para identificar al
 * cliente en una cotización: código, nombre y dónde está. Las cifras de venta
 * mensual y promedio que también vienen ahí se quedan fuera a propósito — este
 * sistema no las necesita, y guardar datos comerciales que nadie va a usar es
 * cargar con una responsabilidad a cambio de nada.
 */
function mapearCliente(c) {
  const nombre = (c.NombreCompleto ?? c.Cliente ?? c.nombre ?? '').toString().trim();

  return {
    codigo: (c.Codigo ?? c.codigo ?? c.CUENTA ?? '').toString().trim(),
    nombre,
    ciudad: (c.Ciudad ?? c.ciudad ?? '').toString().trim() || null,
    estado: (c.Estado ?? c.estado ?? '').toString().trim() || null,
  };
}

/**
 * Trae el padrón completo de clientes.
 *
 * Son unos cientos de renglones, no un catálogo de piezas: cabe de sobra en
 * una llamada y en la base local.
 *
 * @returns {Promise<Array<{codigo:string, nombre:string, ciudad:string|null, estado:string|null}>>}
 */
export async function consultarClientesQuiter() {
  const { data } = await http.get(RUTA_CLIENTES);

  const lista = Array.isArray(data)
    ? data
    : (data?.clientes ?? data?.data ?? data?.items ?? []);

  return lista
    .map(mapearCliente)
    // Un cliente sin código no se puede sincronizar (no hay con qué
    // identificarlo la próxima vez) y uno sin nombre no sirve de nada.
    .filter((c) => c.codigo && c.nombre);
}
