/**
 * Formulario de alta de solicitud.
 * Aparece cuando el vendedor agrega al menos un artículo desde el buscador
 * (típicamente porque salió con existencia 0).
 */
import { useState } from 'react';
import { Send, Trash2, TriangleAlert } from 'lucide-react';
import { solicitudesApi } from '../api/client.js';
import { PRIORIDADES, moneda, numero } from '../lib/constantes.js';
import SelectorCliente from './SelectorCliente.jsx';
import {
  Alerta, Boton, Campo, Input, Select, Tarjeta, TarjetaEncabezado, TextArea,
} from './ui/Primitivos.jsx';

export default function FormularioSolicitud({ items, setItems, onCreada }) {
  const [idCliente, setIdCliente] = useState(null);
  const [prioridad, setPrioridad] = useState('Normal');
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const cambiarCantidad = (sku, cantidad) =>
    setItems((prev) => prev.map((it) => (it.sku === sku ? { ...it, cantidad } : it)));

  const quitar = (sku) => setItems((prev) => prev.filter((it) => it.sku !== sku));

  const total = items.reduce(
    (acc, it) => acc + (Number(it.cantidad) || 0) * (Number(it.precio_lista) || 0), 0,
  );

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const { solicitud, aviso } = await solicitudesApi.crear({
        id_cliente: idCliente ?? null,
        prioridad,
        observaciones: observaciones.trim() || null,
        items: items.map((it) => ({
          sku_producto: it.sku,
          descripcion: it.descripcion,
          cantidad_solicitada: Number(it.cantidad),
          precio_estimado: it.precio_lista ?? null,
          existencia_real_almacen: it.existencia,
          // El servidor no vuelve a preguntarle a Quiter por una partida LIBRE
          // ni le inventa existencia: la marca es lo que se lo dice.
          origen: it.origen ?? 'QUITER',
        })),
      });
      // Limpiamos el formulario y avisamos al padre para refrescar el listado.
      setItems([]);
      setObservaciones('');
      setPrioridad('Normal');
      setIdCliente(null);
      // El aviso lo redacta el servidor: dice si ya se puede mandar al
      // cliente o si pasó a Compras por faltantes.
      onCreada?.(solicitud, aviso);
    } catch (err) {
      setError(err.mensaje || 'No se pudo crear la cotización');
    } finally {
      setEnviando(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <Tarjeta>
      <TarjetaEncabezado
        icono={TriangleAlert}
        titulo="Nueva cotización"
        descripcion={`${items.length} artículo(s). Si algo no hay en existencia, `
          + 'pasa a Compras antes de poderse mandar al cliente.'}
      />

      <form onSubmit={enviar} className="space-y-4 p-5">
        {/* Partidas */}
        <div className="overflow-hidden rounded-lg ring-1 ring-hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Artículo</th>
                <th className="w-24 px-3 py-2 text-right font-medium">Exist.</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Cantidad</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Importe</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((it) => (
                <tr key={it.sku}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink tabular">{it.sku}</p>
                    <p className="text-xs text-ink-2">{it.descripcion}</p>
                    {it.origen === 'LIBRE' && (
                      <p className="mt-0.5 text-[11px] text-warning">
                        Fuera de catálogo · Compras consigue precio y tiempo
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular">
                    {Number(it.existencia) <= 0
                      ? <span className="text-critical">0</span>
                      : numero(it.existencia)}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={it.cantidad}
                      onChange={(e) => cambiarCantidad(it.sku, e.target.value)}
                      className="py-1 text-right tabular"
                      required
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular text-ink-2">
                    {moneda((Number(it.cantidad) || 0) * (Number(it.precio_lista) || 0))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => quitar(it.sku)}
                      aria-label={`Quitar ${it.sku}`}
                      className="rounded p-1 text-muted hover:bg-surface-alt hover:text-critical"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-alt">
              <tr>
                <td colSpan="3" className="px-3 py-2 text-right text-xs font-medium text-ink-2">
                  Total estimado
                </td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-ink tabular">
                  {moneda(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Datos de la solicitud */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Prioridad" requerido hint="Urgente = el cliente detiene su operación.">
            <Select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
              {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Campo>

          <Campo etiqueta="Cliente" hint="Del padrón de Quiter. Escribe para buscarlo.">
            <SelectorCliente valor={idCliente} onCambiar={setIdCliente} />
          </Campo>
        </div>

        <Campo etiqueta="Comentario para compras">
          <TextArea
            rows={2}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Ej. Unidad varada en taller; el cliente autoriza sobreprecio."
          />
        </Campo>

        {error && <Alerta tipo="error">{error}</Alerta>}

        <div className="flex items-center justify-end gap-2">
          <Boton variante="secundario" onClick={() => setItems([])} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton type="submit" icono={Send} cargando={enviando}>
            Crear cotización
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
