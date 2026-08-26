/**
 * DASHBOARD GERENCIAL
 *  - Fila de KPIs (cifras que se leen de un vistazo)
 *  - Distribución de solicitudes por estatus
 *  - Artículos más solicitados SIN existencia  <- la lista que dispara compras
 *  - Carga por sucursal
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BarChart3, CalendarX2, Clock, FolderOpen, PackageX,
  RefreshCw, Store, Wallet,
} from 'lucide-react';
import { BarrasHorizontales, Kpi } from '../components/ui/Graficos.jsx';
import {
  Alerta, Boton, Cargando, Select, Tarjeta, TarjetaEncabezado,
} from '../components/ui/Primitivos.jsx';
import { catalogosApi, dashboardApi } from '../api/client.js';
import BotonExcel from '../components/BotonExcel.jsx';
import { ESTILO_ESTATUS, moneda, numero } from '../lib/constantes.js';

const VENTANAS = [
  { valor: 7,   etiqueta: 'Últimos 7 días' },
  { valor: 30,  etiqueta: 'Últimos 30 días' },
  { valor: 90,  etiqueta: 'Últimos 90 días' },
  { valor: 365, etiqueta: 'Último año' },
];

export default function DashboardPage() {
  const [dias, setDias] = useState(30);
  const [sucursal, setSucursal] = useState('');
  const [sucursales, setSucursales] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    catalogosApi.sucursales().then((d) => setSucursales(d.sucursales)).catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const d = await dashboardApi.gerencia({ dias, sucursal: sucursal || undefined });
      setDatos(d);
      setError('');
    } catch (e) {
      setError(e.mensaje);
    } finally {
      setCargando(false);
    }
  }, [dias, sucursal]);

  useEffect(() => { cargar(); }, [cargar]);

  const t = datos?.totales;
  const tiempo = datos?.tiempo_atencion;

  return (
    <div className="space-y-5">
      {/* ── Filtros: una sola fila arriba de todo ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">Tablero gerencial</h1>
          <p className="text-xs text-ink-2">Solicitudes de compra y faltantes de inventario</p>
        </div>
        {/* Los filtros van en una sola fila arriba de las gráficas. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
              aria-label="Periodo"
            >
              {VENTANAS.map((v) => <option key={v.valor} value={v.valor}>{v.etiqueta}</option>)}
            </Select>
          </div>
          <div className="w-52">
            <Select
              value={sucursal}
              onChange={(e) => setSucursal(e.target.value)}
              aria-label="Sucursal"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </Select>
          </div>
          <BotonExcel
            tipo="indicadores"
            etiqueta="Indicadores"
            filtros={{ dias, sucursal: sucursal || undefined }}
            onError={setError}
          />
          <BotonExcel
            tipo="faltantes"
            etiqueta="Faltantes"
            filtros={{ dias, sucursal: sucursal || undefined }}
            onError={setError}
          />
          <Boton variante="secundario" icono={RefreshCw} onClick={cargar}>Actualizar</Boton>
        </div>
      </div>

      {error && <Alerta tipo="error">{error}</Alerta>}
      {cargando && !datos && <Cargando texto="Calculando métricas..." />}

      {datos && (
        <>
          {/* ── KPIs ── */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi
              etiqueta="Solicitudes"
              valor={numero(t.total_solicitudes)}
              nota={`En los últimos ${datos.ventana_dias} días`}
              icono={BarChart3}
            />
            <Kpi
              etiqueta="Abiertas"
              valor={numero(t.abiertas)}
              nota="Aún sin recibir"
              icono={FolderOpen}
            />
            <Kpi
              etiqueta="Urgentes abiertas"
              valor={numero(t.urgentes_abiertas)}
              tono={t.urgentes_abiertas > 0 ? 'critico' : 'bueno'}
              nota="Requieren atención inmediata"
              icono={AlertTriangle}
            />
            <Kpi
              etiqueta="Promesas vencidas"
              valor={numero(t.vencidas)}
              tono={t.vencidas > 0 ? 'alerta' : 'bueno'}
              nota="Fecha de compromiso rebasada"
              icono={CalendarX2}
            />
            <Kpi
              etiqueta="Atención promedio"
              valor={tiempo.dias_promedio != null ? numero(tiempo.dias_promedio) : '—'}
              unidad="días"
              nota={`${numero(tiempo.solicitudes_cerradas)} solicitud(es) cerradas`}
              icono={Clock}
            />
            <Kpi
              etiqueta="Monto estimado"
              valor={moneda(t.monto_estimado_total)}
              nota="Valor de lo solicitado"
              icono={Wallet}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* ── Artículos más solicitados sin stock ── */}
            <Tarjeta className="lg:col-span-2">
              <TarjetaEncabezado
                icono={PackageX}
                titulo="Artículos más solicitados sin existencia"
                descripcion="Candidatos a revisar el punto de reorden en el ERP"
              />
              <div className="p-5">
                <BarrasHorizontales
                  datos={datos.top_faltantes.map((f) => ({
                    etiqueta: f.sku_producto,
                    sub: f.descripcion,
                    valor: f.veces_solicitado,
                    titulo: `${f.sku_producto} — ${f.descripcion}\n`
                      + `${f.veces_solicitado} solicitud(es) · ${numero(f.piezas_solicitadas)} pzas · `
                      + `${f.sucursales_afectadas} sucursal(es)`,
                  }))}
                  formato={(n) => `${numero(n)} sol.`}
                  vacio="Sin faltantes registrados en el periodo. "
                />

                {/* Vista de tabla: el mismo dato en cifras exactas. */}
                {datos.top_faltantes.length > 0 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-medium text-brand">
                      Ver como tabla
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted">
                          <tr>
                            <th className="py-1.5 pr-3 font-medium">SKU</th>
                            <th className="py-1.5 pr-3 font-medium">Descripción</th>
                            <th className="py-1.5 pr-3 text-right font-medium">Solicitudes</th>
                            <th className="py-1.5 pr-3 text-right font-medium">Piezas</th>
                            <th className="py-1.5 text-right font-medium">Sucursales</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {datos.top_faltantes.map((f) => (
                            <tr key={f.sku_producto}>
                              <td className="py-1.5 pr-3 font-medium text-ink tabular">{f.sku_producto}</td>
                              <td className="py-1.5 pr-3 text-ink-2">{f.descripcion}</td>
                              <td className="py-1.5 pr-3 text-right tabular">{f.veces_solicitado}</td>
                              <td className="py-1.5 pr-3 text-right tabular">{numero(f.piezas_solicitadas)}</td>
                              <td className="py-1.5 text-right tabular">{f.sucursales_afectadas}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            </Tarjeta>

            {/* ── Distribución por estatus ── */}
            <Tarjeta>
              <TarjetaEncabezado
                icono={BarChart3}
                titulo="Solicitudes por estatus"
                descripcion="Dónde está atorado el flujo"
              />
              <div className="p-5">
                <BarrasHorizontales
                  datos={datos.por_estatus.map((e) => ({
                    etiqueta: e.estatus,
                    valor: e.total,
                    punto: ESTILO_ESTATUS[e.estatus]?.punto,
                  }))}
                  formato={numero}
                />
              </div>
            </Tarjeta>

            {/* ── Carga por sucursal ── */}
            <Tarjeta>
              <TarjetaEncabezado
                icono={Store}
                titulo="Carga por sucursal"
                descripcion="Total del periodo y cuántas siguen abiertas"
              />
              <div className="p-5">
                <BarrasHorizontales
                  datos={datos.por_sucursal.map((s) => ({
                    etiqueta: s.nombre,
                    sub: `${s.abiertas} abierta(s)`,
                    valor: s.total,
                    titulo: `${s.nombre} (${s.clave}): ${s.total} solicitud(es), ${s.abiertas} abierta(s)`,
                  }))}
                  formato={numero}
                />
              </div>
            </Tarjeta>
          </div>
        </>
      )}
    </div>
  );
}
