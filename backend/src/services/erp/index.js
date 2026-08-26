/**
 * Fachada del ERP.
 *
 * El resto de la aplicación SOLO habla con este archivo; nunca con axios ni con
 * el catálogo simulado. Así, cambiar de origen de datos no obliga a tocar
 * controladores ni frontend.
 *
 *   1. API HTTP  — la API interna de refacciones (catosa-api), que ya tiene la
 *                  conexión a Quiter. Es la misma que usa la app de Ventas.
 *   2. MOCK      — catálogo simulado, para desarrollar y capacitar sin ERP.
 *
 * Hubo un tercer camino —conectarse directo a la base de Quiter— que se retiró
 * al mover el sistema a internet: Quiter vive dentro de la red de la empresa y
 * desde fuera no hay forma de alcanzarlo. La API sí es pública, y ya estaba
 * probada. Quien alguna vez quiera el camino directo lo encuentra en el
 * historial del repositorio.
 *
 * Si el origen configurado falla (red caída, servidor apagado), NO se tumba la
 * operación del vendedor: se responde con el catálogo local y se marca el
 * origen como MOCK_FALLBACK para que la interfaz lo advierta con claridad.
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

/** Qué origen de datos está activo en esta instalación. */
export function origenActivo() {
  if (quiterConfigurado()) return 'QUITER_API';
  return 'MOCK';
}

/**
 * ¿Se puede escribir en la base un precio que vino de este origen?
 *
 * La distinción importa y es fácil de equivocar:
 *
 *   QUITER_API      Sí. Es el precio real.
 *   MOCK            Sí. La instalación NO tiene ERP configurado (capacitación,
 *                   pruebas), así que el catálogo simulado es la única verdad
 *                   que hay y ser coherente con él es lo correcto.
 *   MOCK_FALLBACK   NO. Aquí sí hay un ERP de verdad, pero no contestó. Pisar
 *                   un precio real con uno inventado sería el peor error
 *                   posible: quedaría guardado y nadie sabría que es falso.
 */
export const precioConfiable = (origen) => origen === 'QUITER_API' || origen === 'MOCK';

/** Respuesta de respaldo cuando el ERP no está disponible o no está configurado. */
function respuestaMock(termino, almacen, aviso, origen) {
  return { origen, almacen, articulos: buscarMock(termino, almacen), aviso };
}

/**
 * Consulta existencias de un SKU o término de búsqueda.
 *
 * @param {object} opciones
 * @param {string} opciones.termino  número de parte exacto o texto parcial
 * @param {string} [opciones.almacen] clave de almacén; por defecto la del .env
 * @returns {Promise<{origen:string, almacen:string, consultado_en:string, articulos:Array, aviso?:string}>}
 */
export async function consultarExistencias({ termino, almacen }) {
  const alm = almacen || env.erp.almacenDefault;
  const clave = `${alm}::${termino.toLowerCase()}`;

  const enCache = leerCache(clave);
  if (enCache) return { ...enCache, desde_cache: true };

  let resultado;

  switch (origenActivo()) {
    case 'QUITER_API':
      try {
        const articulos = await consultarExistenciasQuiter(termino, alm);
        resultado = { origen: 'QUITER_API', almacen: alm, articulos };
      } catch (error) {
        console.warn(`[ERP] La API de refacciones no respondió (${error.message}). Usando catálogo local.`);
        resultado = respuestaMock(
          termino, alm,
          'No se pudo contactar la API de refacciones; se muestran datos locales de respaldo.',
          'MOCK_FALLBACK',
        );
      }
      break;

    default:
      resultado = respuestaMock(
        termino, alm,
        'Sin conexión al ERP configurada: se muestra el catálogo de demostración.',
        'MOCK',
      );
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
export async function estadoErp() {
  const origen = origenActivo();
  const base = {
    origen,
    almacen_default: env.erp.almacenDefault,
    cache_ttl_seg: env.erp.cacheTtlSeg,
  };

  if (origen === 'QUITER_API') {
    return { ...base, api: { base_url: env.erp.baseUrl } };
  }

  return { ...base, aviso: 'Sin ERP configurado; el sistema usa el catálogo simulado.' };
}
