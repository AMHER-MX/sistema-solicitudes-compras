/**
 * Las dos pestañas del sistema: Cotizaciones y Pedidos.
 *
 * Son dos momentos del MISMO documento, no dos archivos distintos, así que la
 * pestaña no cambia de qué estás viendo sino de en qué punto está: lo que el
 * cliente todavía no aprueba, y lo que ya se está surtiendo.
 *
 * El contador va en la pestaña porque la pregunta de todos los días —"¿cuántas
 * cotizaciones traigo colgando?"— se debería poder contestar sin hacer clic.
 */
import { FileText, PackageCheck } from 'lucide-react';
import { TIPOS } from '../lib/constantes.js';

const PESTANAS = [
  {
    tipo: TIPOS.COTIZACION,
    etiqueta: 'Cotizaciones',
    icono: FileText,
    ayuda: 'Lo que el cliente todavía no aprueba',
  },
  {
    tipo: TIPOS.PEDIDO,
    etiqueta: 'Pedidos',
    icono: PackageCheck,
    ayuda: 'Lo aprobado, ya en manos de Compras',
  },
];

export default function PestanasTipo({ valor, onCambiar, conteos = {} }) {
  return (
    <div
      role="tablist"
      aria-label="Tipo de documento"
      className="flex gap-1 rounded-xl bg-surface-alt p-1 ring-1 ring-hairline"
    >
      {PESTANAS.map(({ tipo, etiqueta, icono: Icono, ayuda }) => {
        const activa = valor === tipo;
        const cuantas = conteos[tipo];

        return (
          <button
            key={tipo}
            role="tab"
            aria-selected={activa}
            title={ayuda}
            onClick={() => onCambiar(tipo)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2
                        text-sm transition-colors
                        ${activa
                          ? 'bg-surface font-semibold text-ink shadow-sm ring-1 ring-hairline'
                          : 'text-ink-2 hover:text-ink'}`}
          >
            <Icono size={15} />
            {etiqueta}
            {cuantas !== undefined && (
              <span
                className={`tabular rounded-full px-1.5 py-0.5 text-[11px]
                            ${activa ? 'bg-brand/12 text-ink' : 'bg-surface text-muted'}`}
              >
                {cuantas}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
