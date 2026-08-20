/**
 * Modal de detalle: partidas + bitácora completa de la solicitud.
 * Lo usan tanto el vendedor (solo lectura) como compras.
 */
import { useEffect, useState } from 'react';
import { solicitudesApi } from '../api/client.js';
import {
  ESTILO_ESTATUS, ESTILO_PRIORIDAD, fecha, fechaHora, moneda, numero,
} from '../lib/constantes.js';
import { Alerta, Badge, Cargando, Modal } from './ui/Primitivos.jsx';

export default function DetalleSolicitudModal({ id, abierto, onCerrar }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierto || !id) return;
    setDatos(null);
    setError('');
    solicitudesApi.obtener(id)
      .then(setDatos)
      .catch((e) => setError(e.mensaje));
  }, [id, abierto]);

  const s = datos?.solicitud;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={s ? `Solicitud ${s.folio}` : 'Solicitud'}
      subtitulo={s ? `${s.sucursal_nombre} · ${s.cliente_nombre || 'Sin cliente'}` : undefined}
      ancho="max-w-3xl"
    >
      {error && <Alerta tipo="error">{error}</Alerta>}
      {!datos && !error && <Cargando />}

      {s && (
        <div className="space-y-5">
          {/* Resumen */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge texto={s.estatus_actual} estilo={ESTILO_ESTATUS[s.estatus_actual]} />
            <Badge texto={s.prioridad} estilo={ESTILO_PRIORIDAD[s.prioridad]} />
            <span className="text-xs text-ink-2">
              Solicitó <strong className="font-medium text-ink">{s.vendedor_nombre}</strong> el {fecha(s.fecha_creacion)}
            </span>
          </div>

          <dl className="grid gap-3 rounded-lg bg-surface-alt p-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted">Promesa de entrega</dt>
              <dd className="mt-0.5 font-medium text-ink">{fecha(s.fecha_promesa_entrega)}</dd>
            </div>
            <div>
              <dt className="text-muted">Comprador asignado</dt>
              <dd className="mt-0.5 font-medium text-ink">{s.comprador_nombre || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted">Cierre</dt>
              <dd className="mt-0.5 font-medium text-ink">{fecha(s.fecha_cierre)}</dd>
            </div>
          </dl>

          {s.observaciones && (
            <p className="rounded-lg bg-surface-alt p-3 text-xs text-ink-2">
              <span className="font-medium text-ink">Nota del vendedor: </span>
              {s.observaciones}
            </p>
          )}

          {/* Partidas */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Partidas ({s.detalle.length})
            </h4>
            <div className="overflow-hidden rounded-lg ring-1 ring-hairline">
              <table className="w-full text-sm">
                <thead className="bg-surface-alt text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Artículo</th>
                    <th className="w-20 px-3 py-2 text-right font-medium">Pedido</th>
                    <th className="w-20 px-3 py-2 text-right font-medium">Exist.</th>
                    <th className="w-28 px-3 py-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {s.detalle.map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-ink tabular">{d.sku_producto}</p>
                        <p className="text-xs text-ink-2">{d.descripcion}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular">{numero(d.cantidad_solicitada)}</td>
                      <td className="px-3 py-2 text-right tabular">
                        {Number(d.existencia_real_almacen) <= 0
                          ? <span className="text-critical">0</span>
                          : numero(d.existencia_real_almacen)}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-ink-2">
                        {moneda(Number(d.cantidad_solicitada) * Number(d.precio_estimado || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Bitácora */}
          <section>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Seguimiento
            </h4>
            <ol className="space-y-3">
              {s.historial.map((h, i) => (
                <li key={h.id} className="flex gap-3">
                  {/* Línea de tiempo */}
                  <div className="flex flex-col items-center pt-1">
                    <span className={`size-2 rounded-full ${ESTILO_ESTATUS[h.estatus_nuevo]?.punto ?? 'bg-muted'}`} />
                    {i < s.historial.length - 1 && <span className="mt-1 w-px flex-1 bg-hairline" />}
                  </div>
                  <div className="pb-1">
                    <p className="text-xs text-ink">
                      <strong className="font-medium">{h.estatus_nuevo}</strong>
                      {h.estatus_anterior && (
                        <span className="text-muted"> (desde {h.estatus_anterior})</span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted">
                      {h.usuario_nombre} · {h.usuario_rol} · {fechaHora(h.fecha_movimiento)}
                    </p>
                    {h.comentario && <p className="mt-1 text-xs text-ink-2">{h.comentario}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  );
}
