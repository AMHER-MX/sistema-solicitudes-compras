/**
 * El vigía: lo que el sistema hace solo, sin que nadie entre a empujarlo.
 *
 * Tres tareas que nadie tiene que acordarse de hacer:
 *
 *   1. VENCER   Las cotizaciones enviadas cuyo plazo se cumplió pasan a
 *               Vencida. Si alguien las quería vivas, tenía un mes para
 *               cancelarlas a mano o convertirlas en pedido.
 *
 *   2. PRECIOS  A los documentos vivos se les vuelve a preguntar el precio a
 *               Quiter. En una cotización ya enviada eso NO cambia lo que se
 *               le prometió al cliente: solo actualiza la referencia, para
 *               poder avisar "esto subió 8% desde que lo cotizaste".
 *
 *   3. CLIENTES Se refresca el padrón desde Quiter, para que un cliente dado
 *               de alta esta mañana se pueda cotizar hoy mismo.
 *
 * POR QUÉ VIVE DENTRO DEL SERVIDOR
 *   El hospedaje mantiene el proceso corriendo, así que un temporizador aquí
 *   basta y no hay que configurar ni pagar un programador de tareas aparte.
 *   Lo que sí hace falta es que sea seguro: si el servidor se reinicia a media
 *   corrida, o si algún día hay dos copias corriendo, nada se debe vencer dos
 *   veces ni dejar la bitácora con movimientos repetidos. De eso se encarga el
 *   propio UPDATE de `vencerCotizacionesCaducadas`, que selecciona y escribe
 *   en una sola instrucción.
 *
 * SI FALLA
 *   No tumba el servidor. Un ERP caído o una consulta lenta no puede impedir
 *   que la gente entre a capturar: se anota en la bitácora y se reintenta en
 *   la siguiente vuelta.
 */
import { env } from '../config/env.js';
import { sincronizarClientes } from './clientes.service.js';
import {
  documentosParaRefrescarPrecio, refrescarPrecios, vencerCotizacionesCaducadas,
} from './solicitudes.service.js';

/** Cada cuánto despierta. Una hora es de sobra para algo que mide en días. */
const CADA_MS = 60 * 60 * 1000;

/** Al arrancar espera un poco: primero que el servidor empiece a atender. */
const ESPERA_INICIAL_MS = 30 * 1000;

let temporizador = null;
let corriendo = false;

/**
 * Vence las cotizaciones caducadas.
 * @returns {Promise<number>} cuántas venció
 */
async function tareaVencimientos() {
  const vencidas = await vencerCotizacionesCaducadas();
  if (vencidas.length) {
    const folios = vencidas.map((v) => v.folio).join(', ');
    console.log(`[vigía] ${vencidas.length} cotización(es) vencida(s) por falta de respuesta: ${folios}`);
  }
  return vencidas.length;
}

/**
 * Refresca precios de los documentos vivos.
 *
 * De uno en uno a propósito: el objetivo es que los precios estén al día para
 * cuando alguien abra la pantalla, no terminar rápido. Ir en serie deja al ERP
 * atendiendo a las personas, que sí están esperando.
 *
 * @returns {Promise<{revisados:number, conAlza:number}>}
 */
async function tareaPrecios() {
  const documentos = await documentosParaRefrescarPrecio();
  let conAlza = 0;

  for (const doc of documentos) {
    try {
      const { cambios } = await refrescarPrecios(doc.id);
      if (cambios.length) conAlza += 1;
    } catch (error) {
      console.warn(`[vigía] No se pudieron refrescar los precios de ${doc.folio}: ${error.message}`);
    }
  }

  if (conAlza) {
    console.log(`[vigía] ${conAlza} de ${documentos.length} documento(s) traen partidas con precio distinto al cotizado.`);
  }
  return { revisados: documentos.length, conAlza };
}

/**
 * Refresca el padrón de clientes.
 *
 * Si el ERP no contesta no pasa nada: el servicio se niega a tocar la tabla
 * antes que arriesgarse a dejar a los vendedores sin clientes a quién cotizar.
 */
async function tareaClientes() {
  const r = await sincronizarClientes();

  if (!r.ok) {
    console.warn(`[vigía] Padrón de clientes sin actualizar (${r.motivo}). Se queda el que había.`);
    return r;
  }
  if (r.nuevos || r.desactivados) {
    console.log(`[vigía] Padrón de clientes: ${r.total} en Quiter`
              + `${r.nuevos ? `, ${r.nuevos} nuevo(s)` : ''}`
              + `${r.desactivados ? `, ${r.desactivados} dado(s) de baja` : ''}.`);
  }
  return r;
}

/**
 * Una vuelta completa. Exportada para poder dispararla a mano desde una
 * prueba sin esperar una hora.
 */
export async function darUnaVuelta() {
  if (corriendo) {
    console.log('[vigía] La vuelta anterior sigue en curso; esta se salta.');
    return null;
  }
  corriendo = true;

  const arranque = Date.now();
  try {
    const vencidas = await tareaVencimientos();
    // Los precios solo tienen sentido si hay a quién preguntarle. Sin ERP
    // configurado, el catálogo simulado devolvería precios inventados y
    // pisaría los reales: mejor no tocar nada.
    const precios = env.erp.baseUrl ? await tareaPrecios() : { revisados: 0, conAlza: 0 };
    const clientes = env.erp.baseUrl ? await tareaClientes() : { ok: false, motivo: 'sin ERP' };

    return { vencidas, ...precios, clientes, ms: Date.now() - arranque };
  } catch (error) {
    // Que el vigía falle no puede impedir que la gente use el sistema.
    console.error(`[vigía] La vuelta falló: ${error.message}`);
    return null;
  } finally {
    corriendo = false;
  }
}

/** Arranca el vigía. Idempotente: llamarlo dos veces no crea dos relojes. */
export function iniciarVigia() {
  if (temporizador) return;

  const primera = setTimeout(() => { darUnaVuelta(); }, ESPERA_INICIAL_MS);
  // unref: un temporizador pendiente no debe impedir que el proceso termine
  // cuando alguien lo detiene a propósito.
  primera.unref?.();

  temporizador = setInterval(() => { darUnaVuelta(); }, CADA_MS);
  temporizador.unref?.();

  console.log(`[vigía] Activo: revisa vencimientos, precios y clientes `
            + `cada ${CADA_MS / 60000} minutos.`);
}

/** Lo detiene. La usan las pruebas para que el proceso pueda salir. */
export function detenerVigia() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
