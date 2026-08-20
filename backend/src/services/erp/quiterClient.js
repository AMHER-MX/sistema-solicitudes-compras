/**
 * Cliente HTTP hacia el ERP Quiter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ÚNICO ARCHIVO A AJUSTAR CUANDO SE CONECTE QUITER DE VERDAD
 * ─────────────────────────────────────────────────────────────────────────────
 * Solo hay dos cosas que cambiar:
 *   1. RUTA_EXISTENCIAS  -> el path real que expone el middleware de Quiter.
 *   2. mapearRespuesta() -> cómo se llaman los campos que devuelve Quiter.
 *
 * Todo lo demás (timeouts, headers, manejo de error, caché) ya está resuelto.
 */
import axios from 'axios';
import { env } from '../../config/env.js';

// Path del servicio de existencias en el middleware/API de Quiter.
const RUTA_EXISTENCIAS = '/api/v1/refacciones/existencias';

/** Instancia de axios reutilizable con timeout y credenciales. */
const http = axios.create({
  baseURL: env.erp.baseUrl || undefined,
  timeout: env.erp.timeoutMs,
  headers: {
    'Content-Type': 'application/json',
    ...(env.erp.apiKey ? { Authorization: `Bearer ${env.erp.apiKey}` } : {}),
  },
});

/**
 * Traduce la respuesta de Quiter al contrato interno del sistema.
 * Se aceptan varios nombres de campo porque cada instalación de Quiter
 * suele publicar el servicio con su propia nomenclatura.
 */
function mapearRespuesta(fila, almacen) {
  return {
    sku:            fila.sku ?? fila.codigo ?? fila.codigo_articulo ?? fila.CODIGO ?? '',
    descripcion:    fila.descripcion ?? fila.desc ?? fila.DESCRIPCION ?? '',
    linea:          fila.linea ?? fila.familia ?? null,
    precio_lista:   Number(fila.precio ?? fila.precio_lista ?? fila.PRECIO ?? 0),
    almacen:        fila.almacen ?? almacen,
    existencia:     Number(fila.existencia ?? fila.stock ?? fila.disponible ?? fila.EXISTENCIA ?? 0),
    existencia_otras_sucursales: Array.isArray(fila.otros_almacenes)
      ? fila.otros_almacenes.map((o) => ({
          almacen: o.almacen ?? o.clave,
          existencia: Number(o.existencia ?? o.stock ?? 0),
        }))
      : [],
  };
}

/** ¿Está configurada la integración? Si no, el servicio usará el mock. */
export const quiterConfigurado = () => Boolean(env.erp.baseUrl);

/**
 * Consulta existencias en Quiter.
 * @param {string} termino  SKU o texto de búsqueda
 * @param {string} almacen  clave de almacén/sucursal
 * @returns {Promise<Array>} artículos en el formato interno
 */
export async function consultarExistenciasQuiter(termino, almacen) {
  const { data } = await http.get(RUTA_EXISTENCIAS, {
    params: { q: termino, almacen },
  });

  // Quiter puede responder un arreglo directo o envuelto en { data: [...] }.
  const filas = Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
  return filas.map((f) => mapearRespuesta(f, almacen));
}
