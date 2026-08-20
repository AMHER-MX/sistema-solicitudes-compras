/**
 * Raíz de la aplicación: decide qué pantalla mostrar según sesión y rol.
 * Se resuelve con estado local (sin react-router) para mantener la v1 simple.
 */
import { useEffect, useState } from 'react';
import Layout, { pestanasPorRol } from './components/Layout.jsx';
import { Cargando } from './components/ui/Primitivos.jsx';
import { useAuth } from './context/AuthContext.jsx';
import ComprasPage from './pages/ComprasPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import Login from './pages/Login.jsx';
import VendedorPage from './pages/VendedorPage.jsx';

export default function App() {
  const { usuario, cargando } = useAuth();
  const [vista, setVista] = useState(null);

  // La pestaña inicial depende del rol: cada quien entra a su pantalla.
  useEffect(() => {
    if (!usuario) { setVista(null); return; }
    const pestanas = pestanasPorRol(usuario.rol);
    setVista(pestanas[0]?.id ?? null);
  }, [usuario]);

  if (cargando) return <div className="grid min-h-screen place-items-center bg-plane"><Cargando texto="Validando sesión..." /></div>;
  if (!usuario) return <Login />;

  return (
    <Layout vista={vista} setVista={setVista}>
      {vista === 'vendedor'  && <VendedorPage />}
      {vista === 'compras'   && <ComprasPage />}
      {vista === 'dashboard' && <DashboardPage />}
    </Layout>
  );
}
