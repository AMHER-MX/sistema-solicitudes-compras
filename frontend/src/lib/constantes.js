/**
 * Catálogos y formateadores compartidos por toda la interfaz.
 * Mantener aquí los colores de badge evita que cada pantalla invente los suyos.
 */

/**
 * Los dos documentos del sistema. Es el MISMO folio: una cotización aprobada
 * se vuelve pedido sin cambiar de número.
 */
export const TIPOS = { COTIZACION: 'Cotizacion', PEDIDO: 'Pedido' };

/** Cómo se le dice a cada uno en pantalla (con acento, que el dato no lleva). */
export const NOMBRE_TIPO = {
  Cotizacion: 'Cotización',
  Pedido:     'Pedido',
};

export const ESTATUS_COTIZACION = ['Borrador', 'Con Compras', 'Enviada', 'Vencida', 'Cancelada'];
export const ESTATUS_PEDIDO = [
  'Pendiente', 'Con Proveedor', 'Autorizada', 'En Transito',
  'Recibido', 'Cancelada', 'Rechazada',
];

export const ESTATUS = [...new Set([...ESTATUS_COTIZACION, ...ESTATUS_PEDIDO])];

export const PRIORIDADES = ['Urgente', 'Normal', 'Baja'];

/**
 * Cómo va el trabajo de Compras SOBRE una cotización.
 *
 * Es un eje aparte del estatus del documento. Para el vendedor la cotización
 * está "Con Compras"; para el comprador está "Cotización Parcial". Las dos
 * frases son ciertas al mismo tiempo y describen cosas distintas.
 */
export const ESTATUS_COMPRAS = [
  'En Cotizacion', 'Cotizacion Parcial', 'Completada', 'Cancelada',
];

export const NOMBRE_ESTATUS_COMPRAS = {
  'En Cotizacion':      'En cotización',
  'Cotizacion Parcial': 'Cotización parcial',
  'Completada':         'Completada',
  'Cancelada':          'Cancelada',
};

export const EXPLICACION_ESTATUS_COMPRAS = {
  'En Cotizacion':      'Pidiendo precios a proveedores.',
  'Cotizacion Parcial': 'Ya hay precio de algunas partidas; faltan otras.',
  'Completada':         'Todas las partidas tienen precio y tiempo de entrega.',
  'Cancelada':          'No se consigue. El vendedor decide qué hacer.',
};

export const ESTILO_ESTATUS_COMPRAS = {
  'En Cotizacion':      { clases: 'bg-brand/10    text-ink ring-brand/40',    punto: 'bg-brand'    },
  'Cotizacion Parcial': { clases: 'bg-warning/15  text-ink ring-warning/45',  punto: 'bg-warning'  },
  'Completada':         { clases: 'bg-good/12    text-ink ring-good/45',    punto: 'bg-good'     },
  'Cancelada':          { clases: 'bg-critical/12 text-ink ring-critical/45', punto: 'bg-critical' },
};

/**
 * El rango de entrega, dicho como lo diría una persona.
 *
 * "Del 30 de ago al 2 de sep" si hay rango; la fecha sola si el proveedor se
 * comprometió a un día exacto; un guion si todavía no hay nada prometido.
 */
export function rangoEntrega(desde, hasta) {
  if (!desde && !hasta) return '—';
  if (!hasta || hasta === desde) return fecha(desde);
  return `Del ${fecha(desde)} al ${fecha(hasta)}`;
}

/**
 * Qué significa cada estatus, en una línea y en cristiano. Se muestra como
 * ayuda al pasar el cursor, porque "Con Compras" y "Con Proveedor" se parecen
 * lo suficiente como para confundirse.
 */
export const EXPLICACION_ESTATUS = {
  'Borrador':      'Lista para mandarse al cliente. Todavía nadie la ha visto.',
  'Con Compras':   'Tiene faltantes: Compras está consiguiendo precio y tiempo de entrega.',
  'Enviada':       'Ya la tiene el cliente. El precio quedó congelado y corre el plazo.',
  'Vencida':       'Pasó su plazo sin que el cliente contestara.',
  'Pendiente':     'El cliente aprobó. Esperando que Compras la tome.',
  'Con Proveedor': 'Compras está pidiendo precio y disponibilidad al proveedor.',
  'Autorizada':    'Aprobada para comprarse.',
  'En Transito':   'Ya viene en camino.',
  'Recibido':      'Llegó al almacén.',
  'Cancelada':     'Se canceló a mano.',
  'Rechazada':     'No procede.',
};

/**
 * Estilo de cada estatus. El texto siempre acompaña al color:
 * nunca se comunica el estado solo con el color (accesibilidad).
 */
export const ESTILO_ESTATUS = {
  // Cotización
  'Borrador':      { clases: 'bg-surface-alt text-ink-2 ring-hairline',    punto: 'bg-muted'    },
  'Con Compras':   { clases: 'bg-warning/15  text-ink   ring-warning/45',  punto: 'bg-warning'  },
  'Enviada':       { clases: 'bg-brand/10    text-ink   ring-brand/40',    punto: 'bg-brand'    },
  'Vencida':       { clases: 'bg-critical/12 text-ink   ring-critical/45', punto: 'bg-critical' },
  // Pedido
  'Pendiente':     { clases: 'bg-warning/15  text-ink   ring-warning/45',  punto: 'bg-warning'  },
  'Con Proveedor': { clases: 'bg-brand/10    text-ink   ring-brand/40',    punto: 'bg-brand'    },
  'Autorizada':    { clases: 'bg-brand/15    text-ink   ring-brand/55',    punto: 'bg-brand-strong' },
  'En Transito':   { clases: 'bg-serious/15  text-ink   ring-serious/50',  punto: 'bg-serious'  },
  'Recibido':      { clases: 'bg-good/12     text-ink   ring-good/45',     punto: 'bg-good'     },
  // Terminales de ambos
  'Cancelada':     { clases: 'bg-surface-alt text-ink-2 ring-hairline',    punto: 'bg-muted'    },
  'Rechazada':     { clases: 'bg-critical/12 text-ink   ring-critical/45', punto: 'bg-critical' },
};

export const ESTILO_PRIORIDAD = {
  Urgente: { clases: 'bg-critical/12 text-ink   ring-critical/45', punto: 'bg-critical' },
  Normal:  { clases: 'bg-brand/10    text-ink   ring-brand/35',    punto: 'bg-brand'    },
  Baja:    { clases: 'bg-surface-alt text-ink-2 ring-hairline',    punto: 'bg-muted'    },
};

export const ROLES = ['Vendedor', 'Comprador', 'Gerente'];

/** Qué hace cada rol, en una línea. Se muestra al dar de alta una cuenta. */
export const DESCRIPCION_ROL = {
  Vendedor:  'Levanta solicitudes y da seguimiento a las suyas.',
  Comprador: 'Trabaja la mesa de compras: cotiza, autoriza y mueve estatus.',
  Gerente:   'Ve todo, mueve estatus y administra las cuentas de usuario.',
};

export const ESTILO_ROL = {
  Vendedor:  { clases: 'bg-brand/10    text-ink   ring-brand/35',    punto: 'bg-brand'    },
  Comprador: { clases: 'bg-serious/15  text-ink   ring-serious/50',  punto: 'bg-serious'  },
  Gerente:   { clases: 'bg-good/12     text-ink   ring-good/45',     punto: 'bg-good'     },
};

/** Estados que ya cerraron el documento. */
export const ESTATUS_FINALES = ['Recibido', 'Cancelada', 'Rechazada', 'Vencida'];

/** Transiciones válidas (espejo de backend/src/utils/estatus.js). */
export const TRANSICIONES = {
  'Borrador':      ['Con Compras', 'Enviada', 'Cancelada'],
  'Con Compras':   ['Enviada', 'Borrador', 'Cancelada'],
  'Enviada':       ['Vencida', 'Cancelada'],
  'Vencida':       [],
  'Pendiente':     ['Con Proveedor', 'Autorizada', 'Rechazada', 'Cancelada'],
  'Con Proveedor': ['Autorizada', 'En Transito', 'Rechazada', 'Cancelada'],
  'Autorizada':    ['En Transito', 'Cancelada'],
  'En Transito':   ['Recibido', 'Cancelada'],
  'Recibido':      [],
  'Cancelada':     [],
  'Rechazada':     [],
};

/* ───────────────────────────── Formateadores ─────────────────────────────── */

const fmtMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
});
const fmtNumero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

export const moneda = (n) => fmtMoneda.format(Number(n) || 0);
export const numero = (n) => fmtNumero.format(Number(n) || 0);

export const fecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fechaHora = (iso) =>
  iso ? new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '—';

/** "hace 3 días" — para las tarjetas del vendedor. */
export const haceCuanto = (iso) => {
  if (!iso) return '—';
  const dias = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (dias < 1 / 24) return 'hace unos minutos';
  if (dias < 1) return `hace ${Math.round(dias * 24)} h`;
  if (dias < 2) return 'ayer';
  return `hace ${Math.round(dias)} días`;
};

/** Fecha de hoy en formato YYYY-MM-DD, para los <input type="date">. */
export const hoyISO = () => new Date().toISOString().slice(0, 10);

/**
 * "le quedan 27 días" — el plazo de una cotización enviada.
 * Recibe el `dias_para_vencer` que ya calculó el servidor, para que la cuenta
 * la haga un reloj y no el de cada computadora del piso de venta.
 */
export const vigencia = (dias) => {
  if (dias === null || dias === undefined) return null;
  const d = Number(dias);
  if (d < 0)  return { texto: 'vencida', urgente: true };
  if (d === 0) return { texto: 'vence hoy', urgente: true };
  if (d === 1) return { texto: 'vence mañana', urgente: true };
  return { texto: `le quedan ${d} días`, urgente: d <= 5 };
};

/**
 * Compara el precio congelado con el que Quiter dice hoy.
 * Devuelve null si no hay con qué comparar o si no se movió.
 */
export const cambioDePrecio = (partida) => {
  // Un precio que capturó el comprador NO se compara contra el de lista.
  //
  // Él lo negoció justamente para que fuera distinto del de Quiter: avisar de
  // esa diferencia sería gritarle al usuario por haber hecho bien su trabajo.
  // Y si el aviso amarillo sale en casi todos los renglones, en dos semanas
  // nadie lo mira — incluidos los que sí importan.
  if (partida?.precio_origen === 'COMPRADOR') return null;

  // Una partida que Quiter no conoce no tiene precio de lista contra el cual
  // comparar. Sin esto, `Number(null)` da 0 y la pantalla anuncia que "bajó
  // 100%", que es a la vez falso y alarmante.
  if (partida?.origen === 'LIBRE') return null;
  if (partida?.precio_lista_actual === null || partida?.precio_lista_actual === undefined) return null;

  const cotizado = Number(partida?.precio_cotizado);
  const actual   = Number(partida?.precio_lista_actual);
  if (!Number.isFinite(cotizado) || !Number.isFinite(actual) || cotizado === 0) return null;
  if (Math.abs(actual - cotizado) < 0.01) return null;

  const porcentaje = ((actual - cotizado) / cotizado) * 100;
  return {
    subio: actual > cotizado,
    actual,
    cotizado,
    porcentaje: Math.abs(porcentaje),
    texto: `${actual > cotizado ? 'subió' : 'bajó'} ${Math.abs(porcentaje).toFixed(1)}% `
         + `desde que se cotizó (${moneda(cotizado)} → ${moneda(actual)})`,
  };
};
