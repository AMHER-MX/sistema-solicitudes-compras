/**
 * Pantalla de acceso.
 *
 * Los accesos rápidos de demostración solo aparecen cuando la interfaz corre
 * en modo desarrollo (`npm run dev`). En la versión compilada que se publica
 * en el servidor no se muestran ni se precargan: anunciar en la pantalla de
 * entrada que existe un usuario "gerente" con contraseña conocida sería
 * regalarle el sistema a cualquiera que abra la página.
 */
import { useState } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { LogoCatosa } from '../components/LogoCatosa.jsx';
import { Alerta, Boton, Campo, Input, Tarjeta } from '../components/ui/Primitivos.jsx';

const DEMO = [
  { rol: 'Vendedor',  email: 'vendedor@demo.mx',  descripcion: 'Levanta solicitudes' },
  { rol: 'Comprador', email: 'comprador@demo.mx', descripcion: 'Mesa de trabajo' },
  { rol: 'Gerente',   email: 'gerente@demo.mx',   descripcion: 'Dashboard' },
];

/** true solo con `npm run dev`; en el build de producción es false. */
const EN_DESARROLLO = import.meta.env.DEV;

export default function Login() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState(EN_DESARROLLO ? 'vendedor@demo.mx' : '');
  const [password, setPassword] = useState(EN_DESARROLLO ? 'demo1234' : '');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      await entrar(email.trim(), password);
    } catch (err) {
      setError(err.mensaje || 'No se pudo iniciar sesión');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Identidad del sistema */}
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoCatosa className="mb-5 w-52 text-ink" />
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Solicitudes de Compras
          </h1>
          <p className="mt-1 text-xs text-ink-2">
            Enlace entre piso de venta y el área de compras
          </p>
        </div>

        <Tarjeta className="p-5">
          <form onSubmit={enviar} className="space-y-4">
            <Campo etiqueta="Correo electrónico" requerido>
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                required
              />
            </Campo>

            <Campo etiqueta="Contraseña" requerido>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </Campo>

            {error && <Alerta tipo="error">{error}</Alerta>}

            <Boton type="submit" icono={LogIn} cargando={cargando} className="w-full">
              Entrar
            </Boton>
          </form>

          {/* Accesos de demostración: solo en desarrollo */}
          {EN_DESARROLLO && (
          <div className="mt-5 border-t border-hairline pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <ShieldCheck size={13} /> Usuarios de prueba (password: demo1234)
            </p>
            <div className="grid gap-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => { setEmail(d.email); setPassword('demo1234'); }}
                  className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left
                             text-xs ring-1 ring-hairline hover:bg-surface-alt"
                >
                  <span className="font-medium text-ink">{d.rol}</span>
                  <span className="text-muted">{d.descripcion}</span>
                </button>
              ))}
            </div>
          </div>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
