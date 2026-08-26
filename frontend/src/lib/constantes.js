/**
 * Catálogos y formateadores compartidos por toda la interfaz.
 * Mantener aquí los colores de badge evita que cada pantalla invente los suyos.
 */

export const ESTATUS = [
  'Pendiente', 'En Cotizacion', 'Autorizada', 'En Transito',
  'Recibido', 'Cancelada', 'Rechazada',
];

export const PRIORIDADES = ['Urgente', 'Normal', 'Baja'];

/**
 * Estilo de cada estatus. El texto siempre acompaña al color:
 * nunca se comunica el estado solo con el color (accesibilidad).
 */
export const ESTILO_ESTATUS = {
  'Pendiente':     { clases: 'bg-warning/15  text-ink   ring-warning/45',  punto: 'bg-warning'  },
  'En Cotizacion': { clases: 'bg-brand/10    text-ink   ring-brand/40',    punto: 'bg-brand'    },
  'Autorizada':    { clases: 'bg-brand/15    text-ink   ring-brand/55',    punto: 'bg-brand-strong' },
  'En Transito':   { clases: 'bg-serious/15  text-ink   ring-serious/50',  punto: 'bg-serious'  },
  'Recibido':      { clases: 'bg-good/12     text-ink   ring-good/45',     punto: 'bg-good'     },
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

/** Estados que ya cerraron la solicitud. */
export const ESTATUS_FINALES = ['Recibido', 'Cancelada', 'Rechazada'];

/** Transiciones válidas (espejo de backend/src/utils/estatus.js). */
export const TRANSICIONES = {
  'Pendiente':     ['En Cotizacion', 'Autorizada', 'Rechazada', 'Cancelada'],
  'En Cotizacion': ['Autorizada', 'En Transito', 'Rechazada', 'Cancelada'],
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
