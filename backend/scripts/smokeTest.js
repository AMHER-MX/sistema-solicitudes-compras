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
import { pool } from '../src/config/db.js';

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
  const exSinStock = await api('/productos/existencias?sku=BAL-8890', { token: tokenVendedor });
  check('Consulta existencias 200', exSinStock.status === 200);
  check('BAL-8890 sin existencia en SUC01',
    exSinStock.data?.articulos?.[0]?.existencia === 0,
    `(origen: ${exSinStock.data?.origen})`);

  const exConStock = await api('/productos/existencias?sku=ACE-5W30', { token: tokenVendedor });
  check('ACE-5W30 con existencia', exConStock.data?.hay_existencia === true);

  const corto = await api('/productos/existencias?sku=a', { token: tokenVendedor });
  check('Término de 1 caracter -> 400', corto.status === 400);

  console.log('\n== Alta de solicitud ==');
  const creada = await api('/solicitudes', {
    metodo: 'POST',
    token: tokenVendedor,
    body: {
      id_cliente: 1,
      prioridad: 'Urgente',
      observaciones: 'Prueba automatizada de humo.',
      items: [
        { sku_producto: 'BAL-8890', descripcion: 'Balata delantera cerámica 8890', cantidad_solicitada: 3, precio_estimado: 1250 },
        { sku_producto: 'BOM-9080', descripcion: 'Bomba de agua 9080', cantidad_solicitada: 1, precio_estimado: 4275 },
      ],
    },
  });
  check('POST /solicitudes -> 201', creada.status === 201);
  const sol = creada.data?.solicitud;
  check('Se generó folio', /^SC-\d{4}-\d{6}$/.test(sol?.folio || ''), sol?.folio);
  check('Nace en Pendiente', sol?.estatus_actual === 'Pendiente');
  check('Guardó 2 partidas', sol?.detalle?.length === 2);
  check('Selló existencia del ERP en la partida',
    Number(sol?.detalle?.[0]?.existencia_real_almacen) === 0);

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

  console.log('\n== Catálogos ==');
  const suc = await api('/catalogos/sucursales', { token: tokenVendedor });
  check('Lista sucursales', suc.data?.sucursales?.length === 3);
  const cli = await api('/catalogos/clientes?q=norte', { token: tokenVendedor });
  check('Busca clientes por texto', cli.data?.clientes?.length === 1);

  console.log(`\n${fallos === 0 ? 'TODAS LAS PRUEBAS PASARON ✓' : `${fallos} PRUEBA(S) FALLARON ✗`}\n`);
}

main()
  .catch((e) => { console.error('\nError en la prueba:', e); fallos += 1; })
  .finally(async () => {
    servidor.close();
    await pool.end();
    process.exit(fallos === 0 ? 0 : 1);
  });
