/**
 * Fachada del ERP.
 *
 * El resto de la aplicación SOLO habla con este archivo; nunca con axios
 * ni con el catálogo mock directamente. Así, el día que se conecte Quiter
 * no hay que tocar controladores ni frontend.
 *
 * Estrategia:
 *   1. Si QUITER_BASE_URL está configurado -> consulta Quiter.
 *   2. Si Quiter falla (timeout, 500, red caída) -> responde con el mock
 *      y marca origen = 'MOCK_FALLBACK' para que la UI avise al usuario.
 *   3. Si no está configurado -> mock directo (origen = 'MOCK').
 */
import { env } from '../../config/env.js';
import { buscarMock } from './catalogoMock.js';
import { consultarExistenciasQuiter, quiterConfigurado } from './quiterClient.js';

// ── Caché en memoria muy simple (TTL corto) ─────────────────────────────────
// Evita golpear el ERP en cada tecla del buscador del vendedor.
const cache = new Map(); // clave -> { expira: epochMs, valor: {...} }

const leerCache = (clave) => {
  if (env.erp.cacheTtlSeg <= 0) return null;
  const entrada = cache.get(clave);
  if (!entrada) return null;
  if (entrada.expira < Date.now()) {
    cache.delete(clave);
    return null;
  }
  return entrada.valor;
};

const guardarCache = (clave, valor) => {
  if (env.erp.cacheTtlSeg <= 0) return;
  cache.set(clave, { expira: Date.now() + env.erp.cacheTtlSeg * 1000, valor });
};

/**
 * Consulta existencias de un SKU o término de búsqueda.
 *
 * @param {object} opciones
 * @param {string} opciones.termino  SKU exacto o texto parcial
 * @param {string} [opciones.almacen] clave de sucursal; por defecto la del .env
 * @returns {Promise<{origen:string, almacen:string, consultado_en:string, articulos:Array, aviso?:string}>}
 */
export async function consultarExistencias({ termino, almacen }) {
  const alm = almacen || env.erp.almacenDefault;
  const clave = `${alm}::${termino.toLowerCase()}`;

  const enCache = leerCache(clave);
  if (enCache) return { ...enCache, desde_cache: true };

  let resultado;

  if (quiterConfigurado()) {
    try {
      const articulos = await consultarExistenciasQuiter(termino, alm);
      resultado = { origen: 'QUITER', almacen: alm, articulos };
    } catch (error) {
      // No tumbamos la operación del vendedor si el ERP no responde:
      // devolvemos el mock y avisamos claramente en la respuesta.
      console.warn(`[ERP] Quiter no respondió (${error.message}). Usando catálogo local.`);
      resultado = {
        origen: 'MOCK_FALLBACK',
        almacen: alm,
        articulos: buscarMock(termino, alm),
        aviso: 'No se pudo contactar al ERP Quiter; se muestran datos locales de respaldo.',
      };
    }
  } else {
    resultado = {
      origen: 'MOCK',
      almacen: alm,
      articulos: buscarMock(termino, alm),
      aviso: 'Integración con Quiter no configurada (QUITER_BASE_URL vacío).',
    };
  }

  resultado.consultado_en = new Date().toISOString();
  guardarCache(clave, resultado);
  return resultado;
}

/**
 * Devuelve la existencia puntual de un SKU (número).
 * La usa el alta de solicitudes para sellar `existencia_real_almacen`.
 */
export async function existenciaDeSku(sku, almacen) {
  const { articulos } = await consultarExistencias({ termino: sku, almacen });
  const exacto = articulos.find((a) => a.sku.toLowerCase() === String(sku).toLowerCase());
  return exacto ? Number(exacto.existencia) : 0;
}

/** Estado de la integración, para el endpoint /api/health. */
export const estadoErp = () => ({
  configurado: quiterConfigurado(),
  base_url: env.erp.baseUrl || null,
  almacen_default: env.erp.almacenDefault,
  cache_ttl_seg: env.erp.cacheTtlSeg,
});
