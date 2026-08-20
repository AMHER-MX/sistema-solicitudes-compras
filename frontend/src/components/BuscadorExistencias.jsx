/**
 * Buscador de productos con consulta de existencias en tiempo real al ERP.
 *
 * - Escribe -> espera 350 ms (debounce) -> GET /api/productos/existencias
 * - Si el artículo tiene 0 piezas, ofrece el botón "Solicitar a compras".
 * - Si otra sucursal sí tiene, lo indica (a veces conviene traspaso, no compra).
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, PackageSearch, Plus, Search, Loader2 } from 'lucide-react';
import { productosApi } from '../api/client.js';
import { moneda, numero } from '../lib/constantes.js';
import { Alerta, EstadoVacio, Input, Tarjeta, TarjetaEncabezado } from './ui/Primitivos.jsx';

export default function BuscadorExistencias({ onSolicitar }) {
  const [termino, setTermino] = useState('');
  const [resultado, setResultado] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const temporizador = useRef(null);

  useEffect(() => {
    clearTimeout(temporizador.current);

    if (termino.trim().length < 2) {
      setResultado(null);
      setError('');
      return;
    }

    setBuscando(true);
    temporizador.current = setTimeout(async () => {
      try {
        const data = await productosApi.existencias(termino.trim());
        setResultado(data);
        setError('');
      } catch (e) {
        setError(e.mensaje);
        setResultado(null);
      } finally {
        setBuscando(false);
      }
    }, 350);

    return () => clearTimeout(temporizador.current);
  }, [termino]);

  return (
    <Tarjeta>
      <TarjetaEncabezado
        icono={PackageSearch}
        titulo="Consulta de existencias"
        descripcion="Busca por número de parte o descripción. La existencia viene del ERP."
      />

      <div className="p-5">
        {/* Campo de búsqueda */}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            placeholder="Ej. FLT-4520, balata, aceite..."
            className="pl-9"
            aria-label="Buscar producto"
          />
          {buscando && (
            <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted" />
          )}
        </div>

        {/* Aviso del origen de los datos (ERP real vs respaldo local) */}
        {resultado?.aviso && (
          <div className="mt-3">
            <Alerta tipo="aviso">{resultado.aviso}</Alerta>
          </div>
        )}
        {error && <div className="mt-3"><Alerta tipo="error">{error}</Alerta></div>}

        {/* Resultados */}
        {resultado && resultado.articulos.length === 0 && (
          <EstadoVacio
            icono={PackageSearch}
            titulo="Sin coincidencias"
            descripcion={`No se encontró "${resultado.termino}" en el catálogo. Verifica el número de parte.`}
          />
        )}

        {resultado?.articulos?.length > 0 && (
          <ul className="mt-4 divide-y divide-hairline">
            {resultado.articulos.map((a) => {
              const sinStock = Number(a.existencia) <= 0;
              return (
                <li key={a.sku} className="flex flex-wrap items-center gap-3 py-3">
                  {/* Identificación */}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      <span className="tabular">{a.sku}</span>
                      {a.linea && (
                        <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-normal text-ink-2">
                          {a.linea}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-2">{a.descripcion}</p>
                    {a.existencia_otras_sucursales?.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted">
                        Disponible en:{' '}
                        {a.existencia_otras_sucursales
                          .map((o) => `${o.almacen} (${numero(o.existencia)})`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Precio */}
                  <div className="w-24 text-right text-xs text-ink-2 tabular">
                    {a.precio_lista ? moneda(a.precio_lista) : '—'}
                  </div>

                  {/* Existencia */}
                  <div className="w-28 text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs
                                  font-medium ring-1 ring-inset tabular
                                  ${sinStock
                                    ? 'bg-critical/12 text-ink ring-critical/45'
                                    : 'bg-good/12 text-ink ring-good/45'}`}
                    >
                      {sinStock ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                      {sinStock ? 'Sin stock' : `${numero(a.existencia)} pzas`}
                    </span>
                  </div>

                  {/* Acción */}
                  <button
                    onClick={() => onSolicitar(a)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium
                                transition-colors
                                ${sinStock
                                  ? 'bg-brand text-white hover:bg-brand-strong'
                                  : 'text-ink-2 ring-1 ring-hairline hover:bg-surface-alt'}`}
                  >
                    <Plus size={13} />
                    {sinStock ? 'Solicitar' : 'Agregar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!resultado && !error && (
          <p className="mt-4 text-center text-xs text-muted">
            Escribe al menos 2 caracteres para consultar el inventario.
          </p>
        )}
      </div>
    </Tarjeta>
  );
}
