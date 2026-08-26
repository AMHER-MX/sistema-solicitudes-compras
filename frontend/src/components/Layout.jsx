/**
 * Marco de la aplicación: barra superior con navegación por rol,
 * identidad del usuario y botón de salida.
 */
import { BarChart3, ClipboardList, KeyRound, LogOut, Search, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { LogoCatosa } from './LogoCatosa.jsx';

/** Pestañas visibles según el rol del usuario. */
export function pestanasPorRol(rol) {
  const todas = [
    { id: 'vendedor',  etiqueta: 'Mis solicitudes', icono: Search,        roles: ['Vendedor', 'Gerente'] },
    { id: 'compras',   etiqueta: 'Mesa de compras', icono: ClipboardList, roles: ['Comprador', 'Gerente'] },
    { id: 'dashboard', etiqueta: 'Dashboard',       icono: BarChart3,     roles: ['Gerente', 'Comprador'] },
    { id: 'usuarios',  etiqueta: 'Usuarios',        icono: Users,         roles: ['Gerente'] },
  ];
  return todas.filter((t) => t.roles.includes(rol));
}

export default function Layout({ vista, setVista, onCambiarPassword, children }) {
  const { usuario, salir } = useAuth();
  const pestanas = pestanasPorRol(usuario.rol);

  return (
    <div className="min-h-screen bg-plane">
      <header className="sticky top-0 z-40 border-b border-hairline bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          {/* Marca: el logo de la empresa y, separado, el nombre del sistema */}
          <div className="flex shrink-0 items-center gap-3">
            <LogoCatosa className="w-24 text-ink sm:w-28" conBajada={false} />
            <span className="hidden h-8 w-px bg-hairline sm:block" aria-hidden />
            <div className="hidden leading-tight sm:block">
              <p className="text-sm font-semibold tracking-tight text-ink">SGC Compras</p>
              <p className="text-[11px] text-muted">
                {usuario.sucursal_nombre || 'Sin sucursal'}
              </p>
            </div>
          </div>

          {/* Navegación */}
          <nav className="ml-2 flex flex-1 items-center gap-1 overflow-x-auto">
            {pestanas.map((p) => {
              const activa = vista === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setVista(p.id)}
                  aria-current={activa ? 'page' : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                              font-medium transition-colors
                              ${activa
                                ? 'bg-brand/10 text-brand'
                                : 'text-ink-2 hover:bg-surface-alt hover:text-ink'}`}
                >
                  <p.icono size={15} />
                  <span className="hidden sm:inline">{p.etiqueta}</span>
                </button>
              );
            })}
          </nav>

          {/* Usuario */}
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-xs font-medium text-ink">{usuario.nombre}</p>
              <p className="text-[11px] text-muted">{usuario.rol}</p>
            </div>
            <button
              onClick={onCambiarPassword}
              title="Cambiar mi contraseña"
              className="rounded-lg p-2 text-muted hover:bg-surface-alt hover:text-ink"
            >
              <KeyRound size={16} />
            </button>
            <button
              onClick={salir}
              title="Cerrar sesión"
              className="rounded-lg p-2 text-muted hover:bg-surface-alt hover:text-ink"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
