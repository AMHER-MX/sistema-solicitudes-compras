/**
 * Cliente HTTP único de la aplicación.
 *
 * - Inyecta el token JWT en cada petición.
 * - Si el token expira (401), limpia la sesión y regresa al login.
 * - Normaliza los mensajes de error para poder mostrarlos directo en la UI.
 */
import axios from 'axios';

const LLAVE_TOKEN = 'sgc_token';
const LLAVE_USUARIO = 'sgc_usuario';

export const sesion = {
  obtenerToken:   () => localStorage.getItem(LLAVE_TOKEN),
  obtenerUsuario: () => {
    try { return JSON.parse(localStorage.getItem(LLAVE_USUARIO)) || null; }
    catch { return null; }
  },
  guardar: (token, usuario) => {
    localStorage.setItem(LLAVE_TOKEN, token);
    localStorage.setItem(LLAVE_USUARIO, JSON.stringify(usuario));
  },
  limpiar: () => {
    localStorage.removeItem(LLAVE_TOKEN);
    localStorage.removeItem(LLAVE_USUARIO);
  },
};

export const api = axios.create({
  // En desarrollo Vite hace proxy de /api hacia el backend (ver vite.config.js).
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = sesion.obtenerToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Evento que se dispara cuando el servidor responde que la contraseña sigue
 * siendo la temporal. Lo escucha AuthContext para mandar a la pantalla de
 * cambio sin que cada llamada tenga que acordarse de revisarlo.
 */
export const EVENTO_PASSWORD_TEMPORAL = 'sgc:password-temporal';

api.interceptors.response.use(
  (respuesta) => respuesta,
  (error) => {
    if (error.response?.status === 401 && sesion.obtenerToken()) {
      sesion.limpiar();
      window.location.reload(); // regresa al login
    }

    // 403 + codigo PASSWORD_TEMPORAL: la cuenta entró pero está obligada a
    // cambiar la contraseña. No se cierra la sesión —se necesita para poder
    // cambiarla—, solo se avisa a la aplicación.
    if (error.response?.status === 403 && error.response?.data?.codigo === 'PASSWORD_TEMPORAL') {
      window.dispatchEvent(new CustomEvent(EVENTO_PASSWORD_TEMPORAL));
    }
    // Mensaje legible para el usuario final.
    error.mensaje =
      error.response?.data?.error ||
      (error.code === 'ECONNABORTED' ? 'La petición tardó demasiado.' : null) ||
      error.message ||
      'Error de comunicación con el servidor.';
    return Promise.reject(error);
  },
);

/* ───────────── Funciones por módulo (todo el frontend usa estas) ──────────── */

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data),
  yo:    () => api.get('/auth/yo').then((r) => r.data),
  cambiarPassword: (passwordActual, passwordNueva) =>
    api.post('/auth/cambiar-password', { passwordActual, passwordNueva }).then((r) => r.data),
};

/** Administración de cuentas. Solo responde si quien pregunta es Gerente. */
export const usuariosApi = {
  listar:  (filtros = {}) => api.get('/usuarios', { params: filtros }).then((r) => r.data),
  crear:   (payload) => api.post('/usuarios', payload).then((r) => r.data),
  actualizar: (id, payload) => api.patch(`/usuarios/${id}`, payload).then((r) => r.data),
  restablecerPassword: (id) => api.post(`/usuarios/${id}/password`).then((r) => r.data),
};

export const productosApi = {
  existencias: (sku, almacen) =>
    api.get('/productos/existencias', { params: { sku, almacen } }).then((r) => r.data),
};

export const solicitudesApi = {
  listar:  (filtros = {}) => api.get('/solicitudes', { params: filtros }).then((r) => r.data),
  obtener: (id) => api.get(`/solicitudes/${id}`).then((r) => r.data),
  crear:   (payload) => api.post('/solicitudes', payload).then((r) => r.data),
  cambiarEstatus: (id, payload) =>
    api.patch(`/solicitudes/${id}/estatus`, payload).then((r) => r.data),
};

export const dashboardApi = {
  gerencia: (params = {}) => api.get('/dashboard/gerencia', { params }).then((r) => r.data),
};

export const catalogosApi = {
  sucursales: () => api.get('/catalogos/sucursales').then((r) => r.data),
  clientes:   (q = '') => api.get('/catalogos/clientes', { params: { q } }).then((r) => r.data),
};
