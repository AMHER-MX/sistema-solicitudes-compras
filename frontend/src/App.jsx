/**
 * Raíz de la aplicación: decide qué pantalla mostrar según sesión y rol.
 * Se resuelve con estado local (sin react-router) para mantener la v1 simple.
 */
import { useEffect, useState } from 'react';
import Layout, { pestanasPorRol } from './components/Layout.jsx';
import { Cargando, Modal } from './components/ui/Primitivos.jsx';
import { useAuth } from './context/AuthContext.jsx';
import CambiarPassword from './pages/CambiarPassword.jsx';
import ComprasPage from './pages/ComprasPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import Login from './pages/Login.jsx';
import UsuariosPage from './pages/UsuariosPage.jsx';
import VendedorPage from './pages/VendedorPage.jsx';

export default function App() {
  const { usuario, cargando, debeCambiarPassword } = useAuth();
  const [vista, setVista] = useState(null);
  const [cambiandoPassword, setCambiandoPassword] = useState(false);

  // La pestaña inicial depende del rol: cada quien entra a su pantalla.
  useEffect(() => {
    if (!usuario) { setVista(null); return; }
    const pestanas = pestanasPorRol(usuario.rol);
    setVista(pestanas[0]?.id ?? null);
  }, [usuario]);

  if (cargando) return <div className="grid min-h-screen place-items-center bg-plane"><Cargando texto="Validando sesión..." /></div>;
  if (!usuario) return <Login />;

  // Contraseña temporal: no se muestra nada más hasta que la cambie. El
  // servidor aplica la misma regla, así que ni siquiera sirve de nada esquivar
  // esta pantalla — todas las demás peticiones responderían 403.
  if (debeCambiarPassword) return <CambiarPassword obligatorio />;

  return (
    <Layout vista={vista} setVista={setVista} onCambiarPassword={() => setCambiandoPassword(true)}>
      {vista === 'vendedor'  && <VendedorPage />}
      {vista === 'compras'   && <ComprasPage />}
      {vista === 'dashboard' && <DashboardPage />}
      {vista === 'usuarios'  && <UsuariosPage />}

      <Modal
        abierto={cambiandoPassword}
        onCerrar={() => setCambiandoPassword(false)}
        ancho="max-w-md"
        titulo="Cambiar mi contraseña"
        subtitulo={usuario.email}
      >
        <CambiarPassword onListo={() => setTimeout(() => setCambiandoPassword(false), 1200)} />
      </Modal>
    </Layout>
  );
}
