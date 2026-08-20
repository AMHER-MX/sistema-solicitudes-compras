/**
 * Piezas de interfaz reutilizables (botones, tarjetas, badges, modal...).
 * Todo el sistema visual del proyecto vive en este archivo para que cambiar
 * el look & feel no implique tocar diez pantallas.
 */
import { AlertCircle, Loader2, X } from 'lucide-react';
import { useEffect } from 'react';

/* ───────────────────────────── Tarjeta / panel ───────────────────────────── */

export function Tarjeta({ children, className = '', ...props }) {
  return (
    <div
      className={`rounded-xl bg-surface ring-1 ring-hairline shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function TarjetaEncabezado({ titulo, descripcion, icono: Icono, acciones }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
      <div className="flex items-start gap-3">
        {Icono && (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Icono size={18} strokeWidth={2} />
          </span>
        )}
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-ink">{titulo}</h2>
          {descripcion && <p className="mt-0.5 text-xs text-ink-2">{descripcion}</p>}
        </div>
      </div>
      {acciones}
    </div>
  );
}

/* ──────────────────────────────── Botones ───────────────────────────────── */

const VARIANTES_BOTON = {
  primario:   'bg-brand text-white hover:bg-brand-strong',
  secundario: 'bg-surface text-ink ring-1 ring-hairline hover:bg-surface-alt',
  fantasma:   'text-ink-2 hover:bg-surface-alt hover:text-ink',
  peligro:    'bg-critical text-white hover:brightness-95',
};

export function Boton({
  children, variante = 'primario', icono: Icono, cargando = false,
  className = '', type = 'button', ...props
}) {
  return (
    <button
      type={type}
      disabled={cargando || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm
                  font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50
                  ${VARIANTES_BOTON[variante]} ${className}`}
      {...props}
    >
      {cargando ? <Loader2 size={16} className="animate-spin" /> : Icono && <Icono size={16} />}
      {children}
    </button>
  );
}

/* ──────────────────────────── Campos de captura ─────────────────────────── */

export function Campo({ etiqueta, hint, requerido, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1 text-xs font-medium text-ink-2">
        {etiqueta}
        {requerido && <span className="text-critical">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

const claseControl =
  `w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink
   placeholder:text-muted focus:border-brand focus:outline-none`;

export const Input = ({ className = '', ...props }) => (
  <input className={`${claseControl} ${className}`} {...props} />
);

export const Select = ({ className = '', children, ...props }) => (
  <select className={`${claseControl} ${className}`} {...props}>{children}</select>
);

export const TextArea = ({ className = '', ...props }) => (
  <textarea className={`${claseControl} resize-y ${className}`} {...props} />
);

/* ───────────────────────────────── Badges ───────────────────────────────── */

/**
 * Badge con punto de color + texto.
 * El texto siempre está presente: el color nunca es el único portador
 * del significado (requisito de accesibilidad).
 */
export function Badge({ texto, estilo, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs
                  font-medium ring-1 ring-inset whitespace-nowrap
                  ${estilo?.clases ?? 'bg-surface-alt text-ink-2 ring-hairline'} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${estilo?.punto ?? 'bg-muted'}`} aria-hidden />
      {texto}
    </span>
  );
}

/* ───────────────────────────────── Modal ────────────────────────────────── */

export function Modal({ abierto, onCerrar, titulo, subtitulo, children, ancho = 'max-w-2xl' }) {
  // Cerrar con la tecla Escape.
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e) => e.key === 'Escape' && onCerrar?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`w-full ${ancho} rounded-xl bg-surface shadow-xl ring-1 ring-hairline`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-ink">{titulo}</h3>
            {subtitulo && <p className="mt-0.5 text-xs text-ink-2">{subtitulo}</p>}
          </div>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-m-1 rounded-lg p-1 text-muted hover:bg-surface-alt hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── Estados: carga / vacío / error ───────────────── */

export const Cargando = ({ texto = 'Cargando...' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-2">
    <Loader2 size={16} className="animate-spin" /> {texto}
  </div>
);

export const EstadoVacio = ({ icono: Icono, titulo, descripcion, children }) => (
  <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
    {Icono && (
      <span className="mb-3 grid size-11 place-items-center rounded-full bg-surface-alt text-muted">
        <Icono size={20} />
      </span>
    )}
    <p className="text-sm font-medium text-ink">{titulo}</p>
    {descripcion && <p className="mt-1 max-w-sm text-xs text-ink-2">{descripcion}</p>}
    {children && <div className="mt-4">{children}</div>}
  </div>
);

export const Alerta = ({ tipo = 'error', children }) => {
  const estilos = {
    error:  'bg-critical/10 text-ink ring-critical/40',
    aviso:  'bg-warning/15  text-ink ring-warning/45',
    exito:  'bg-good/12     text-ink ring-good/45',
    info:   'bg-brand/10    text-ink ring-brand/40',
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${estilos[tipo]}`}>
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
};
