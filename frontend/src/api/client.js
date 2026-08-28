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
    // Cuando la respuesta esperada era un archivo, el cuerpo del error llega
    // como blob y `data.error` no existe: hay que leerlo como texto primero.
    if (error.response?.data instanceof Blob && error.response.data.type?.includes('json')) {
      return error.response.data.text().then((texto) => {
        try { error.mensaje = JSON.parse(texto).error; } catch { /* se queda el genérico */ }
        error.mensaje = error.mensaje || 'No se pudo generar el archivo.';
        return Promise.reject(error);
      });
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

  /**
   * Editar o recotizar. El folio nunca cambia; si el cliente ya la había visto,
   * el servidor sube la versión y devuelve un aviso diciéndolo.
   */
  editar: (id, payload) => api.patch(`/solicitudes/${id}`, payload).then((r) => r.data),

  /** Cómo va el trabajo de Compras. Eje aparte del estatus del documento. */
  estatusCompras: (id, estatus_compras, comentario) =>
    api.patch(`/solicitudes/${id}/compras`, { estatus_compras, comentario }).then((r) => r.data),

  /**
   * Manda la cotización al cliente: congela el precio y arranca el plazo.
   *
   * Si el precio de Quiter cambió desde que se armó, el servidor responde 409
   * con la lista de partidas afectadas en `detalles`. Eso NO es un fallo: es
   * el sistema pidiendo que alguien lo vea antes de comprometer un precio. La
   * pantalla lo muestra y vuelve a llamar con `confirmar: true` si el vendedor
   * decide mandarla de todos modos.
   */
  enviar: (id, payload = {}) =>
    api.post(`/solicitudes/${id}/enviar`, payload).then((r) => r.data),

  /** El cliente aprobó: la cotización se vuelve pedido, con el mismo folio. */
  convertir: (id, payload = {}) =>
    api.post(`/solicitudes/${id}/convertir`, payload).then((r) => r.data),

  /** Vuelve a preguntarle el precio a Quiter. */
  refrescarPrecios: (id) => api.post(`/solicitudes/${id}/precios`).then((r) => r.data),
};

/**
 * Descargas a Excel.
 *
 * No se puede usar un <a href> normal: la API pide el token en un encabezado y
 * un enlace no lo manda. Así que el archivo se pide con axios, se recibe como
 * blob y se dispara la descarga desde memoria.
 */
export const reportesApi = {
  descargar: async (tipo, filtros = {}) => {
    const respuesta = await api.get(`/reportes/${tipo}`, {
      params: filtros,
      responseType: 'blob',
      // Un Excel grande tarda más que una consulta normal.
      timeout: 120000,
    });

    // El nombre lo decide el servidor; si no llegara, uno razonable de reserva.
    const cabecera = respuesta.headers['content-disposition'] || '';
    const coincidencia = /filename="?([^";]+)"?/i.exec(cabecera);
    const nombre = coincidencia
      ? coincidencia[1]
      : `${tipo}-${new Date().toISOString().slice(0, 10)}.xlsx`;

    const url = URL.createObjectURL(respuesta.data);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    // Sin esto, el navegador se queda con el archivo en memoria.
    URL.revokeObjectURL(url);

    return nombre;
  },
};

export const dashboardApi = {
  gerencia: (params = {}) => api.get('/dashboard/gerencia', { params }).then((r) => r.data),
};

export const catalogosApi = {
  sucursales: () => api.get('/catalogos/sucursales').then((r) => r.data),
  clientes:   (q = '') => api.get('/catalogos/clientes', { params: { q } }).then((r) => r.data),
};
