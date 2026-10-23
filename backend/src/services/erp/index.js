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
import {
  consultarClientesQuiter, consultarExistenciasQuiter, quiterConfigurado,
} from './quiterClient.js';

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
 * ¿Está contestando el ERP AHORA MISMO?
 *
 * `origenActivo()` solo dice cómo está configurada la instalación; con Quiter
 * configurado contesta 'QUITER_API' aunque la API lleve horas caída. Eso hizo
 * que una caída fuera invisible: /api/health se veía sano y lo único que
 * avisaba era una barra color ámbar que un vendedor con prisa no lee.
 *
 * Esta función sí pregunta. Hace una consulta de verdad y mira con qué origen
 * vuelve: si vuelve como MOCK_FALLBACK, el ERP no está respondiendo.
 *
 * El término de sonda es uno que no le va a encontrar nada a nadie. No importa
 * que la respuesta venga vacía —lo que se está midiendo es si CONTESTA—, y así
 * no se arrastra un catálogo entero cada vez que alguien mira la salud.
 * Además pasa por el mismo caché de 30 segundos que el resto, así que
 * revisarla seguido no le pega al ERP.
 *
 * Devuelve `responde: null` cuando no hay ERP que probar (instalación de
 * capacitación). Null no es "falla": es "no aplica", y conviene no confundirlos.
 */
const TERMINO_SONDA = '__sonda_de_salud__';

export async function comprobarErp() {
  const configurado = origenActivo();
  if (configurado !== 'QUITER_API') {
    return { configurado, responde: null, origen: 'MOCK' };
  }

  try {
    const { origen } = await consultarExistencias({ termino: TERMINO_SONDA });
    return { configurado, responde: origen === 'QUITER_API', origen };
  } catch (error) {
    // consultarExistencias ya atrapa lo suyo; si algo llegara hasta aquí, se
    // reporta como caído en vez de tumbar la revisión de salud entera.
    return { configurado, responde: false, origen: 'MOCK_FALLBACK', error: error.message };
  }
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

/**
 * Padrón de clientes del ERP.
 *
 * Devuelve `null` —no una lista vacía— cuando no hay ERP configurado o cuando
 * no contestó. La diferencia importa: quien sincroniza tiene que poder
 * distinguir "el ERP dice que no hay clientes" de "no pude preguntar", porque
 * lo segundo NUNCA debe hacerle creer que el padrón se vació.
 */
export async function clientesDelErp() {
  if (origenActivo() !== 'QUITER_API') return null;

  try {
    return await consultarClientesQuiter();
  } catch (error) {
    console.warn(`[ERP] No se pudo leer el padrón de clientes (${error.message}).`);
    return null;
  }
}

/** Estado de la integración, para el endpoint /api/health. */
export async function estadoErp() {
  const origen = origenActivo();
  const base = {
    origen,
    almacen_default: env.erp.almacenDefault,
    cache_ttl_seg: env.erp.cacheTtlSeg,
  };

  if (origen !== 'QUITER_API') {
    return { ...base, responde: null, aviso: 'Sin ERP configurado; el sistema usa el catálogo simulado.' };
  }

  // `origen` dice cómo está configurado esto; `responde` dice si de verdad
  // contesta. Antes solo iba lo primero, y por eso una caída de Quiter se veía
  // igual de sana que un día normal: lo único que avisaba era la barra ámbar
  // del buscador. Un monitoreo que no puede distinguir las dos cosas no sirve
  // para lo único que se le pide.
  const prueba = await comprobarErp();

  return {
    ...base,
    api: { base_url: env.erp.baseUrl },
    responde: prueba.responde,
    // En texto, para quien lea esto desde el navegador sin interpretar un booleano.
    estado: prueba.responde ? 'contestando' : 'NO CONTESTA',
    ...(prueba.responde ? {} : {
      aviso: 'El ERP está configurado pero no responde. El buscador está mostrando '
           + 'el catálogo de respaldo y NO se pueden levantar cotizaciones de catálogo.',
    }),
  };
}
