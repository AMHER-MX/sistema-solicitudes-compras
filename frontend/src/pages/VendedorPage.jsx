/**
 * VISTA VENDEDOR
 *  1. Buscador de existencias en tiempo real (ERP)
 *  2. Formulario de cotización (aparece al agregar artículos)
 *  3. Dos pestañas: sus Cotizaciones y sus Pedidos
 *
 * Todo lo que captura el vendedor nace como Cotización. Se vuelve Pedido solo
 * cuando el cliente aprueba, y sin cambiar de folio.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ClipboardList, Clock, FileSearch, RefreshCw } from 'lucide-react';
import BotonExcel from '../components/BotonExcel.jsx';
import BuscadorExistencias from '../components/BuscadorExistencias.jsx';
import DetalleSolicitudModal from '../components/DetalleSolicitudModal.jsx';
import FormularioSolicitud from '../components/FormularioSolicitud.jsx';
import PestanasTipo from '../components/PestanasTipo.jsx';
import {
  Alerta, Badge, Boton, Cargando, EstadoVacio, Tarjeta, TarjetaEncabezado,
} from '../components/ui/Primitivos.jsx';
import { solicitudesApi } from '../api/client.js';
import {
  ESTILO_ESTATUS, ESTILO_PRIORIDAD, ESTATUS_FINALES, EXPLICACION_ESTATUS, TIPOS,
  fecha, haceCuanto, moneda, numero, vigencia,
} from '../lib/constantes.js';

export default function VendedorPage() {
  const [items, setItems] = useState([]);          // borrador de la cotización
  const [solicitudes, setSolicitudes] = useState([]);
  const [tipo, setTipo] = useState(TIPOS.COTIZACION);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');
  const [detalleId, setDetalleId] = useState(null);

  // Se traen los dos tipos de una vez y se filtran aquí. Son las solicitudes
  // de una sola persona: caben de sobra, y así cambiar de pestaña es
  // instantáneo en vez de otra vuelta al servidor.
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { solicitudes } = await solicitudesApi.listar({ limite: 200 });
      setSolicitudes(solicitudes);
      setError('');
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(
    () => solicitudes.filter((s) => s.tipo === tipo),
    [solicitudes, tipo],
  );

  const conteos = useMemo(() => ({
    [TIPOS.COTIZACION]: solicitudes.filter((s) => s.tipo === TIPOS.COTIZACION).length,
    [TIPOS.PEDIDO]:     solicitudes.filter((s) => s.tipo === TIPOS.PEDIDO).length,
  }), [solicitudes]);

  // Cotizaciones enviadas a las que les quedan 5 días o menos. Es el aviso que
  // evita que una venta se pierda por olvido, así que va arriba de todo.
  const porVencer = useMemo(
    () => solicitudes.filter((s) => {
      const v = vigencia(s.dias_para_vencer);
      return s.estatus_actual === 'Enviada' && v?.urgente;
    }),
    [solicitudes],
  );

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
        // Una parte capturada a mano llega con la cantidad que el cliente pidió;
        // las del catálogo se agregan de una en una y se ajustan en la tabla.
        cantidad: Number(articulo.cantidad) > 0 ? Number(articulo.cantidad) : 1,
        origen: articulo.origen ?? 'QUITER',
      }];
    });
  };

  const alCrear = (solicitud, aviso) => {
    setExito(aviso || `Cotización ${solicitud.folio} creada.`);
    setTipo(TIPOS.COTIZACION);
    cargar();
  };

  const esCotizaciones = tipo === TIPOS.COTIZACION;

  return (
    <div className="space-y-5">
      {/* Lo que está a punto de perderse por olvido va antes que nada. */}
      {porVencer.length > 0 && (
        <Alerta tipo="aviso">
          <span className="font-medium">
            {porVencer.length === 1
              ? 'Una cotización está por vencer:'
              : `${porVencer.length} cotizaciones están por vencer:`}
          </span>{' '}
          {porVencer.map((s) => `${s.folio} (${vigencia(s.dias_para_vencer).texto})`).join(', ')}.
          {' '}Si el cliente ya dijo que sí, ciérrala antes de que se caiga sola.
        </Alerta>
      )}

      {/* 1. Buscador */}
      <BuscadorExistencias onSolicitar={agregarArticulo} />

      {/* 2. Alta de cotización */}
      <FormularioSolicitud items={items} setItems={setItems} onCreada={alCrear} />

      {exito && <Alerta tipo="exito">{exito}</Alerta>}

      {/* 3. Lo mío */}
      <Tarjeta>
        <TarjetaEncabezado
          icono={ClipboardList}
          titulo="Lo mío"
          descripcion="Todo empieza como cotización; si el cliente aprueba, se vuelve pedido con el mismo folio"
          acciones={
            <div className="flex gap-2">
              <BotonExcel tipo="solicitudes" etiqueta="Excel" filtros={{ tipo }} onError={setError} />
              <BotonExcel tipo="historial" etiqueta="Seguimiento" filtros={{ tipo }} onError={setError} />
              <Boton variante="fantasma" icono={RefreshCw} onClick={cargar}>
                Actualizar
              </Boton>
            </div>
          }
        />

        <div className="px-5 pt-4">
          <PestanasTipo valor={tipo} onCambiar={setTipo} conteos={conteos} />
        </div>

        {error && <div className="p-5"><Alerta tipo="error">{error}</Alerta></div>}
        {cargando && <Cargando />}

        {!cargando && visibles.length === 0 && !error && (
          <EstadoVacio
            icono={FileSearch}
            titulo={esCotizaciones ? 'Aún no tienes cotizaciones' : 'Todavía no tienes pedidos'}
            descripcion={esCotizaciones
              ? 'Busca un artículo arriba y agrégalo: con eso se arma la cotización del cliente.'
              : 'Un pedido aparece aquí cuando el cliente aprueba una de tus cotizaciones.'}
          />
        )}

        {!cargando && visibles.length > 0 && (
          <ul className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {visibles.map((s) => {
              const atrasada =
                s.fecha_promesa_entrega &&
                !ESTATUS_FINALES.includes(s.estatus_actual) &&
                new Date(s.fecha_promesa_entrega) < new Date();

              const plazo = s.estatus_actual === 'Enviada' ? vigencia(s.dias_para_vencer) : null;
              const conAlza = Number(s.partidas_con_alza) > 0;

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

                    {/* El precio de Quiter se movió respecto a lo cotizado.
                        No cambia lo prometido: solo avisa para que se decida. */}
                    {conAlza && (
                      <p className="inline-flex items-center gap-1 rounded-lg bg-warning/12 px-2 py-1
                                    text-[11px] text-ink ring-1 ring-warning/40">
                        <AlertTriangle size={12} />
                        {Number(s.partidas_con_alza) === 1
                          ? 'Una partida subió de precio en Quiter'
                          : `${s.partidas_con_alza} partidas subieron de precio en Quiter`}
                      </p>
                    )}

                    {/* Estatus, plazo y promesa */}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span title={EXPLICACION_ESTATUS[s.estatus_actual]}>
                        <Badge texto={s.estatus_actual} estilo={ESTILO_ESTATUS[s.estatus_actual]} />
                      </span>

                      {plazo && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] tabular
                                      ${plazo.urgente ? 'font-medium text-critical' : 'text-muted'}`}
                        >
                          <Clock size={12} />
                          {plazo.texto}
                        </span>
                      )}

                      {!plazo && s.fecha_promesa_entrega && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] tabular
                                      ${atrasada ? 'font-medium text-critical' : 'text-muted'}`}
                        >
                          <CalendarClock size={12} />
                          {atrasada ? 'Atrasada: ' : 'Entrega: '}
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
        onCambio={cargar}
      />
    </div>
  );
}
