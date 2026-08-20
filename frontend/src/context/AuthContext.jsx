/**
 * Contexto de sesión: expone el usuario autenticado, su rol y las
 * funciones de entrar/salir a toda la aplicación.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, sesion } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => sesion.obtenerUsuario());
  const [cargando, setCargando] = useState(Boolean(sesion.obtenerToken()));

  // Al recargar la página revalidamos el token contra el backend.
  useEffect(() => {
    if (!sesion.obtenerToken()) { setCargando(false); return; }
    authApi.yo()
      .then((d) => setUsuario(d.usuario))
      .catch(() => { sesion.limpiar(); setUsuario(null); })
      .finally(() => setCargando(false));
  }, []);

  const entrar = useCallback(async (email, password) => {
    const { token, usuario: u } = await authApi.login(email, password);
    sesion.guardar(token, u);
    setUsuario(u);
    return u;
  }, []);

  const salir = useCallback(() => {
    sesion.limpiar();
    setUsuario(null);
  }, []);

  const valor = useMemo(() => ({
    usuario,
    cargando,
    entrar,
    salir,
    esVendedor:  usuario?.rol === 'Vendedor',
    esComprador: usuario?.rol === 'Comprador',
    esGerente:   usuario?.rol === 'Gerente',
  }), [usuario, cargando, entrar, salir]);

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
};
