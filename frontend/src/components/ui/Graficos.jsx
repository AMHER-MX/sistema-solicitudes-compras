/**
 * Piezas de visualización de datos (sin librerías de gráficas).
 *
 * Criterios aplicados:
 *  - Una sola familia de color (azul) para "magnitud": las barras no compiten
 *    entre sí por atención ni codifican identidad con el color.
 *  - Los valores van en tinta de texto, nunca en el color de la barra.
 *  - Cada barra lleva su etiqueta visible: nunca se depende solo del color.
 *  - Barras delgadas, extremo redondeado 4px y ancladas a la línea base.
 */
import { ArrowDown, ArrowUp } from 'lucide-react';

/* ─────────────────────────── Tarjeta de indicador ───────────────────────── */

/**
 * @param {string} etiqueta   nombre del indicador
 * @param {string} valor      cifra ya formateada
 * @param {string} [unidad]   sufijo pequeño (ej. "días")
 * @param {string} [nota]     aclaración breve debajo
 * @param {'neutro'|'bueno'|'alerta'|'critico'} [tono]
 * @param {{valor:string, direccion:'sube'|'baja', bueno:boolean}} [delta]
 */
export function Kpi({ etiqueta, valor, unidad, nota, tono = 'neutro', icono: Icono, delta }) {
  const tonos = {
    neutro:  'text-ink',
    bueno:   'text-good',
    alerta:  'text-warning',
    critico: 'text-critical',
  };

  return (
    <div className="rounded-xl bg-surface p-4 ring-1 ring-hairline">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{etiqueta}</p>
        {Icono && <Icono size={15} className="shrink-0 text-muted" />}
      </div>

      <p className={`mt-2 text-2xl font-semibold leading-none tracking-tight ${tonos[tono]}`}>
        {valor}
        {unidad && <span className="ml-1 text-xs font-normal text-ink-2">{unidad}</span>}
      </p>

      {delta && (
        <p className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium
                       ${delta.bueno ? 'text-good' : 'text-critical'}`}>
          {delta.direccion === 'sube' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          {delta.valor}
        </p>
      )}

      {nota && <p className="mt-1.5 text-[11px] text-ink-2">{nota}</p>}
    </div>
  );
}

/* ──────────────────────── Lista de barras horizontales ──────────────────── */

/**
 * Barras horizontales ordenadas de mayor a menor.
 * Es la forma correcta para comparar magnitudes entre categorías con
 * nombres largos (a diferencia de una gráfica de pastel).
 *
 * @param {Array<{etiqueta:string, sub?:string, valor:number, punto?:string, titulo?:string}>} datos
 * @param {(n:number)=>string} [formato] cómo se imprime el valor
 */
export function BarrasHorizontales({ datos, formato = (n) => n, vacio = 'Sin datos en el periodo' }) {
  if (!datos?.length) {
    return <p className="py-8 text-center text-xs text-muted">{vacio}</p>;
  }

  const max = Math.max(...datos.map((d) => Number(d.valor) || 0), 1);

  return (
    <ul className="space-y-3">
      {datos.map((d) => {
        const ancho = Math.max((Number(d.valor) / max) * 100, 1.5);
        return (
          <li key={d.etiqueta} title={d.titulo ?? `${d.etiqueta}: ${formato(d.valor)}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink">
                {/* Punto de color opcional: acompaña al texto, no lo sustituye. */}
                {d.punto && <span className={`size-1.5 shrink-0 rounded-full ${d.punto}`} aria-hidden />}
                <span className="truncate font-medium">{d.etiqueta}</span>
                {d.sub && <span className="truncate text-muted">· {d.sub}</span>}
              </p>
              <p className="shrink-0 text-xs font-semibold text-ink tabular">{formato(d.valor)}</p>
            </div>

            {/* Riel + barra. La barra nace en la línea base (izquierda). */}
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-2 rounded-r-[4px] bg-brand"
                style={{ width: `${ancho}%` }}
                role="presentation"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
