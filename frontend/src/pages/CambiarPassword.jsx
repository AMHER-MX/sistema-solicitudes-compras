/**
 * Cambio de contraseña.
 *
 * Se usa en dos momentos:
 *   · Obligatorio: la primera vez que entra alguien con la contraseña temporal
 *     que le dio el Gerente. Ahí no hay botón de cancelar — solo salir.
 *   · Voluntario: desde el menú, cuando alguien quiere cambiarla. En ese caso
 *     sí se puede cerrar.
 *
 * La validación de aquí es la misma que aplica el servidor. Se repite en el
 * navegador para que la persona vea el problema mientras escribe, pero la que
 * manda es la del servidor: esta es una comodidad, no una defensa.
 */
import { useMemo, useState } from 'react';
import { Check, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { Alerta, Boton, Campo, Input, Tarjeta } from '../components/ui/Primitivos.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const LARGO_MINIMO = 10;

/** Mismas reglas que backend/src/utils/password.js */
function revisar(password, usuario) {
  const problemas = [];
  const valor = password ?? '';
  const bajo = valor.toLowerCase();

  if (valor.length < LARGO_MINIMO) problemas.push(`Al menos ${LARGO_MINIMO} caracteres`);
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(valor)) problemas.push('Al menos una letra');
  if (!/[0-9]/.test(valor)) problemas.push('Al menos un número');
  if (/^\s|\s$/.test(valor)) problemas.push('Sin espacios al inicio o al final');

  const usuarioCorreo = (usuario?.email || '').split('@')[0].toLowerCase();
  if (usuarioCorreo.length >= 4 && bajo.includes(usuarioCorreo)) problemas.push('No puede contener tu correo');

  const nombrePila = (usuario?.nombre || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (nombrePila.length >= 3 && bajo.includes(nombrePila)) problemas.push('No puede contener tu nombre');

  return problemas;
}

export default function CambiarPassword({ obligatorio = false, onListo }) {
  const { usuario, cambiarPassword, salir } = useAuth();

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState('');
  const [detalles, setDetalles] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  const problemas = useMemo(() => revisar(nueva, usuario), [nueva, usuario]);
  const coinciden = nueva.length > 0 && nueva === confirmacion;
  const puedeGuardar = actual.length > 0 && problemas.length === 0 && coinciden && !guardando;

  const enviar = async (e) => {
    e.preventDefault();
    setError('');
    setDetalles([]);
    setGuardando(true);
    try {
      await cambiarPassword(actual, nueva);
      setListo(true);
      onListo?.();
    } catch (err) {
      setError(err.mensaje || 'No se pudo cambiar la contraseña');
      setDetalles(err.response?.data?.detalles ?? []);
    } finally {
      setGuardando(false);
    }
  };

  if (listo && !obligatorio) {
    return <Alerta tipo="exito">Tu contraseña quedó actualizada.</Alerta>;
  }

  const formulario = (
    <form onSubmit={enviar} className="space-y-4">
      {obligatorio && (
        <Alerta tipo="aviso">
          Estás usando una contraseña temporal. Elige una nueva para poder
          continuar; solo tú vas a conocerla.
        </Alerta>
      )}

      <Campo etiqueta={obligatorio ? 'Contraseña temporal' : 'Contraseña actual'} requerido>
        <Input
          type="password"
          autoComplete="current-password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          placeholder="••••••••"
          required
          autoFocus
        />
      </Campo>

      <Campo etiqueta="Contraseña nueva" requerido>
        <Input
          type="password"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="••••••••"
          required
        />
      </Campo>

      {/* Lista de requisitos en vivo: se marcan conforme se cumplen. */}
      {nueva.length > 0 && problemas.length > 0 && (
        <ul className="space-y-1 text-[11px] text-ink-2">
          {problemas.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}

      <Campo etiqueta="Confirma la contraseña nueva" requerido>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          placeholder="••••••••"
          required
        />
      </Campo>

      {confirmacion.length > 0 && !coinciden && (
        <p className="text-[11px] text-critical">Las dos contraseñas no coinciden.</p>
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

      <div className="flex gap-2">
        <Boton type="submit" icono={Check} cargando={guardando} disabled={!puedeGuardar} className="flex-1">
          Guardar contraseña
        </Boton>
        {obligatorio && (
          <Boton type="button" variante="secundario" icono={LogOut} onClick={salir}>
            Salir
          </Boton>
        )}
      </div>
    </form>
  );

  // Modo voluntario: se dibuja dentro de la pantalla que lo llamó.
  if (!obligatorio) return formulario;

  // Modo obligatorio: ocupa toda la pantalla, sin nada más alrededor.
  return (
    <div className="grid min-h-screen place-items-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid size-12 place-items-center rounded-xl bg-brand text-white">
            <KeyRound size={22} />
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Elige tu contraseña
          </h1>
          <p className="mt-1 text-xs text-ink-2">
            Hola, {usuario?.nombre?.split(' ')[0] || 'qué tal'}. Es tu primera entrada.
          </p>
        </div>

        <Tarjeta className="p-5">{formulario}</Tarjeta>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted">
          <ShieldCheck size={13} /> Nadie más puede ver tu contraseña, ni el administrador.
        </p>
      </div>
    </div>
  );
}
