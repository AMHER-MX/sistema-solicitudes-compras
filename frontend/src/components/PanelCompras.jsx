/**
 * La mesa de trabajo del comprador, dentro del folio.
 *
 * Aquí el comprador hace las tres cosas por las que abre un folio: capturar el
 * precio al que consiguió cada pieza, prometer un rango de entrega, y decir en
 * qué va su trabajo.
 *
 * TRES DECISIONES DE DISEÑO
 *
 *  · Se edita en una tabla, no en un formulario por partida. Un comprador
 *    trabaja cinco renglones de un jalón mientras tiene al proveedor en el
 *    teléfono; abrir y cerrar cinco ventanitas es exactamente lo que hace que
 *    la gente prefiera su libreta.
 *
 *  · El precio de Quiter se sigue viendo al lado del que captura, en gris. No
 *    se esconde: es la referencia contra la que está negociando, y verla le
 *    dice si le fue bien.
 *
 *  · Nada se guarda solo. El comprador captura, revisa el total y guarda. Un
 *    guardado automático a media captura dispararía la recotización —con su
 *    subida de versión y su aviso al vendedor— en cuanto tocara la primera
 *    tecla.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw, Save } from 'lucide-react';
import { solicitudesApi } from '../api/client.js';
import {
  ESTATUS_COMPRAS, ESTILO_ESTATUS_COMPRAS, EXPLICACION_ESTATUS_COMPRAS,
  NOMBRE_ESTATUS_COMPRAS, moneda, numero,
} from '../lib/constantes.js';
import { Alerta, Badge, Boton, Campo, Input } from './ui/Primitivos.jsx';

/** Una partida lista para editarse, con todo como texto para no pelear con el input. */
const aBorrador = (d) => ({
  id: d.id,
  sku_producto: d.sku_producto,
  descripcion: d.descripcion,
  origen: d.origen,
  cantidad_solicitada: String(d.cantidad_solicitada ?? ''),
  existencia_real_almacen: Number(d.existencia_real_almacen ?? 0),
  precio_estimado: d.precio_estimado,
  precio_lista_actual: d.precio_lista_actual,
  precio_cotizado: d.precio_cotizado === null ? '' : String(d.precio_cotizado),
  precio_origen: d.precio_origen,
  nota_compras: d.nota_compras ?? '',
});

export default function PanelCompras({ solicitud, onGuardado }) {
  const [lineas, setLineas] = useState([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [moviendo, setMoviendo] = useState('');

  // Al abrir otro folio se recarga todo: si no, quedarían en pantalla los
  // precios a medio capturar del folio anterior, listos para guardarse aquí.
  useEffect(() => {
    setLineas((solicitud.detalle ?? []).map(aBorrador));
    setDesde(solicitud.fecha_promesa_entrega ?? '');
    setHasta(solicitud.fecha_promesa_hasta ?? '');
    setError('');
    setAviso('');
  }, [solicitud.id, solicitud.actualizado_en]);

  const cambiar = (id, campo, valor) =>
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)));

  const total = lineas.reduce(
    (t, l) => t + (Number(l.cantidad_solicitada) || 0) * (Number(l.precio_cotizado) || 0),
    0,
  );
  const sinPrecio = lineas.filter((l) => l.precio_cotizado === '').length;

  const guardar = async () => {
    setGuardando(true);
    setError('');
    setAviso('');
    try {
      const r = await solicitudesApi.editar(solicitud.id, {
        fecha_promesa_entrega: desde || undefined,
        fecha_promesa_hasta: hasta || undefined,
        items: lineas.map((l) => ({
          sku_producto: l.sku_producto,
          descripcion: l.descripcion,
          cantidad_solicitada: Number(l.cantidad_solicitada),
          existencia_real_almacen: l.existencia_real_almacen,
          origen: l.origen,
          precio_estimado: l.precio_estimado,
          precio_lista_actual: l.precio_lista_actual,
          precio_cotizado: l.precio_cotizado === '' ? null : Number(l.precio_cotizado),
          // Solo se marca como precio del comprador el que él realmente cambió.
          // Marcarlos todos haría que el sistema dejara de avisar cuando Quiter
          // mueve un precio que nadie negoció.
          precio_origen: (l.precio_cotizado !== ''
            && Number(l.precio_cotizado) !== Number(l.precio_estimado))
            || l.precio_origen === 'COMPRADOR'
            ? 'COMPRADOR' : 'QUITER',
          nota_compras: l.nota_compras || null,
        })),
      });
      setAviso(r.aviso ?? 'Guardado.');
      onGuardado?.();
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setGuardando(false);
    }
  };

  const marcar = async (estatus) => {
    setMoviendo(estatus);
    setError('');
    try {
      await solicitudesApi.estatusCompras(solicitud.id, estatus);
      onGuardado?.();
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setMoviendo('');
    }
  };

  return (
    <section className="space-y-3 rounded-lg bg-surface-alt p-3 ring-1 ring-inset ring-hairline">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Trabajo de Compras
        </h4>
        {solicitud.estatus_compras && (
          <span title={EXPLICACION_ESTATUS_COMPRAS[solicitud.estatus_compras]}>
            <Badge
              texto={NOMBRE_ESTATUS_COMPRAS[solicitud.estatus_compras] ?? solicitud.estatus_compras}
              estilo={ESTILO_ESTATUS_COMPRAS[solicitud.estatus_compras]}
            />
          </span>
        )}
      </header>

      {error && <Alerta tipo="error">{error}</Alerta>}
      {aviso && <Alerta tipo="exito">{aviso}</Alerta>}

      {/* Estatus del trabajo */}
      <div className="flex flex-wrap gap-1.5">
        {ESTATUS_COMPRAS.map((e) => (
          <Boton
            key={e}
            variante={solicitud.estatus_compras === e ? 'primario' : 'fantasma'}
            cargando={moviendo === e}
            onClick={() => marcar(e)}
            title={EXPLICACION_ESTATUS_COMPRAS[e]}
          >
            {NOMBRE_ESTATUS_COMPRAS[e]}
          </Boton>
        ))}
      </div>

      {/* Precios */}
      <div className="overflow-x-auto rounded-lg bg-surface ring-1 ring-hairline">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-surface-alt text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Artículo</th>
              <th className="w-16 px-2 py-2 text-right font-medium">Cant.</th>
              <th className="w-24 px-2 py-2 text-right font-medium" title="Lo que dice Quiter hoy">
                Quiter
              </th>
              <th className="w-28 px-2 py-2 text-right font-medium" title="Lo que tú conseguiste">
                Tu precio
              </th>
              <th className="w-28 px-2 py-2 text-right font-medium">Importe</th>
              <th className="w-48 px-2 py-2 text-left font-medium">Con quién / nota</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {lineas.map((l) => {
              const importe = (Number(l.cantidad_solicitada) || 0) * (Number(l.precio_cotizado) || 0);
              const referencia = l.precio_lista_actual ?? l.precio_estimado;

              return (
                <tr key={l.id} className={l.precio_cotizado === '' ? 'bg-warning/8' : ''}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink tabular">{l.sku_producto}</p>
                    <p className="text-xs text-ink-2">{l.descripcion}</p>
                    {/* Se dice cuáles no salieron del inventario: son las que
                        hay que averiguar de cero, no solo cotizar. */}
                    {l.origen === 'LIBRE' && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-warning">
                        <AlertTriangle size={11} />
                        No está en Quiter. La pidió el cliente así.
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular text-ink-2">
                    {numero(l.cantidad_solicitada)}
                  </td>
                  <td className="px-2 py-2 text-right tabular text-muted">
                    {referencia === null || referencia === undefined ? '—' : moneda(referencia)}
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.precio_cotizado}
                      onChange={(e) => cambiar(l.id, 'precio_cotizado', e.target.value)}
                      placeholder="—"
                      aria-label={`Precio conseguido de ${l.sku_producto}`}
                      className="text-right tabular"
                    />
                  </td>
                  <td className="px-2 py-2 text-right tabular text-ink">
                    {l.precio_cotizado === '' ? '—' : moneda(importe)}
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      value={l.nota_compras}
                      onChange={(e) => cambiar(l.id, 'nota_compras', e.target.value)}
                      placeholder="Proveedor, condición..."
                      aria-label={`Nota de ${l.sku_producto}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-hairline bg-surface-alt">
            <tr>
              <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted">
                {sinPrecio > 0
                  ? `Total de lo que ya tiene precio (faltan ${sinPrecio})`
                  : 'Total'}
              </td>
              <td className="px-2 py-2 text-right font-semibold tabular text-ink">
                {moneda(total)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Rango de entrega */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Entrega desde" hint="El día más pronto que la promete el proveedor.">
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo etiqueta="Entrega hasta" hint="Déjalo vacío si el proveedor dio un día exacto.">
          <Input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
          />
        </Campo>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Se avisa antes de guardar, no después: una vez que sube la versión,
            el vendedor ya recibió el aviso de que hay que re-enviarla. */}
        <p className="text-[11px] text-muted">
          {solicitud.estatus_actual === 'Enviada'
            ? 'El cliente ya tiene esta cotización: al guardar se vuelve una versión nueva y hay que volver a enviársela.'
            : 'Se guarda todo junto: precios, notas y fechas.'}
        </p>
        <div className="flex gap-2">
          <Boton
            variante="fantasma"
            icono={RotateCcw}
            onClick={() => setLineas((solicitud.detalle ?? []).map(aBorrador))}
            disabled={guardando}
          >
            Deshacer
          </Boton>
          <Boton variante="primario" icono={Save} cargando={guardando} onClick={guardar}>
            Guardar
          </Boton>
        </div>
      </div>
    </section>
  );
}
