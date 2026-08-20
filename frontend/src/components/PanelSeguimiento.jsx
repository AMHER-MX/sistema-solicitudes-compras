/**
 * Panel de seguimiento de compras: cambia el estatus, fija la fecha de
 * compromiso y guarda un comentario que el vendedor podrá leer.
 *
 * Solo ofrece las transiciones válidas para el estatus actual, así que la UI
 * no puede pedirle al backend algo que va a rechazar.
 */
import { useEffect, useState } from 'react';
import { CalendarCheck, Save } from 'lucide-react';
import { solicitudesApi } from '../api/client.js';
import {
  ESTILO_ESTATUS, ESTILO_PRIORIDAD, TRANSICIONES, fecha, hoyISO, moneda,
} from '../lib/constantes.js';
import {
  Alerta, Badge, Boton, Campo, Input, Modal, Select, TextArea,
} from './ui/Primitivos.jsx';

export default function PanelSeguimiento({ solicitud, abierto, onCerrar, onGuardado }) {
  const opciones = TRANSICIONES[solicitud?.estatus_actual] ?? [];

  const [estatus, setEstatus] = useState('');
  const [promesa, setPromesa] = useState('');
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Al abrir el panel, precargamos con la primera transición sugerida.
  useEffect(() => {
    if (!abierto || !solicitud) return;
    setEstatus(opciones[0] ?? '');
    setPromesa(solicitud.fecha_promesa_entrega?.slice(0, 10) ?? '');
    setComentario('');
    setError('');
  }, [abierto, solicitud?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // "En Transito" exige fecha de compromiso (la promesa que se le da al cliente).
  const requierePromesa = estatus === 'En Transito';

  const guardar = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const { solicitud: actualizada } = await solicitudesApi.cambiarEstatus(solicitud.id, {
        estatus,
        comentario: comentario.trim() || null,
        fecha_promesa_entrega: promesa || null,
      });
      onGuardado?.(actualizada);
      onCerrar();
    } catch (err) {
      setError(err.mensaje || 'No se pudo actualizar el estatus');
    } finally {
      setGuardando(false);
    }
  };

  if (!solicitud) return null;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Seguimiento · ${solicitud.folio}`}
      subtitulo={`${solicitud.vendedor_nombre} · ${solicitud.sucursal_nombre}`}
      ancho="max-w-lg"
    >
      <div className="space-y-4">
        {/* Contexto */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge texto={solicitud.estatus_actual} estilo={ESTILO_ESTATUS[solicitud.estatus_actual]} />
          <Badge texto={solicitud.prioridad} estilo={ESTILO_PRIORIDAD[solicitud.prioridad]} />
          <span className="text-xs text-ink-2 tabular">
            {solicitud.total_partidas} partida(s) · {moneda(solicitud.monto_estimado)}
          </span>
        </div>

        {solicitud.observaciones && (
          <p className="rounded-lg bg-surface-alt p-3 text-xs text-ink-2">
            <span className="font-medium text-ink">Nota del vendedor: </span>
            {solicitud.observaciones}
          </p>
        )}

        {opciones.length === 0 ? (
          <Alerta tipo="info">
            Esta solicitud ya está cerrada ({solicitud.estatus_actual}); no admite más movimientos.
          </Alerta>
        ) : (
          <form onSubmit={guardar} className="space-y-4">
            <Campo etiqueta="Nuevo estatus" requerido>
              <Select value={estatus} onChange={(e) => setEstatus(e.target.value)} required>
                {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Campo>

            <Campo
              etiqueta="Fecha de compromiso"
              requerido={requierePromesa}
              hint={
                requierePromesa
                  ? 'Obligatoria al marcar En Transito: es la fecha que se le promete al cliente.'
                  : solicitud.fecha_promesa_entrega
                    ? `Actual: ${fecha(solicitud.fecha_promesa_entrega)}`
                    : 'Opcional en este paso.'
              }
            >
              <Input
                type="date"
                min={hoyISO()}
                value={promesa}
                onChange={(e) => setPromesa(e.target.value)}
                required={requierePromesa}
              />
            </Campo>

            <Campo etiqueta="Comentario de seguimiento" hint="Lo verá el vendedor en su bitácora.">
              <TextArea
                rows={3}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Ej. OC-4410 colocada con proveedor nacional; embarque el viernes."
              />
            </Campo>

            {error && <Alerta tipo="error">{error}</Alerta>}

            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <CalendarCheck size={13} />
                El movimiento queda registrado a tu nombre.
              </p>
              <div className="flex gap-2">
                <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
                  Cancelar
                </Boton>
                <Boton type="submit" icono={Save} cargando={guardando}>
                  Guardar
                </Boton>
              </div>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
