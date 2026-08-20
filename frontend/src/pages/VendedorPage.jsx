/**
 * VISTA VENDEDOR
 *  1. Buscador de existencias en tiempo real (ERP)
 *  2. Formulario de solicitud (aparece al agregar artículos)
 *  3. Tarjetas con sus solicitudes y el estado de cada una
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ClipboardList, FileSearch, RefreshCw } from 'lucide-react';
import BuscadorExistencias from '../components/BuscadorExistencias.jsx';
import DetalleSolicitudModal from '../components/DetalleSolicitudModal.jsx';
import FormularioSolicitud from '../components/FormularioSolicitud.jsx';
import {
  Alerta, Badge, Boton, Cargando, EstadoVacio, Tarjeta, TarjetaEncabezado,
} from '../components/ui/Primitivos.jsx';
import { solicitudesApi } from '../api/client.js';
import {
  ESTILO_ESTATUS, ESTILO_PRIORIDAD, ESTATUS_FINALES,
  fecha, haceCuanto, moneda, numero,
} from '../lib/constantes.js';

export default function VendedorPage() {
  const [items, setItems] = useState([]);          // borrador de la solicitud
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');
  const [detalleId, setDetalleId] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { solicitudes } = await solicitudesApi.listar({ limite: 100 });
      setSolicitudes(solicitudes);
      setError('');
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  /** Agrega (o incrementa) un artículo al borrador. */
  const agregarArticulo = (articulo) => {
    setExito('');
    setItems((prev) => {
      const ya = prev.find((it) => it.sku === articulo.sku);
      if (ya) {
        return prev.map((it) =>
          it.sku === articulo.sku ? { ...it, cantidad: Number(it.cantidad) + 1 } : it);
      }
      return [...prev, {
        sku: articulo.sku,
        descripcion: articulo.descripcion,
        precio_lista: articulo.precio_lista,
        existencia: articulo.existencia,
        cantidad: 1,
      }];
    });
  };

  const alCrear = (solicitud) => {
    setExito(`Solicitud ${solicitud.folio} enviada a compras.`);
    cargar();
  };

  return (
    <div className="space-y-5">
      {/* 1. Buscador */}
      <BuscadorExistencias onSolicitar={agregarArticulo} />

      {/* 2. Alta de solicitud */}
      <FormularioSolicitud items={items} setItems={setItems} onCreada={alCrear} />

      {exito && <Alerta tipo="exito">{exito}</Alerta>}

      {/* 3. Mis solicitudes */}
      <Tarjeta>
        <TarjetaEncabezado
          icono={ClipboardList}
          titulo="Mis solicitudes"
          descripcion="Estado de todo lo que has enviado a compras"
          acciones={
            <Boton variante="fantasma" icono={RefreshCw} onClick={cargar}>
              Actualizar
            </Boton>
          }
        />

        {error && <div className="p-5"><Alerta tipo="error">{error}</Alerta></div>}
        {cargando && <Cargando />}

        {!cargando && solicitudes.length === 0 && !error && (
          <EstadoVacio
            icono={FileSearch}
            titulo="Aún no tienes solicitudes"
            descripcion="Busca un artículo arriba; si sale sin existencia podrás solicitarlo a compras."
          />
        )}

        {!cargando && solicitudes.length > 0 && (
          <ul className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {solicitudes.map((s) => {
              const vencida =
                s.fecha_promesa_entrega &&
                !ESTATUS_FINALES.includes(s.estatus_actual) &&
                new Date(s.fecha_promesa_entrega) < new Date();

              return (
                <li key={s.id}>
                  <button
                    onClick={() => setDetalleId(s.id)}
                    className="flex h-full w-full flex-col gap-3 rounded-xl p-4 text-left ring-1
                               ring-hairline transition-colors hover:bg-surface-alt"
                  >
                    {/* Encabezado de la tarjeta */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold tracking-tight text-ink tabular">{s.folio}</p>
                        <p className="text-[11px] text-muted">{haceCuanto(s.fecha_creacion)}</p>
                      </div>
                      <Badge texto={s.prioridad} estilo={ESTILO_PRIORIDAD[s.prioridad]} />
                    </div>

                    {/* Cliente y partidas */}
                    <div className="text-xs text-ink-2">
                      <p className="truncate">{s.cliente_nombre || 'Sin cliente asignado'}</p>
                      <p className="mt-0.5 text-muted tabular">
                        {s.total_partidas} partida(s) · {numero(s.total_piezas)} pzas ·{' '}
                        {moneda(s.monto_estimado)}
                      </p>
                    </div>

                    {/* Estatus y promesa */}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                      <Badge texto={s.estatus_actual} estilo={ESTILO_ESTATUS[s.estatus_actual]} />
                      {s.fecha_promesa_entrega && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] tabular
                                      ${vencida ? 'font-medium text-critical' : 'text-muted'}`}
                        >
                          <CalendarClock size={12} />
                          {vencida ? 'Vencida: ' : 'Entrega: '}
                          {fecha(s.fecha_promesa_entrega)}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>

      <DetalleSolicitudModal
        id={detalleId}
        abierto={detalleId !== null}
        onCerrar={() => setDetalleId(null)}
      />
    </div>
  );
}
