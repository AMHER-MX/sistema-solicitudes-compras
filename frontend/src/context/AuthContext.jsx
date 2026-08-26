/**
 * Contexto de sesión: expone el usuario autenticado, su rol y las
 * funciones de entrar/salir a toda la aplicación.
 *
 * También lleva la bandera `debeCambiarPassword`. Mientras esté encendida, la
 * aplicación muestra únicamente la pantalla de cambio de contraseña: es la
 * misma regla que aplica el servidor, que responde 403 a todo lo demás.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { EVENTO_PASSWORD_TEMPORAL, authApi, sesion } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => sesion.obtenerUsuario());
  const [cargando, setCargando] = useState(Boolean(sesion.obtenerToken()));
  const [debeCambiarPassword, setDebeCambiarPassword] = useState(
    () => Boolean(sesion.obtenerUsuario()?.debe_cambiar_password),
  );

  // Al recargar la página revalidamos el token contra el backend.
  useEffect(() => {
    if (!sesion.obtenerToken()) { setCargando(false); return; }
    authApi.yo()
      .then((d) => {
        setUsuario(d.usuario);
        setDebeCambiarPassword(Boolean(d.usuario?.debe_cambiar_password));
      })
      .catch(() => { sesion.limpiar(); setUsuario(null); })
      .finally(() => setCargando(false));
  }, []);

  // Si cualquier petición choca con el 403 de contraseña temporal —por ejemplo
  // porque un Gerente restableció la contraseña con la sesión abierta—, se
  // enciende la bandera aquí y la aplicación cambia de pantalla sola.
  useEffect(() => {
    const alDetectar = () => setDebeCambiarPassword(true);
    window.addEventListener(EVENTO_PASSWORD_TEMPORAL, alDetectar);
    return () => window.removeEventListener(EVENTO_PASSWORD_TEMPORAL, alDetectar);
  }, []);

  const entrar = useCallback(async (email, password) => {
    const { token, usuario: u, debeCambiarPassword: debe } = await authApi.login(email, password);
    sesion.guardar(token, u);
    setUsuario(u);
    setDebeCambiarPassword(Boolean(debe));
    return u;
  }, []);

  const salir = useCallback(() => {
    sesion.limpiar();
    setUsuario(null);
    setDebeCambiarPassword(false);
  }, []);

  /** Cambio de contraseña del propio usuario. Devuelve un token al día. */
  const cambiarPassword = useCallback(async (passwordActual, passwordNueva) => {
    const { token, usuario: u } = await authApi.cambiarPassword(passwordActual, passwordNueva);
    sesion.guardar(token, u);
    setUsuario(u);
    setDebeCambiarPassword(false);
    return u;
  }, []);

  const valor = useMemo(() => ({
    usuario,
    cargando,
    debeCambiarPassword,
    entrar,
    salir,
    cambiarPassword,
    esVendedor:  usuario?.rol === 'Vendedor',
    esComprador: usuario?.rol === 'Comprador',
    esGerente:   usuario?.rol === 'Gerente',
  }), [usuario, cargando, debeCambiarPassword, entrar, salir, cambiarPassword]);

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
};
