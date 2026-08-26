/**
 * Modal de detalle: partidas, precios y bitácora completa del folio.
 *
 * Es la misma pantalla para los dos documentos, porque son el mismo documento:
 * una cotización aprobada se vuelve pedido sin cambiar de folio, y su bitácora
 * sigue siendo un solo hilo que se puede leer de arriba a abajo.
 *
 * Aquí viven las dos acciones que mueven una venta:
 *   · Enviar al cliente  -> congela el precio y arranca el plazo
 *   · Marcar como aprobada -> la vuelve pedido
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock, RefreshCw, Send } from 'lucide-react';
import { solicitudesApi } from '../api/client.js';
import {
  ESTILO_ESTATUS, ESTILO_PRIORIDAD, EXPLICACION_ESTATUS, NOMBRE_TIPO, TIPOS,
  cambioDePrecio, fecha, fechaHora, moneda, numero, vigencia,
} from '../lib/constantes.js';
import { Alerta, Badge, Boton, Cargando, Modal } from './ui/Primitivos.jsx';

export default function DetalleSolicitudModal({ id, abierto, onCerrar, onCambio }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState('');
  // Partidas cuyo precio cambió: el servidor las devuelve al negarse a enviar.
  const [cambiosPendientes, setCambiosPendientes] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await solicitudesApi.obtener(id));
      setError('');
    } catch (e) {
      setError(e.mensaje);
    }
  }, [id]);

  useEffect(() => {
    if (!abierto || !id) return;
    setDatos(null);
    setError('');
    setAviso('');
    setCambiosPendientes(null);
    cargar();
  }, [id, abierto, cargar]);

  const s = datos?.solicitud;
  const acciones = datos?.acciones ?? {};
  const esCotizacion = s?.tipo === TIPOS.COTIZACION;
  const plazo = s?.estatus_actual === 'Enviada' ? vigencia(s.dias_para_vencer) : null;

  /** Manda la cotización al cliente. `confirmar` la manda pese al cambio de precio. */
  const enviar = async (confirmar = false) => {
    setOcupado('enviar');
    setError('');
    try {
      const r = await solicitudesApi.enviar(id, { confirmar });
      setCambiosPendientes(null);
      setAviso(r.aviso);
      await cargar();
      onCambio?.();
    } catch (e) {
      // 409 con detalles NO es un fallo: es el sistema pidiendo que alguien
      // vea el precio nuevo antes de comprometerlo con el cliente.
      if (e.response?.status === 409 && Array.isArray(e.response?.data?.detalles)) {
        setCambiosPendientes(e.response.data.detalles);
      } else {
        setError(e.mensaje);
      }
    } finally {
      setOcupado('');
    }
  };

  const convertir = async () => {
    setOcupado('convertir');
    setError('');
    try {
      const r = await solicitudesApi.convertir(id);
      setAviso(r.aviso);
      await cargar();
      onCambio?.();
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setOcupado('');
    }
  };

  const refrescar = async () => {
    setOcupado('precios');
    setError('');
    try {
      const r = await solicitudesApi.refrescarPrecios(id);
      setAviso(r.aviso);
      await cargar();
      onCambio?.();
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setOcupado('');
    }
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={s ? `${NOMBRE_TIPO[s.tipo] ?? 'Documento'} ${s.folio}` : 'Documento'}
      subtitulo={s ? `${s.sucursal_nombre} · ${s.cliente_nombre || 'Sin cliente'}` : undefined}
      ancho="max-w-3xl"
    >
      {error && <Alerta tipo="error">{error}</Alerta>}
      {!datos && !error && <Cargando />}

      {s && (
        <div className="space-y-5">
          {/* Resumen */}
          <div className="flex flex-wrap items-center gap-2">
            <span title={EXPLICACION_ESTATUS[s.estatus_actual]}>
              <Badge texto={s.estatus_actual} estilo={ESTILO_ESTATUS[s.estatus_actual]} />
            </span>
            <Badge texto={s.prioridad} estilo={ESTILO_PRIORIDAD[s.prioridad]} />
            <span className="text-xs text-ink-2">
              Levantó <strong className="font-medium text-ink">{s.vendedor_nombre}</strong> el {fecha(s.fecha_creacion)}
            </span>
          </div>

          {aviso && <Alerta tipo="exito">{aviso}</Alerta>}

          {/* El plazo de una cotización enviada, dicho en días y no en fechas:
              "le quedan 27 días" se entiende sin hacer cuentas. */}
          {plazo && (
            <p className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ring-1 ring-inset
                          ${plazo.urgente
                            ? 'bg-critical/10 text-ink ring-critical/40'
                            : 'bg-brand/10 text-ink ring-brand/40'}`}>
              <Clock size={14} />
              Enviada al cliente el {fecha(s.enviada_en)} · {plazo.texto}.
              {' '}Si nadie la mueve, se cancela sola al cumplirse el plazo.
            </p>
          )}

          {/* El servidor se negó a enviarla porque Quiter movió el precio. */}
          {cambiosPendientes && (
            <div className="space-y-2 rounded-lg bg-warning/12 p-3 ring-1 ring-inset ring-warning/45">
              <p className="flex items-start gap-2 text-xs text-ink">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong className="font-medium">El precio cambió en Quiter</strong> desde que armaste
                  esta cotización. Revísalo antes de mandársela al cliente.
                </span>
              </p>
              <ul className="space-y-1 pl-6 text-xs text-ink-2">
                {cambiosPendientes.map((c) => (
                  <li key={c.id_partida} className="tabular">
                    <strong className="font-medium text-ink">{c.sku_producto}</strong>:{' '}
                    {moneda(c.precio_cotizado)} → {moneda(c.precio_actual)}
                    {c.porcentaje !== null && ` (${c.porcentaje > 0 ? '+' : ''}${c.porcentaje}%)`}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pl-6 pt-1">
                <Boton
                  variante="primario"
                  icono={Send}
                  cargando={ocupado === 'enviar'}
                  onClick={() => enviar(true)}
                >
                  Enviar con el precio nuevo
                </Boton>
                <Boton variante="fantasma" onClick={() => setCambiosPendientes(null)}>
                  No enviar todavía
                </Boton>
              </div>
            </div>
          )}

          {/* Acciones. Los botones se dibujan solo si el servidor dijo que
              esta persona puede hacerlo, con las mismas reglas que va a
              aplicar al ejecutarlo: así ninguno acaba en un error. */}
          {(acciones.puede_enviar || acciones.puede_convertir) && !cambiosPendientes && (
            <div className="flex flex-wrap gap-2 rounded-lg bg-surface-alt p-3">
              {acciones.puede_enviar && (
                <Boton
                  variante="primario"
                  icono={Send}
                  cargando={ocupado === 'enviar'}
                  onClick={() => enviar(false)}
                  title="Congela el precio y arranca el plazo de vigencia"
                >
                  Enviar al cliente
                </Boton>
              )}
              {acciones.puede_convertir && (
                <Boton
                  variante="primario"
                  icono={Check}
                  cargando={ocupado === 'convertir'}
                  onClick={convertir}
                  title="El folio no cambia: pasa a Pedido y entra a la mesa de Compras"
                >
                  El cliente aprobó
                </Boton>
              )}
              <Boton
                variante="fantasma"
                icono={RefreshCw}
                cargando={ocupado === 'precios'}
                onClick={refrescar}
                title="Vuelve a consultar el precio en Quiter"
              >
                Consultar precios
              </Boton>
            </div>
          )}

          <dl className="grid gap-3 rounded-lg bg-surface-alt p-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted">
                {esCotizacion ? 'Vigencia' : 'Promesa de entrega'}
              </dt>
              <dd className="mt-0.5 font-medium text-ink">
                {esCotizacion
                  ? (s.vence_en ? fecha(s.vence_en) : `${s.dias_vigencia} días al enviarla`)
                  : fecha(s.fecha_promesa_entrega)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Comprador asignado</dt>
              <dd className="mt-0.5 font-medium text-ink">{s.comprador_nombre || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted">
                {s.convertida_en ? 'Aprobada por el cliente' : 'Cierre'}
              </dt>
              <dd className="mt-0.5 font-medium text-ink">
                {fecha(s.convertida_en || s.fecha_cierre)}
              </dd>
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
            <div className="overflow-x-auto rounded-lg ring-1 ring-hairline">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-surface-alt text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Artículo</th>
                    <th className="w-20 px-3 py-2 text-right font-medium">Pedido</th>
                    <th className="w-20 px-3 py-2 text-right font-medium">Exist.</th>
                    <th className="w-24 px-3 py-2 text-right font-medium" title="El precio que se le prometió al cliente">
                      Cotizado
                    </th>
                    <th className="w-28 px-3 py-2 text-right font-medium">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {s.detalle.map((d) => {
                    const cambio = cambioDePrecio(d);
                    const unitario = Number(d.precio_cotizado ?? d.precio_estimado ?? 0);

                    return (
                      <tr key={d.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-ink tabular">{d.sku_producto}</p>
                          <p className="text-xs text-ink-2">{d.descripcion}</p>
                          {/* El aviso va pegado a la partida, no al pie: lo que
                              importa es cuál subió, no que algo subió. */}
                          {cambio && (
                            <p className={`mt-1 inline-flex items-center gap-1 text-[11px]
                                          ${cambio.subio ? 'text-critical' : 'text-ink-2'}`}>
                              <AlertTriangle size={11} />
                              {cambio.texto}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{numero(d.cantidad_solicitada)}</td>
                        <td className="px-3 py-2 text-right tabular">
                          {Number(d.existencia_real_almacen) <= 0
                            ? <span className="text-critical">0</span>
                            : numero(d.existencia_real_almacen)}
                        </td>
                        <td className="px-3 py-2 text-right tabular text-ink-2">{moneda(unitario)}</td>
                        <td className="px-3 py-2 text-right tabular text-ink-2">
                          {moneda(Number(d.cantidad_solicitada) * unitario)}
                        </td>
                      </tr>
                    );
                  })}
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
