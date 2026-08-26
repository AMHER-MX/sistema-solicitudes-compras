/**
 * MESA DE TRABAJO DE COMPRAS
 * Tabla interactiva con filtros por urgencia, estatus, sucursal y texto libre.
 * Cada renglón abre el panel de seguimiento para mover el estatus.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Eye, Inbox, PencilLine, RefreshCw, Search, TriangleAlert,
} from 'lucide-react';
import DetalleSolicitudModal from '../components/DetalleSolicitudModal.jsx';
import PanelSeguimiento from '../components/PanelSeguimiento.jsx';
import {
  Alerta, Badge, Boton, Cargando, EstadoVacio, Input, Select, Tarjeta, TarjetaEncabezado,
} from '../components/ui/Primitivos.jsx';
import { catalogosApi, solicitudesApi } from '../api/client.js';
import BotonExcel from '../components/BotonExcel.jsx';
import {
  ESTATUS, ESTATUS_FINALES, ESTILO_ESTATUS, ESTILO_PRIORIDAD, PRIORIDADES,
  fecha, moneda, numero,
} from '../lib/constantes.js';

/** Filtros rápidos: lo que compras necesita ver primero. */
const VISTAS_RAPIDAS = [
  { id: 'abiertas',  etiqueta: 'Bandeja abierta', estatus: 'Pendiente,En Cotizacion,Autorizada,En Transito' },
  { id: 'pendiente', etiqueta: 'Por atender',     estatus: 'Pendiente' },
  { id: 'transito',  etiqueta: 'En tránsito',     estatus: 'En Transito' },
  { id: 'todas',     etiqueta: 'Todas',           estatus: '' },
];

export default function ComprasPage() {
  const [vistaRapida, setVistaRapida] = useState('abiertas');
  const [prioridad, setPrioridad] = useState('');
  const [estatus, setEstatus] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const [sucursales, setSucursales] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [enSeguimiento, setEnSeguimiento] = useState(null);
  const [detalleId, setDetalleId] = useState(null);

  useEffect(() => {
    catalogosApi.sucursales().then((d) => setSucursales(d.sucursales)).catch(() => {});
  }, []);

  const filtros = useMemo(() => {
    // El select de estatus específico manda sobre la vista rápida.
    const porVista = VISTAS_RAPIDAS.find((v) => v.id === vistaRapida)?.estatus ?? '';
    return {
      estatus: estatus || porVista || undefined,
      prioridad: prioridad || undefined,
      sucursal: sucursal || undefined,
      busqueda: busqueda.trim() || undefined,
      limite: 200,
    };
  }, [vistaRapida, estatus, prioridad, sucursal, busqueda]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const { solicitudes } = await solicitudesApi.listar(filtros);
      setSolicitudes(solicitudes);
      setError('');
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  // Recarga con un pequeño retraso para no pegarle a la API en cada tecla.
  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const urgentesAbiertas = solicitudes.filter(
    (s) => s.prioridad === 'Urgente' && !ESTATUS_FINALES.includes(s.estatus_actual),
  ).length;

  return (
    <div className="space-y-5">
      <Tarjeta>
        <TarjetaEncabezado
          icono={ClipboardList}
          titulo="Mesa de trabajo · Compras"
          descripcion={`${solicitudes.length} solicitud(es) en pantalla${urgentesAbiertas ? ` · ${urgentesAbiertas} urgente(s) por resolver` : ''}`}
          acciones={(
            <div className="flex gap-2">
              {/* Los mismos filtros que la tabla: lo que se ve es lo que se baja. */}
              <BotonExcel tipo="solicitudes" etiqueta="Excel" filtros={filtros} onError={setError} />
              <BotonExcel tipo="historial" etiqueta="Seguimiento" filtros={filtros} onError={setError} />
              <Boton variante="fantasma" icono={RefreshCw} onClick={cargar}>Actualizar</Boton>
            </div>
          )}
        />

        {/* ── Filtros: una sola fila arriba de la tabla ── */}
        <div className="space-y-3 border-b border-hairline px-5 py-4">
          <div className="flex flex-wrap gap-1.5">
            {VISTAS_RAPIDAS.map((v) => (
              <button
                key={v.id}
                onClick={() => { setVistaRapida(v.id); setEstatus(''); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
                            ${vistaRapida === v.id && !estatus
                              ? 'bg-brand/10 text-brand ring-1 ring-brand/30'
                              : 'text-ink-2 ring-1 ring-hairline hover:bg-surface-alt'}`}
              >
                {v.etiqueta}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Folio o cliente..."
                className="pl-9"
                aria-label="Buscar por folio o cliente"
              />
            </div>
            <Select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} aria-label="Filtrar por prioridad">
              <option value="">Toda prioridad</option>
              {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Select value={estatus} onChange={(e) => setEstatus(e.target.value)} aria-label="Filtrar por estatus">
              <option value="">Todo estatus</option>
              {ESTATUS.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>
            <Select value={sucursal} onChange={(e) => setSucursal(e.target.value)} aria-label="Filtrar por sucursal">
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Select>
          </div>
        </div>

        {error && <div className="p-5"><Alerta tipo="error">{error}</Alerta></div>}
        {cargando && <Cargando texto="Consultando solicitudes..." />}

        {!cargando && solicitudes.length === 0 && !error && (
          <EstadoVacio
            icono={Inbox}
            titulo="Nada por atender aquí"
            descripcion="Ajusta los filtros o revisa la vista «Todas»."
          />
        )}

        {/* ── Tabla ── */}
        {!cargando && solicitudes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-hairline bg-surface-alt text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Folio</th>
                  <th className="px-4 py-2.5 text-left font-medium">Prioridad</th>
                  <th className="px-4 py-2.5 text-left font-medium">Vendedor / Sucursal</th>
                  <th className="px-4 py-2.5 text-left font-medium">Cliente</th>
                  <th className="px-4 py-2.5 text-right font-medium">Partidas</th>
                  <th className="px-4 py-2.5 text-right font-medium">Importe</th>
                  <th className="px-4 py-2.5 text-left font-medium">Estatus</th>
                  <th className="px-4 py-2.5 text-left font-medium">Promesa</th>
                  <th className="px-4 py-2.5 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {solicitudes.map((s) => {
                  const abierta = !ESTATUS_FINALES.includes(s.estatus_actual);
                  const vencida = s.fecha_promesa_entrega && abierta &&
                    new Date(s.fecha_promesa_entrega) < new Date();
                  const anejaUrgente = s.prioridad === 'Urgente' && abierta && s.dias_abierta >= 2;

                  return (
                    <tr key={s.id} className="hover:bg-surface-alt/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink tabular">{s.folio}</p>
                        <p className="text-[11px] text-muted tabular">
                          {fecha(s.fecha_creacion)} · {numero(s.dias_abierta)} d
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Badge texto={s.prioridad} estilo={ESTILO_PRIORIDAD[s.prioridad]} />
                          {anejaUrgente && (
                            <span title="Urgente sin resolver por más de 2 días" className="text-critical">
                              <TriangleAlert size={14} />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-ink">{s.vendedor_nombre}</p>
                        <p className="text-[11px] text-muted">{s.sucursal_nombre}</p>
                      </td>
                      <td className="max-w-[180px] px-4 py-3">
                        <p className="truncate text-ink-2">{s.cliente_nombre || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular text-ink-2">
                        {s.total_partidas} <span className="text-muted">/ {numero(s.total_piezas)} pz</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular text-ink">{moneda(s.monto_estimado)}</td>
                      <td className="px-4 py-3">
                        <Badge texto={s.estatus_actual} estilo={ESTILO_ESTATUS[s.estatus_actual]} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs tabular ${vencida ? 'font-medium text-critical' : 'text-ink-2'}`}>
                          {fecha(s.fecha_promesa_entrega)}
                          {vencida && <span className="ml-1">(vencida)</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setDetalleId(s.id)}
                            title="Ver detalle y bitácora"
                            className="rounded-lg p-1.5 text-muted hover:bg-surface-alt hover:text-ink"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() => setEnSeguimiento(s)}
                            disabled={!abierta}
                            title={abierta ? 'Dar seguimiento' : 'Solicitud cerrada'}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5
                                       text-xs font-medium text-white hover:bg-brand-strong
                                       disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <PencilLine size={13} /> Seguimiento
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <PanelSeguimiento
        solicitud={enSeguimiento}
        abierto={enSeguimiento !== null}
        onCerrar={() => setEnSeguimiento(null)}
        onGuardado={cargar}
      />

      <DetalleSolicitudModal
        id={detalleId}
        abierto={detalleId !== null}
        onCerrar={() => setDetalleId(null)}
      />
    </div>
  );
}
