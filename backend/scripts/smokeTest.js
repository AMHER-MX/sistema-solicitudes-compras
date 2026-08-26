/**
 * Prueba de humo de la API: recorre el flujo completo sin navegador.
 *
 *   1. Arranca la app en un puerto libre
 *   2. Login como Vendedor -> consulta existencias -> crea solicitud
 *   3. Login como Comprador -> mueve estatus (En Cotizacion -> En Transito -> Recibido)
 *   4. Login como Gerente -> lee el dashboard
 *
 *   cd backend && npm run smoke
 */
import { crearApp } from '../src/app.js';
import { cerrarPool } from '../src/config/db.js';

const app = crearApp();
const servidor = app.listen(0);
const BASE = `http://127.0.0.1:${servidor.address().port}/api`;

let fallos = 0;
const check = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✓' : '  ✗'} ${nombre}${extra ? ` ${extra}` : ''}`);
  if (!condicion) fallos += 1;
};

async function api(ruta, { metodo = 'GET', token, body } = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const login = async (email) => {
  const { data } = await api('/auth/login', {
    metodo: 'POST',
    body: { email, password: 'demo1234' },
  });
  return data?.token;
};

async function main() {
  console.log('\n== Salud ==');
  const salud = await api('/health');
  check('GET /health responde 200', salud.status === 200);
  check('BD conectada', salud.data?.bd?.conectada === true);
  check('Reporta el origen del ERP', Boolean(salud.data?.erp?.origen), `(${salud.data?.erp?.origen})`);

  console.log('\n== Autenticación ==');
  const malo = await api('/auth/login', { metodo: 'POST', body: { email: 'vendedor@demo.mx', password: 'incorrecta' } });
  check('Password incorrecto -> 401', malo.status === 401);

  const sinToken = await api('/solicitudes');
  check('Sin token -> 401', sinToken.status === 401);

  const tokenVendedor  = await login('vendedor@demo.mx');
  const tokenComprador = await login('comprador@demo.mx');
  const tokenGerente   = await login('gerente@demo.mx');
  check('Login vendedor devuelve token', Boolean(tokenVendedor));
  check('Login comprador devuelve token', Boolean(tokenComprador));
  check('Login gerente devuelve token', Boolean(tokenGerente));

  console.log('\n== Existencias (ERP) ==');

  // La prueba NO usa números de parte fijos: los toma de lo que responda el
  // ERP configurado. Así vale igual contra el catálogo simulado, contra la
  // API de refacciones o contra el SQL Server de Quiter — y no se rompe
  // porque un artículo inventado no exista en el inventario real.
  const busqueda = await api('/productos/existencias?sku=filtro', { token: tokenVendedor });
  check('Consulta existencias 200', busqueda.status === 200);

  const articulos = busqueda.data?.articulos ?? [];
  const origen = busqueda.data?.origen;
  check('Devuelve artículos', articulos.length > 0, `(origen: ${origen}, ${articulos.length} artículos)`);

  check('Cada artículo trae lo que la interfaz necesita',
    articulos.every((a) => typeof a.sku === 'string' && a.sku.length > 0
      && typeof a.descripcion === 'string'
      && Number.isFinite(Number(a.existencia))
      && Array.isArray(a.existencia_otras_sucursales)));

  check('hay_existencia concuerda con los artículos devueltos',
    busqueda.data?.hay_existencia === articulos.some((a) => Number(a.existencia) > 0));

  check('Ninguna existencia es negativa',
    articulos.every((a) => Number(a.existencia) >= 0));

  const corto = await api('/productos/existencias?sku=a', { token: tokenVendedor });
  check('Término de 1 caracter -> 400', corto.status === 400);

  // Todo lo que sigue necesita al menos un artículo real. Sin eso, más vale
  // detenerse con un mensaje claro que arrastrar errores incomprensibles.
  if (articulos.length === 0) {
    console.log('\n  El ERP no devolvió ningún artículo para "filtro".');
    console.log('  Revisa la configuración del origen de datos en el .env y vuelve a intentar.\n');
    throw new Error('Sin artículos del ERP: no se puede continuar con la prueba');
  }

  // Se eligen artículos reales para el resto de la prueba.
  const conStock  = articulos.find((a) => Number(a.existencia) > 0);
  const sinStock  = articulos.find((a) => Number(a.existencia) === 0);
  // Para el aviso informativo se prefiere el caso que le importa a Compras:
  // sin existencia aquí, pero disponible en otra sucursal.
  const paraTraspaso = articulos.find(
    (a) => Number(a.existencia) === 0 && a.existencia_otras_sucursales.length > 0);
  const enOtra = paraTraspaso ?? articulos.find((a) => a.existencia_otras_sucursales.length > 0);

  check('Encuentra al menos un artículo con existencia', Boolean(conStock),
    conStock ? `(${conStock.sku}: ${conStock.existencia} pzas)` : '');

  if (sinStock) {
    check('Un artículo sin existencia se reporta en cero', Number(sinStock.existencia) === 0,
      `(${sinStock.sku})`);
  } else {
    console.log('  · Sin artículos en cero entre los resultados; se omite esa comprobación');
  }

  if (enOtra) {
    const otras = enOtra.existencia_otras_sucursales
      .map((o) => `${o.nombre ?? o.almacen} (${o.existencia})`).join(', ');
    console.log(Number(enOtra.existencia) === 0
      ? `  · ${enOtra.sku}: 0 aquí, pero hay en ${otras} -> traspaso en vez de compra`
      : `  · ${enOtra.sku}: ${enOtra.existencia} aquí, y además en ${otras}`);
  }

  console.log('\n== Alta de solicitud ==');

  // Se pide un artículo real. A propósito NO se manda existencia_real_almacen:
  // así se comprueba que el backend la selle consultando al ERP por su cuenta.
  const articuloPedido = sinStock ?? articulos[0];
  const segundo = articulos.find((a) => a.sku !== articuloPedido.sku) ?? articuloPedido;

  const creada = await api('/solicitudes', {
    metodo: 'POST',
    token: tokenVendedor,
    body: {
      id_cliente: 1,
      prioridad: 'Urgente',
      observaciones: 'Prueba automatizada de humo.',
      items: [
        { sku_producto: articuloPedido.sku, descripcion: articuloPedido.descripcion,
          cantidad_solicitada: 3, precio_estimado: articuloPedido.precio_lista ?? null },
        { sku_producto: segundo.sku, descripcion: segundo.descripcion,
          cantidad_solicitada: 1, precio_estimado: segundo.precio_lista ?? null,
          existencia_real_almacen: segundo.existencia },
      ],
    },
  });
  check('POST /solicitudes -> 201', creada.status === 201);
  const sol = creada.data?.solicitud;
  check('Se generó folio', /^SC-\d{4}-\d{6}$/.test(sol?.folio || ''), sol?.folio);
  check('Nace en Pendiente', sol?.estatus_actual === 'Pendiente');
  check('Guardó 2 partidas', sol?.detalle?.length === 2);

  // La primera partida NO traía existencia: la selló el backend desde el ERP.
  check('Selló la existencia que reporta el ERP',
    Number(sol?.detalle?.[0]?.existencia_real_almacen) === Number(articuloPedido.existencia),
    `(${articuloPedido.sku}: esperada ${articuloPedido.existencia}, guardada ${sol?.detalle?.[0]?.existencia_real_almacen})`);

  const sinItems = await api('/solicitudes', { metodo: 'POST', token: tokenVendedor, body: { items: [] } });
  check('Solicitud sin partidas -> 400', sinItems.status === 400);

  console.log('\n== Consulta y filtros ==');
  const mias = await api('/solicitudes', { token: tokenVendedor });
  check('Vendedor lista solo sus solicitudes',
    mias.data?.solicitudes?.every((s) => s.vendedor_nombre === 'Ana Ríos'));

  const urgentes = await api('/solicitudes?prioridad=Urgente&estatus=Pendiente', { token: tokenComprador });
  check('Filtro prioridad+estatus funciona',
    urgentes.data?.solicitudes?.every((s) => s.prioridad === 'Urgente' && s.estatus_actual === 'Pendiente'));

  const detalle = await api(`/solicitudes/${sol.id}`, { token: tokenComprador });
  check('Detalle trae historial inicial', detalle.data?.solicitud?.historial?.length === 1);
  check('Detalle sugiere siguientes estatus',
    Array.isArray(detalle.data?.estatus_disponibles) && detalle.data.estatus_disponibles.length > 0);

  console.log('\n== Cambio de estatus ==');
  const porVendedor = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenVendedor, body: { estatus: 'En Cotizacion' },
  });
  check('Vendedor NO puede mover estatus -> 403', porVendedor.status === 403);

  const salto = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador, body: { estatus: 'Recibido' },
  });
  check('Transición inválida (Pendiente -> Recibido) -> 409', salto.status === 409);

  const cot = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { estatus: 'En Cotizacion', comentario: 'Pidiendo precio a 3 proveedores.' },
  });
  check('Pendiente -> En Cotizacion OK', cot.status === 200 && cot.data?.solicitud?.estatus_actual === 'En Cotizacion');

  const sinFecha = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador, body: { estatus: 'En Transito' },
  });
  check('En Transito sin fecha promesa -> 400', sinFecha.status === 400);

  const transito = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { estatus: 'En Transito', comentario: 'OC-4410 colocada.', fecha_promesa_entrega: '2026-09-15' },
  });
  check('En Cotizacion -> En Transito OK', transito.data?.solicitud?.estatus_actual === 'En Transito');
  check('Guardó fecha promesa', Boolean(transito.data?.solicitud?.fecha_promesa_entrega));
  check('Asignó comprador', transito.data?.solicitud?.id_comprador_asignado === 3);

  const recibido = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { estatus: 'Recibido', comentario: 'Material en almacén.' },
  });
  check('En Transito -> Recibido OK', recibido.data?.solicitud?.estatus_actual === 'Recibido');
  check('Selló fecha de cierre', Boolean(recibido.data?.solicitud?.fecha_cierre));

  const final = await api(`/solicitudes/${sol.id}`, { token: tokenComprador });
  check('Historial acumuló 4 movimientos', final.data?.solicitud?.historial?.length === 4,
    `(${final.data?.solicitud?.historial?.length})`);

  console.log('\n== Dashboard gerencial ==');
  const negado = await api('/dashboard/gerencia', { token: tokenVendedor });
  check('Vendedor no accede al dashboard -> 403', negado.status === 403);

  const dash = await api('/dashboard/gerencia?dias=60', { token: tokenGerente });
  check('GET /dashboard/gerencia -> 200', dash.status === 200);
  check('Trae conteo por estatus', Array.isArray(dash.data?.por_estatus) && dash.data.por_estatus.length > 0);
  check('Trae top de faltantes', Array.isArray(dash.data?.top_faltantes) && dash.data.top_faltantes.length > 0);
  check('Calcula tiempo promedio de atención',
    dash.data?.tiempo_atencion?.solicitudes_cerradas > 0,
    `(${dash.data?.tiempo_atencion?.horas_promedio} h)`);
  check('Cuenta urgentes abiertas', typeof dash.data?.totales?.urgentes_abiertas === 'number');

  // Este bloque existe por un error que llegó a producción: la consulta del
  // cambio de contraseña decía `activo = 1` —correcto en SQL Server, veneno en
  // PostgreSQL— y nadie se enteró hasta que la primera persona real intentó
  // entrar y le salió "Error interno del servidor". Es el único camino que solo
  // se recorre una vez por cuenta, así que es justo el que hay que probar solo.
  console.log('\n== Alta de cuenta y primera entrada ==');
  const correoNuevo = `prueba.${Date.now()}@amher.com.mx`;
  const alta = await api('/usuarios', {
    metodo: 'POST',
    token: tokenGerente,
    body: { nombre: 'Cuenta De Prueba', email: correoNuevo, rol: 'Comprador' },
  });
  check('Gerente da de alta una cuenta -> 201', alta.status === 201);
  const passwordTemporal = alta.data?.passwordTemporal;
  check('El alta devuelve una contraseña temporal', typeof passwordTemporal === 'string' && passwordTemporal.length >= 8);

  const primerLogin = await api('/auth/login', {
    metodo: 'POST',
    body: { email: correoNuevo, password: passwordTemporal },
  });
  check('Entra con la contraseña temporal -> 200', primerLogin.status === 200);
  const tokenNuevo = primerLogin.data?.token;

  const bloqueado = await api('/solicitudes', { token: tokenNuevo });
  check('Con contraseña temporal no puede usar el sistema -> 403',
    bloqueado.status === 403 && bloqueado.data?.codigo === 'PASSWORD_TEMPORAL',
    `(${bloqueado.status} ${bloqueado.data?.codigo ?? ''})`);

  const NUEVA = 'ClaveDeCarlos2026';
  const conActualMal = await api('/auth/cambiar-password', {
    metodo: 'POST',
    token: tokenNuevo,
    body: { passwordActual: 'noEsLaQueEs', passwordNueva: NUEVA },
  });
  check('Con la temporal equivocada no deja cambiarla -> 400', conActualMal.status === 400,
    `(${conActualMal.status})`);

  const cambio = await api('/auth/cambiar-password', {
    metodo: 'POST',
    token: tokenNuevo,
    body: { passwordActual: passwordTemporal, passwordNueva: NUEVA },
  });
  check('Cambia su contraseña -> 200', cambio.status === 200,
    cambio.status === 200 ? '' : `(${cambio.status} ${cambio.data?.error ?? ''})`);

  const yaPuede = await api('/solicitudes', { token: tokenNuevo });
  check('Después del cambio ya entra al sistema -> 200', yaPuede.status === 200,
    `(${yaPuede.status})`);

  const conNueva = await api('/auth/login', {
    metodo: 'POST',
    body: { email: correoNuevo, password: NUEVA },
  });
  check('Vuelve a entrar con la contraseña nueva -> 200', conNueva.status === 200);

  const conVieja = await api('/auth/login', {
    metodo: 'POST',
    body: { email: correoNuevo, password: passwordTemporal },
  });
  check('La temporal ya no sirve -> 401', conVieja.status === 401);

  // Se desactiva para no dejar basura si alguien corre esto contra una base real.
  const baja = await api(`/usuarios/${alta.data?.usuario?.id}`, {
    metodo: 'PATCH', token: tokenGerente, body: { activo: false },
  });
  check('Se puede desactivar la cuenta de prueba', baja.status === 200);

  console.log('\n== Catálogos ==');
  const suc = await api('/catalogos/sucursales', { token: tokenVendedor });
  check('Lista las 7 sucursales de Quiter', suc.data?.sucursales?.length === 7);
  const cli = await api('/catalogos/clientes?q=norte', { token: tokenVendedor });
  check('Busca clientes por texto', cli.data?.clientes?.length === 1);

  console.log(`\n${fallos === 0 ? 'TODAS LAS PRUEBAS PASARON ✓' : `${fallos} PRUEBA(S) FALLARON ✗`}\n`);
}

main()
  .catch((e) => { console.error('\nError en la prueba:', e); fallos += 1; })
  .finally(async () => {
    servidor.close();
    await cerrarPool();
    process.exit(fallos === 0 ? 0 : 1);
  });
