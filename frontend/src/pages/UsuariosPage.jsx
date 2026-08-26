/**
 * Administración de cuentas. Solo la ve el Gerente.
 *
 * Lo importante de esta pantalla:
 *   · Al crear una cuenta o restablecer una contraseña, el sistema genera una
 *     contraseña temporal y la muestra UNA vez. No se puede volver a consultar
 *     —solo se guarda su huella—, así que la ventana insiste en copiarla.
 *   · Las cuentas no se borran: se desactivan. El nombre de quien capturó una
 *     solicitud tiene que seguir apareciendo en su historial.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, Copy, KeyRound, Pencil, Search, ShieldAlert, UserPlus, Users,
} from 'lucide-react';
import { catalogosApi, usuariosApi } from '../api/client.js';
import {
  Alerta, Badge, Boton, Campo, Cargando, EstadoVacio, Input, Modal, Select,
  Tarjeta, TarjetaEncabezado,
} from '../components/ui/Primitivos.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { DESCRIPCION_ROL, ESTILO_ROL, ROLES, fechaHora } from '../lib/constantes.js';

/* ──────────────────── Ventana de la contraseña temporal ─────────────────── */

function ModalPasswordTemporal({ datos, onCerrar }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(datos.passwordTemporal);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles (pasa en http sin certificado): que la
      // seleccione a mano. Por eso el texto siempre está visible y es grande.
      setCopiado(false);
    }
  };

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="max-w-md"
      titulo={datos.titulo}
      subtitulo={`${datos.usuario.nombre} · ${datos.usuario.email}`}
    >
      <div className="space-y-4">
        <Alerta tipo="aviso">
          Esta contraseña no se vuelve a mostrar. Cópiala y entrégasela a la
          persona; el sistema le va a pedir que la cambie al entrar.
        </Alerta>

        <div className="rounded-lg bg-surface-alt px-4 py-3 text-center">
          <p className="font-mono text-xl tracking-wider text-ink select-all break-all">
            {datos.passwordTemporal}
          </p>
        </div>

        <div className="flex gap-2">
          <Boton
            variante={copiado ? 'secundario' : 'primario'}
            icono={copiado ? Check : Copy}
            onClick={copiar}
            className="flex-1"
          >
            {copiado ? 'Copiada' : 'Copiar contraseña'}
          </Boton>
          <Boton variante="secundario" onClick={onCerrar}>Listo</Boton>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────── Alta / edición ─────────────────────────────── */

const VACIO = { nombre: '', email: '', rol: 'Vendedor', sucursal_id: '' };

function ModalUsuario({ usuario, sucursales, onCerrar, onGuardado }) {
  const esAlta = !usuario;
  const [datos, setDatos] = useState(() => (usuario
    ? {
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      sucursal_id: usuario.sucursal_id ?? '',
      activo: Boolean(usuario.activo),
    }
    : VACIO));
  const [error, setError] = useState('');
  const [detalles, setDetalles] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (campo) => (e) => setDatos((d) => ({ ...d, [campo]: e.target.value }));

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    setDetalles([]);
    setGuardando(true);
    try {
      if (esAlta) {
        const r = await usuariosApi.crear({
          nombre: datos.nombre,
          email: datos.email,
          rol: datos.rol,
          sucursal_id: datos.sucursal_id === '' ? null : Number(datos.sucursal_id),
        });
        onGuardado({
          titulo: 'Cuenta creada',
          usuario: r.usuario,
          passwordTemporal: r.passwordTemporal,
        });
      } else {
        await usuariosApi.actualizar(usuario.id, {
          nombre: datos.nombre,
          rol: datos.rol,
          sucursal_id: datos.sucursal_id === '' ? null : Number(datos.sucursal_id),
          activo: datos.activo,
        });
        onGuardado(null);
      }
    } catch (err) {
      setError(err.mensaje || 'No se pudo guardar');
      setDetalles(err.response?.data?.detalles ?? []);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="max-w-lg"
      titulo={esAlta ? 'Nueva cuenta' : 'Editar cuenta'}
      subtitulo={esAlta
        ? 'El sistema genera una contraseña temporal al guardar.'
        : usuario.email}
    >
      <form onSubmit={enviar} className="space-y-4">
        <Campo etiqueta="Nombre completo" requerido>
          <Input value={datos.nombre} onChange={cambiar('nombre')} required autoFocus
                 placeholder="Ana Ríos Vega" />
        </Campo>

        <Campo
          etiqueta="Correo electrónico"
          requerido={esAlta}
          hint={esAlta ? 'Es con lo que va a entrar al sistema.' : 'El correo no se puede cambiar.'}
        >
          <Input
            type="email"
            value={datos.email}
            onChange={cambiar('email')}
            required={esAlta}
            disabled={!esAlta}
            placeholder="ana.rios@amher.com.mx"
          />
        </Campo>

        <Campo etiqueta="Rol" requerido hint={DESCRIPCION_ROL[datos.rol]}>
          <Select value={datos.rol} onChange={cambiar('rol')}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Campo>

        <Campo
          etiqueta="Sucursal"
          requerido={datos.rol === 'Vendedor'}
          hint={datos.rol === 'Vendedor'
            ? 'Es la sucursal que se graba en cada solicitud que levante.'
            : 'Opcional para Compras y Gerencia.'}
        >
          <Select value={datos.sucursal_id} onChange={cambiar('sucursal_id')}>
            <option value="">Sin sucursal</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.clave} · {s.nombre}</option>
            ))}
          </Select>
        </Campo>

        {!esAlta && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={datos.activo}
              onChange={(e) => setDatos((d) => ({ ...d, activo: e.target.checked }))}
              className="size-4 rounded border-hairline"
            />
            Cuenta activa
            <span className="text-xs text-muted">
              (desactivarla le quita el acceso sin borrar su historial)
            </span>
          </label>
        )}

        {error && (
          <Alerta tipo="error">
            {error}
            {detalles.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {detalles.map((d) => <li key={d}>{d}</li>)}
              </ul>
            )}
          </Alerta>
        )}

        <div className="flex justify-end gap-2 border-t border-hairline pt-4">
          <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" cargando={guardando} icono={esAlta ? UserPlus : Check}>
            {esAlta ? 'Crear cuenta' : 'Guardar cambios'}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────────────────────── Pantalla ───────────────────────────────── */

export default function UsuariosPage() {
  const { usuario: yo } = useAuth();

  const [lista, setLista] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [busqueda, setBusqueda] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);

  const [editando, setEditando] = useState(undefined); // undefined = cerrado, null = alta
  const [passwordTemporal, setPasswordTemporal] = useState(null);
  const [reseteando, setReseteando] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const r = await usuariosApi.listar({
        q: busqueda || undefined,
        rol: filtroRol || undefined,
        activo: verInactivos ? undefined : '1',
      });
      setLista(r.usuarios);
    } catch (err) {
      setError(err.mensaje || 'No se pudo cargar la lista');
    } finally {
      setCargando(false);
    }
  }, [busqueda, filtroRol, verInactivos]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    catalogosApi.sucursales().then((r) => setSucursales(r.sucursales)).catch(() => {});
  }, []);

  const restablecer = async (u) => {
    setReseteando(u.id);
    setError('');
    try {
      const r = await usuariosApi.restablecerPassword(u.id);
      setPasswordTemporal({
        titulo: 'Contraseña restablecida',
        usuario: r.usuario,
        passwordTemporal: r.passwordTemporal,
      });
      cargar();
    } catch (err) {
      setError(err.mensaje || 'No se pudo restablecer la contraseña');
    } finally {
      setReseteando(null);
    }
  };

  const cuentasDemo = useMemo(
    () => lista.filter((u) => u.activo && /@demo\.mx$/i.test(u.email)),
    [lista],
  );

  return (
    <div className="space-y-4">
      {cuentasDemo.length > 0 && (
        <Alerta tipo="aviso">
          <strong>
            {cuentasDemo.length === 1
              ? 'Hay una cuenta de prueba activa'
              : `Hay ${cuentasDemo.length} cuentas de prueba activas`}
          </strong>
          {' '}({cuentasDemo.map((u) => u.email).join(', ')}).
          {cuentasDemo.length === 1 ? ' Usa' : ' Usan'} una contraseña conocida.
          {cuentasDemo.length === 1 ? ' Desactívala' : ' Desactívalas'} antes de
          abrir el sistema al equipo.
        </Alerta>
      )}

      <Tarjeta>
        <TarjetaEncabezado
          titulo="Usuarios"
          descripcion="Quién entra al sistema y con qué permisos"
          icono={Users}
          acciones={(
            <Boton icono={UserPlus} onClick={() => setEditando(null)}>
              Nueva cuenta
            </Boton>
          )}
        />

        {/* Filtros */}
        <div className="flex flex-wrap items-end gap-3 border-b border-hairline px-5 py-3">
          <div className="min-w-52 flex-1">
            <Campo etiqueta="Buscar">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Nombre o correo"
                  className="pl-8"
                />
              </div>
            </Campo>
          </div>

          <div className="w-44">
            <Campo etiqueta="Rol">
              <Select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)}>
                <option value="">Todos</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Campo>
          </div>

          <label className="mb-2 flex items-center gap-2 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={verInactivos}
              onChange={(e) => setVerInactivos(e.target.checked)}
              className="size-4 rounded border-hairline"
            />
            Incluir desactivadas
          </label>
        </div>

        {error && <div className="px-5 pt-4"><Alerta tipo="error">{error}</Alerta></div>}

        {cargando ? <Cargando texto="Cargando usuarios..." />
          : lista.length === 0 ? (
            <EstadoVacio
              icono={Users}
              titulo="Sin resultados"
              descripcion="Cambia los filtros o crea la primera cuenta."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-muted">
                    <th className="px-5 py-2 font-medium">Persona</th>
                    <th className="px-3 py-2 font-medium">Rol</th>
                    <th className="px-3 py-2 font-medium">Sucursal</th>
                    <th className="px-3 py-2 font-medium">Último acceso</th>
                    <th className="px-5 py-2 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((u) => (
                    <tr
                      key={u.id}
                      className={`border-b border-hairline last:border-0 ${u.activo ? '' : 'opacity-55'}`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-medium text-ink">
                              {u.nombre}
                              {u.id === yo.id && <span className="ml-1.5 text-[11px] text-muted">(tú)</span>}
                            </p>
                            <p className="text-xs text-muted">{u.email}</p>
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {!u.activo && (
                            <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] text-ink-2 ring-1 ring-hairline">
                              Desactivada
                            </span>
                          )}
                          {u.debe_cambiar_password && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] text-ink ring-1 ring-warning/45">
                              <ShieldAlert size={10} /> Contraseña temporal
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge texto={u.rol} estilo={ESTILO_ROL[u.rol]} />
                      </td>
                      <td className="px-3 py-3 text-ink-2">
                        {u.sucursal_nombre
                          ? <span className="whitespace-nowrap">{u.sucursal_clave} · {u.sucursal_nombre}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                        {u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : <span className="text-muted">Nunca</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Boton
                            variante="fantasma"
                            icono={KeyRound}
                            cargando={reseteando === u.id}
                            disabled={!u.activo}
                            onClick={() => restablecer(u)}
                            title="Generar una contraseña temporal nueva"
                            className="px-2"
                          >
                            <span className="hidden lg:inline">Contraseña</span>
                          </Boton>
                          <Boton
                            variante="fantasma"
                            icono={Pencil}
                            onClick={() => setEditando(u)}
                            title="Editar"
                            className="px-2"
                          >
                            <span className="hidden lg:inline">Editar</span>
                          </Boton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Tarjeta>

      {editando !== undefined && (
        <ModalUsuario
          usuario={editando}
          sucursales={sucursales}
          onCerrar={() => setEditando(undefined)}
          onGuardado={(datosPassword) => {
            setEditando(undefined);
            if (datosPassword) setPasswordTemporal(datosPassword);
            cargar();
          }}
        />
      )}

      {passwordTemporal && (
        <ModalPasswordTemporal
          datos={passwordTemporal}
          onCerrar={() => setPasswordTemporal(null)}
        />
      )}
    </div>
  );
}
