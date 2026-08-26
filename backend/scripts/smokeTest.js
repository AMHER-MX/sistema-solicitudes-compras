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
import { cerrarPool, query } from '../src/config/db.js';
// El vencimiento se prueba llamando al vigía a mano: esperar 30 días no es
// una opción, y adelantar el reloj del sistema tampoco.
import { vencerCotizacionesCaducadas } from '../src/services/solicitudes.service.js';

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

  console.log('\n== Alta: todo nace como Cotización ==');

  // Se piden artículos reales. A propósito NO se manda existencia_real_almacen
  // en la primera partida: así se comprueba que el backend la selle
  // consultando al ERP por su cuenta.
  const articuloPedido = conStock;
  const segundo = articulos.find((a) => a.sku !== articuloPedido.sku
    && Number(a.existencia) > 0) ?? articuloPedido;

  const creada = await api('/solicitudes', {
    metodo: 'POST',
    token: tokenVendedor,
    body: {
      id_cliente: 1,
      prioridad: 'Urgente',
      observaciones: 'Prueba automatizada de humo.',
      items: [
        { sku_producto: articuloPedido.sku, descripcion: articuloPedido.descripcion,
          cantidad_solicitada: 1, precio_estimado: articuloPedido.precio_lista ?? null },
        { sku_producto: segundo.sku, descripcion: segundo.descripcion,
          cantidad_solicitada: 1, precio_estimado: segundo.precio_lista ?? null,
          existencia_real_almacen: segundo.existencia },
      ],
    },
  });
  check('POST /solicitudes -> 201', creada.status === 201);
  const sol = creada.data?.solicitud;
  check('Se generó folio', /^SC-\d{4}-\d{6}$/.test(sol?.folio || ''), sol?.folio);
  check('Nace como Cotización', sol?.tipo === 'Cotizacion', `(${sol?.tipo})`);
  // Todo lo pedido hay en existencia, así que no tiene que pasar por Compras.
  check('Sin faltantes nace en Borrador', sol?.estatus_actual === 'Borrador',
    `(${sol?.estatus_actual})`);
  check('Guardó 2 partidas', sol?.detalle?.length === 2);
  check('Guardó el precio cotizado junto al estimado',
    sol?.detalle?.every((d) => d.precio_cotizado !== null));

  // La primera partida NO traía existencia: la selló el backend desde el ERP.
  check('Selló la existencia que reporta el ERP',
    Number(sol?.detalle?.[0]?.existencia_real_almacen) === Number(articuloPedido.existencia),
    `(${articuloPedido.sku}: esperada ${articuloPedido.existencia}, guardada ${sol?.detalle?.[0]?.existencia_real_almacen})`);

  const sinItems = await api('/solicitudes', { metodo: 'POST', token: tokenVendedor, body: { items: [] } });
  check('Solicitud sin partidas -> 400', sinItems.status === 400);

  // Una cotización con un faltante SÍ tiene que pasar por Compras antes de
  // poderse mandar: alguien tiene que conseguir precio y tiempo de entrega.
  const conFaltante = await api('/solicitudes', {
    metodo: 'POST', token: tokenVendedor,
    body: {
      id_cliente: 1,
      items: [{
        sku_producto: articuloPedido.sku,
        descripcion: articuloPedido.descripcion,
        // Más piezas de las que hay: eso es un faltante.
        cantidad_solicitada: Number(articuloPedido.existencia) + 500,
        precio_estimado: articuloPedido.precio_lista ?? null,
      }],
    },
  });
  check('Con faltantes se va a Compras',
    conFaltante.data?.solicitud?.estatus_actual === 'Con Compras',
    `(${conFaltante.data?.solicitud?.estatus_actual})`);

  console.log('\n== Consulta y filtros ==');
  const mias = await api('/solicitudes', { token: tokenVendedor });
  check('Vendedor lista solo sus solicitudes',
    mias.data?.solicitudes?.every((s) => s.vendedor_nombre === 'Ana Ríos'));

  const soloCotizaciones = await api('/solicitudes?tipo=Cotizacion', { token: tokenComprador });
  check('Filtro por tipo=Cotizacion',
    soloCotizaciones.data?.solicitudes?.length > 0
    && soloCotizaciones.data.solicitudes.every((s) => s.tipo === 'Cotizacion'));

  const soloPedidos = await api('/solicitudes?tipo=Pedido', { token: tokenComprador });
  check('Filtro por tipo=Pedido',
    soloPedidos.data?.solicitudes?.every((s) => s.tipo === 'Pedido'));

  const tipoInvalido = await api('/solicitudes?tipo=Factura', { token: tokenComprador });
  check('Tipo inventado -> 400', tipoInvalido.status === 400);

  const detalle = await api(`/solicitudes/${sol.id}`, { token: tokenComprador });
  check('Detalle trae historial inicial', detalle.data?.solicitud?.historial?.length === 1);
  check('Detalle dice que ya se puede enviar', detalle.data?.acciones?.puede_enviar === true);
  check('Detalle dice que todavía NO se puede convertir',
    detalle.data?.acciones?.puede_convertir === false);

  console.log('\n== Enviar al cliente: congela precio y arranca el reloj ==');

  const antesDeEnviar = await api(`/solicitudes/${sol.id}/convertir`, {
    metodo: 'POST', token: tokenVendedor,
  });
  check('No se puede convertir lo que el cliente no ha visto -> 409',
    antesDeEnviar.status === 409, `(${antesDeEnviar.status})`);

  // confirmar:true porque entre el alta y este momento el precio de Quiter
  // pudo moverse, y el servidor —bien— se niega a mandar un precio viejo sin
  // que alguien lo vea. Ese candado se prueba aparte, más abajo.
  const enviada = await api(`/solicitudes/${sol.id}/enviar`, {
    metodo: 'POST', token: tokenVendedor, body: { dias_vigencia: 30, confirmar: true },
  });
  check('POST /enviar -> 200', enviada.status === 200,
    enviada.status === 200 ? '' : `(${enviada.status} ${enviada.data?.error ?? ''})`);
  check('Queda Enviada', enviada.data?.cotizacion?.estatus_actual === 'Enviada');
  check('Selló la fecha de envío', Boolean(enviada.data?.cotizacion?.enviada_en));
  check('Selló la fecha de vencimiento', Boolean(enviada.data?.cotizacion?.vence_en));

  const vence = new Date(enviada.data.cotizacion.vence_en);
  const enviadoEn = new Date(enviada.data.cotizacion.enviada_en);
  const diasReales = Math.round((vence - enviadoEn) / 86400000);
  check('Vence exactamente 30 días después de enviarse', diasReales === 30, `(${diasReales} días)`);

  const dosVeces = await api(`/solicitudes/${sol.id}/enviar`, {
    metodo: 'POST', token: tokenVendedor, body: { confirmar: true },
  });
  check('No se puede enviar dos veces -> 409', dosVeces.status === 409);

  const conDetalle = await api(`/solicitudes/${sol.id}`, { token: tokenVendedor });
  check('Ahora sí se puede convertir', conDetalle.data?.acciones?.puede_convertir === true);
  check('Y ya no se puede volver a enviar', conDetalle.data?.acciones?.puede_enviar === false);

  console.log('\n== Convertir en Pedido: el folio NO cambia ==');

  const folioAntes = sol.folio;
  // Lo cierra el Comprador, no el vendedor: se acordó que Compras también
  // puede, porque a veces el cliente les habla directo.
  const pedido = await api(`/solicitudes/${sol.id}/convertir`, {
    metodo: 'POST', token: tokenComprador,
    body: { comentario: 'Cliente confirmó por teléfono.' },
  });
  check('POST /convertir -> 200', pedido.status === 200,
    pedido.status === 200 ? '' : `(${pedido.status} ${pedido.data?.error ?? ''})`);
  check('Ahora es Pedido', pedido.data?.pedido?.tipo === 'Pedido');
  check('EL FOLIO ES EL MISMO', pedido.data?.pedido?.folio === folioAntes,
    `(${folioAntes} -> ${pedido.data?.pedido?.folio})`);
  check('Es el mismo documento, no una copia', pedido.data?.pedido?.id === sol.id);
  check('Entra a la mesa de Compras como Pendiente',
    pedido.data?.pedido?.estatus_actual === 'Pendiente');
  check('Guardó cuándo lo aprobó el cliente', Boolean(pedido.data?.pedido?.convertida_en));

  const yaConvertida = await api(`/solicitudes/${sol.id}/convertir`, {
    metodo: 'POST', token: tokenComprador,
  });
  check('No se puede convertir dos veces -> 409', yaConvertida.status === 409);

  console.log('\n== El precio prometido sobrevive a la conversión ==');

  const trasConvertir = await api(`/solicitudes/${sol.id}`, { token: tokenComprador });
  const partidasPedido = trasConvertir.data?.solicitud?.detalle ?? [];
  check('Las partidas conservan su precio cotizado',
    partidasPedido.length === 2 && partidasPedido.every((d) => d.precio_cotizado !== null));

  const refresco = await api(`/solicitudes/${sol.id}/precios`, {
    metodo: 'POST', token: tokenComprador,
  });
  check('POST /precios -> 200', refresco.status === 200);
  check('Reconoce que el precio ya está comprometido', refresco.data?.congelado === true);

  const trasRefresco = await api(`/solicitudes/${sol.id}`, { token: tokenComprador });
  const preciosIguales = (trasRefresco.data?.solicitud?.detalle ?? []).every((d, i) =>
    String(d.precio_cotizado) === String(partidasPedido[i].precio_cotizado));
  check('Refrescar NO tocó el precio que se le prometió al cliente', preciosIguales);

  console.log('\n== Cambio de estatus del Pedido ==');
  const porVendedor = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenVendedor, body: { estatus: 'Con Proveedor' },
  });
  check('Vendedor NO mueve el flujo de un Pedido -> 403', porVendedor.status === 403,
    `(${porVendedor.status})`);

  const salto = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador, body: { estatus: 'Recibido' },
  });
  check('Transición inválida (Pendiente -> Recibido) -> 409', salto.status === 409);

  const mezcla = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador, body: { estatus: 'Enviada' },
  });
  check('Un Pedido no puede tomar un estatus de Cotización -> 409', mezcla.status === 409,
    `(${mezcla.status})`);

  const cot = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { estatus: 'Con Proveedor', comentario: 'Pidiendo precio a 3 proveedores.' },
  });
  check('Pendiente -> Con Proveedor OK',
    cot.status === 200 && cot.data?.solicitud?.estatus_actual === 'Con Proveedor');

  const sinFecha = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador, body: { estatus: 'En Transito' },
  });
  check('En Transito sin fecha promesa -> 400', sinFecha.status === 400);

  const transito = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { estatus: 'En Transito', comentario: 'OC-4410 colocada.', fecha_promesa_entrega: '2026-09-15' },
  });
  check('Con Proveedor -> En Transito OK', transito.data?.solicitud?.estatus_actual === 'En Transito');
  check('Guardó fecha promesa', Boolean(transito.data?.solicitud?.fecha_promesa_entrega));
  check('Asignó comprador', transito.data?.solicitud?.id_comprador_asignado === 3);

  const recibido = await api(`/solicitudes/${sol.id}/estatus`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { estatus: 'Recibido', comentario: 'Material en almacén.' },
  });
  check('En Transito -> Recibido OK', recibido.data?.solicitud?.estatus_actual === 'Recibido');
  check('Selló fecha de cierre', Boolean(recibido.data?.solicitud?.fecha_cierre));

  const final = await api(`/solicitudes/${sol.id}`, { token: tokenComprador });
  check('Un solo hilo de bitácora, de cotización a recibido',
    final.data?.solicitud?.historial?.length === 6,
    `(${final.data?.solicitud?.historial?.length} movimientos)`);

  console.log('\n== El candado del precio viejo ==');

  // Se arma una cotización y se le ensucia el precio a mano, como si Quiter lo
  // hubiera movido entre que el vendedor la capturó y el momento de mandarla.
  // El sistema NO debe dejar que se vaya al cliente sin que alguien lo vea.
  const conPrecioViejo = await api('/solicitudes', {
    metodo: 'POST', token: tokenVendedor,
    body: {
      id_cliente: 1,
      items: [{ sku_producto: articuloPedido.sku, descripcion: articuloPedido.descripcion,
        cantidad_solicitada: 1, precio_estimado: articuloPedido.precio_lista ?? null,
        existencia_real_almacen: articuloPedido.existencia }],
    },
  });
  const idViejo = conPrecioViejo.data?.solicitud?.id;

  await query(
    `UPDATE solicitudes_detalle
        SET precio_cotizado = 1, precio_estimado = 1, precio_lista_actual = 1
      WHERE id_solicitud = @id`,
    { id: idViejo },
  );

  const frenada = await api(`/solicitudes/${idViejo}/enviar`, {
    metodo: 'POST', token: tokenVendedor,
  });
  check('Si el precio cambió, no la manda -> 409', frenada.status === 409,
    `(${frenada.status})`);
  check('Y dice exactamente qué partida cambió',
    Array.isArray(frenada.data?.detalles) && frenada.data.detalles.length > 0
      && frenada.data.detalles[0].sku_producto === articuloPedido.sku,
    frenada.data?.detalles?.[0]
      ? `(${frenada.data.detalles[0].precio_cotizado} -> ${frenada.data.detalles[0].precio_actual})`
      : '');

  const confirmada = await api(`/solicitudes/${idViejo}/enviar`, {
    metodo: 'POST', token: tokenVendedor, body: { confirmar: true },
  });
  check('Confirmando sí la manda', confirmada.status === 200);

  const yaEnviada = await api(`/solicitudes/${idViejo}`, { token: tokenVendedor });
  const partidaFinal = yaEnviada.data?.solicitud?.detalle?.[0];
  check('Congeló el precio NUEVO, no el viejo de un peso',
    Number(partidaFinal?.precio_cotizado) > 1,
    `(quedó en ${partidaFinal?.precio_cotizado})`);

  console.log('\n== Vencimiento automático al mes ==');

  // Se crea una cotización, se envía, y se le empuja la fecha de vencimiento
  // al pasado: es la única forma de comprobar hoy lo que tarda 30 días.
  const paraVencer = await api('/solicitudes', {
    metodo: 'POST', token: tokenVendedor,
    body: {
      id_cliente: 1,
      items: [{ sku_producto: articuloPedido.sku, descripcion: articuloPedido.descripcion,
        cantidad_solicitada: 1, precio_estimado: articuloPedido.precio_lista ?? null,
        existencia_real_almacen: articuloPedido.existencia }],
    },
  });
  const idVencer = paraVencer.data?.solicitud?.id;
  const folioVencer = paraVencer.data?.solicitud?.folio;

  await api(`/solicitudes/${idVencer}/enviar`, {
    metodo: 'POST', token: tokenVendedor, body: { confirmar: true },
  });

  await query(
    "UPDATE solicitudes_compras SET vence_en = NOW() - INTERVAL '1 day' WHERE id = @id",
    { id: idVencer },
  );

  const vencidas = await vencerCotizacionesCaducadas();
  check('El vigía la venció', vencidas.some((v) => v.id === idVencer),
    `(${folioVencer})`);

  const yaVencida = await api(`/solicitudes/${idVencer}`, { token: tokenVendedor });
  check('Quedó en Vencida', yaVencida.data?.solicitud?.estatus_actual === 'Vencida');
  check('Y ya no se puede convertir', yaVencida.data?.acciones?.puede_convertir === false);
  check('La bitácora explica por qué venció',
    yaVencida.data?.solicitud?.historial?.some((h) => /sin respuesta del cliente/i.test(h.comentario || '')));

  // Correr el vigía otra vez no debe volver a vencerla ni duplicar la bitácora.
  const segundaVuelta = await vencerCotizacionesCaducadas();
  check('Correr el vigía dos veces no la vence dos veces',
    !segundaVuelta.some((v) => v.id === idVencer));

  const bitacoraFinal = await api(`/solicitudes/${idVencer}`, { token: tokenVendedor });
  check('La bitácora no se duplicó',
    bitacoraFinal.data?.solicitud?.historial?.length
      === yaVencida.data?.solicitud?.historial?.length);

  const convertirVencida = await api(`/solicitudes/${idVencer}/convertir`, {
    metodo: 'POST', token: tokenVendedor,
  });
  check('Una cotización vencida ya no se convierte -> 409', convertirVencida.status === 409);

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
