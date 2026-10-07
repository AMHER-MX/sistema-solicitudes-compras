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
import bcrypt from 'bcryptjs';
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
  //
  // La cotización base es MIXTA —una partida en piso y una que falta— porque
  // ése es el documento que de verdad levanta un vendedor: el cliente pidió
  // cinco cosas, tres hay y dos no, y el papel tiene que traerlas todas. Un
  // documento donde todo está en piso ya no se acepta (se prueba más abajo).
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
        // El faltante, que es la razón de ser del documento. Se usa un
        // artículo REAL del catálogo —uno en cero, o pidiendo más de lo que
        // hay— y no una partida capturada a mano: así trae precio de lista, y
        // el resto de la prueba puede seguir ejercitando el envío al cliente,
        // que exige que ninguna partida vaya sin precio.
        sinStock
          ? { sku_producto: sinStock.sku, descripcion: sinStock.descripcion,
              cantidad_solicitada: 2, precio_estimado: sinStock.precio_lista ?? null,
              existencia_real_almacen: 0 }
          : { sku_producto: articuloPedido.sku, descripcion: articuloPedido.descripcion,
              cantidad_solicitada: Number(articuloPedido.existencia) + 10,
              precio_estimado: articuloPedido.precio_lista ?? null,
              existencia_real_almacen: articuloPedido.existencia },
      ],
    },
  });
  check('POST /solicitudes -> 201', creada.status === 201);
  const sol = creada.data?.solicitud;
  // El folio ahora dice la empresa: SC-CATOSA-2026-000001.
  check('Se generó folio con la empresa dentro',
    /^SC-(CATOSA|CADUSA)-\d{4}-\d{6}$/.test(sol?.folio || ''), sol?.folio);
  check('Nace como Cotización', sol?.tipo === 'Cotizacion', `(${sol?.tipo})`);
  // Con un faltante, nace en manos de Compras: alguien tiene que conseguirlo.
  check('Con faltante nace con Compras', sol?.estatus_actual === 'Con Compras',
    `(${sol?.estatus_actual})`);
  check('Guardó las 3 partidas, incluidas las que sí hay', sol?.detalle?.length === 3);
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
  // Se consulta con el token del VENDEDOR: enviarla al cliente es cosa de quien
  // lo atiende, no de Compras, y el detalle tiene que decir lo mismo que va a
  // hacer el servidor cuando le den al botón.
  const detalleV = await api(`/solicitudes/${sol.id}`, { token: tokenVendedor });
  check('Detalle dice que ya se puede enviar', detalleV.data?.acciones?.puede_enviar === true);
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
    partidasPedido.length === 3 && partidasPedido.every((d) => d.precio_cotizado !== null),
    `(${partidasPedido.length} partidas)`);

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
      // Se piden más piezas de las que hay: así es un faltante y el documento
      // se acepta. Una cotización donde todo está en piso ya no se crea.
      items: [{ sku_producto: articuloPedido.sku, descripcion: articuloPedido.descripcion,
        cantidad_solicitada: Number(articuloPedido.existencia) + 3,
        precio_estimado: articuloPedido.precio_lista ?? null,
        existencia_real_almacen: articuloPedido.existencia }],
    },
  });
  check('Se pudo crear la cotización de la prueba del candado',
    conPrecioViejo.status === 201,
    `(${conPrecioViejo.status} ${conPrecioViejo.data?.error ?? ''})`);
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
      // Igual que arriba: pidiendo más de lo que hay, para que sea un faltante
      // y el documento exista.
      items: [{ sku_producto: articuloPedido.sku, descripcion: articuloPedido.descripcion,
        cantidad_solicitada: Number(articuloPedido.existencia) + 3,
        precio_estimado: articuloPedido.precio_lista ?? null,
        existencia_real_almacen: articuloPedido.existencia }],
    },
  });
  check('Se pudo crear la cotización que se va a vencer', paraVencer.status === 201,
    `(${paraVencer.status} ${paraVencer.data?.error ?? ''})`);
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
  // Sin empresa, la cuenta nace inservible: el servidor la rechaza en cada
  // petición. Se comprueba aquí porque se hereda en silencio de quien la crea.
  check('La cuenta nueva hereda la empresa de quien la creó',
    Boolean(alta.data?.usuario?.id_empresa) && alta.data?.usuario?.empresa_clave === 'CATOSA',
    `(${alta.data?.usuario?.empresa_clave})`);

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


  // Los cinco cambios que pidieron los compradores. Cada bloque prueba la
  // regla que cuesta dinero si se rompe, no que el endpoint responda 200.

  // El sistema existe para lo que NO hay. Una cotización donde todo está en
  // piso haría que el vendedor capture dos veces —aquí y en Quiter— y es la
  // forma más segura de que abandone la herramienta. Se rechaza de raíz.
  console.log('\n== Una cotización sin faltantes no existe ==');

  const todoEnPiso = await api('/solicitudes', {
    metodo: 'POST', token: tokenVendedor,
    body: {
      id_sucursal: 1, prioridad: 'Normal', almacen_erp: '101',
      items: [
        { sku_producto: conStock.sku, descripcion: conStock.descripcion,
          cantidad_solicitada: 1, existencia_real_almacen: conStock.existencia,
          precio_estimado: conStock.precio_lista },
      ],
    },
  });
  check('Todo en piso -> 400, no se crea', todoEnPiso.status === 400, `(${todoEnPiso.status})`);
  check('Y le dice a la persona dónde va esa venta',
    /Quiter/i.test(todoEnPiso.data?.error ?? ''), `(${todoEnPiso.data?.error})`);

  // Pedir MÁS de lo que hay sí es un faltante, aunque el artículo exista.
  const pideDeMas = await api('/solicitudes', {
    metodo: 'POST', token: tokenVendedor,
    body: {
      id_sucursal: 1, prioridad: 'Normal', almacen_erp: '101',
      items: [
        { sku_producto: conStock.sku, descripcion: conStock.descripcion,
          cantidad_solicitada: Number(conStock.existencia) + 5,
          existencia_real_almacen: conStock.existencia,
          precio_estimado: conStock.precio_lista },
      ],
    },
  });
  check('Pedir más de lo que hay SÍ es faltante -> 201', pideDeMas.status === 201,
    `(${pideDeMas.status} ${pideDeMas.data?.error ?? ''})`);

  // El documento mixto es el caso normal y tiene que seguir funcionando: el
  // cliente necesita ver el total completo, no solo lo que falta.
  const mixta = await api('/solicitudes', {
    metodo: 'POST', token: tokenVendedor,
    body: {
      id_sucursal: 1, prioridad: 'Normal', almacen_erp: '101',
      items: [
        { sku_producto: conStock.sku, descripcion: conStock.descripcion,
          cantidad_solicitada: 1, existencia_real_almacen: conStock.existencia,
          precio_estimado: conStock.precio_lista },
        { sku_producto: 'PIEZA-QUE-NO-EXISTE-1', descripcion: 'Turbo reconstruido',
          cantidad_solicitada: 1, origen: 'LIBRE' },
      ],
    },
  });
  check('Mixta (en piso + faltante) -> 201', mixta.status === 201,
    `(${mixta.status} ${mixta.data?.error ?? ''})`);
  check('La partida en piso se conserva en el documento',
    mixta.data?.solicitud?.detalle?.length === 2);
  check('Y nace con Compras, por el faltante',
    mixta.data?.solicitud?.estatus_actual === 'Con Compras',
    `(${mixta.data?.solicitud?.estatus_actual})`);

  console.log('\n== Partida que Quiter no conoce ==');

  // El artículo real se toma del ERP, no se escribe a mano: su precio de lista
  // tiene centavos, y una prueba que lo redondee falla contra el propio guardián
  // de precios del sistema —que hace bien su trabajo— y hace perder media hora
  // buscando un error que no existe.
  const REAL = conStock;
  const PRECIO_REAL = Number(REAL.precio_lista);
  // Lo que el comprador consigue, distinto del de lista a propósito: si fueran
  // iguales, una prueba de "no me lo pises" no probaría nada.
  const NEGOCIADO = Math.round((PRECIO_REAL * 0.82) * 100) / 100;

  const libre = await api('/solicitudes', {
    metodo: 'POST', token: tokenVendedor,
    body: {
      id_sucursal: 1, prioridad: 'Normal', almacen_erp: '101',
      items: [
        // Ésta sí existe y hay de sobra: por sí sola no mandaría nada a Compras.
        { sku_producto: REAL.sku, descripcion: REAL.descripcion, cantidad_solicitada: 1,
          precio_estimado: PRECIO_REAL, existencia_real_almacen: REAL.existencia },
        // Ésta el cliente la pidió y el inventario no la conoce.
        { sku_producto: 'XYZ-NO-EXISTE-9', descripcion: 'Bomba hidráulica Cummins',
          cantidad_solicitada: 2, origen: 'LIBRE' },
      ],
    },
  });
  check('Se puede levantar con un número de parte inexistente', libre.status === 201,
    `(${libre.status} ${libre.data?.error ?? ''})`);

  const idLibre = libre.data?.solicitud?.id;
  const detLibre = await api(`/solicitudes/${idLibre}`, { token: tokenVendedor });
  const partidaLibre = detLibre.data?.solicitud?.detalle?.find((d) => d.origen === 'LIBRE');

  check('La partida queda marcada como capturada a mano', Boolean(partidaLibre));
  check('Sin existencia inventada', Number(partidaLibre?.existencia_real_almacen) === 0);
  check('Sin precio inventado', partidaLibre?.precio_estimado === null);
  // Ésta es la regla que importa: aunque todo lo demás esté en existencia, una
  // parte que nadie conoce tiene que ir a Compras antes de prometerle algo al cliente.
  check('Manda la cotización a Compras aunque lo demás sí haya',
    detLibre.data?.solicitud?.estatus_actual === 'Con Compras',
    `(${detLibre.data?.solicitud?.estatus_actual})`);
  check('Y aparece en la mesa de Compras como recién llegada',
    detLibre.data?.solicitud?.estatus_compras === 'En Cotizacion',
    `(${detLibre.data?.solicitud?.estatus_compras})`);

  console.log('\n== Estatus del trabajo de Compras ==');

  const parcial = await api(`/solicitudes/${idLibre}/compras`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { estatus_compras: 'Cotizacion Parcial', comentario: 'Falta que conteste el proveedor' },
  });
  check('El comprador marca Cotización Parcial', parcial.status === 200,
    `(${parcial.status} ${parcial.data?.error ?? ''})`);
  check('El documento NO se movió de Con Compras',
    parcial.data?.solicitud?.estatus_actual === 'Con Compras',
    `(${parcial.data?.solicitud?.estatus_actual})`);
  check('Queda en la bitácora aunque el estatus del documento no cambió',
    parcial.data?.solicitud?.historial?.some((h) => /Compras:/.test(h.comentario ?? '')));

  const inventado = await api(`/solicitudes/${idLibre}/compras`, {
    metodo: 'PATCH', token: tokenComprador, body: { estatus_compras: 'Lo que sea' },
  });
  check('Un estatus inventado se rechaza', inventado.status === 400);

  const vendedorNoPuede = await api(`/solicitudes/${idLibre}/compras`, {
    metodo: 'PATCH', token: tokenVendedor, body: { estatus_compras: 'Completada' },
  });
  check('El vendedor no mueve el estatus de Compras -> 403', vendedorNoPuede.status === 403,
    `(${vendedorNoPuede.status})`);

  // Un botón que el servidor va a rechazar es peor que no tener el botón: la
  // persona hace clic, ve un error rojo y aprende a desconfiar de la pantalla.
  const vistaComprador = await api(`/solicitudes/${idLibre}`, { token: tokenComprador });
  const vistaVendedor  = await api(`/solicitudes/${idLibre}`, { token: tokenVendedor });
  check('Al comprador NO se le ofrece "Enviar al cliente"',
    vistaComprador.data?.acciones?.puede_enviar === false);
  check('Al vendedor dueño SÍ se le ofrece',
    vistaVendedor.data?.acciones?.puede_enviar === true);

  console.log('\n== El comprador pone el precio ==');

  const conPrecios = await api(`/solicitudes/${idLibre}`, {
    metodo: 'PATCH', token: tokenComprador,
    body: {
      items: [
        // Una parte que Quiter SÍ tiene, pero que el comprador consiguió más
        // barata por otro lado. Éste es el caso delicado: existe en el catálogo,
        // así que el refresco de precios pasa por encima de ella cada hora.
        { sku_producto: REAL.sku, descripcion: REAL.descripcion, cantidad_solicitada: 1,
          existencia_real_almacen: REAL.existencia, precio_estimado: PRECIO_REAL,
          precio_cotizado: NEGOCIADO, precio_origen: 'COMPRADOR',
          nota_compras: 'Mejor precio con proveedor local' },
        { sku_producto: 'XYZ-NO-EXISTE-9', descripcion: 'Bomba hidráulica Cummins',
          cantidad_solicitada: 2, origen: 'LIBRE',
          precio_cotizado: 4500, precio_origen: 'COMPRADOR',
          nota_compras: 'Con Distribuidora del Bajío, 3 días' },
      ],
      comentario: 'Ya conseguí la bomba.',
    },
  });
  check('El comprador captura precios', conPrecios.status === 200,
    `(${conPrecios.status} ${conPrecios.data?.error ?? ''})`);

  const totales = conPrecios.data?.solicitud?.totales;
  const esperado = Math.round((NEGOCIADO * 1 + 4500 * 2) * 100) / 100;
  check('Suma el total de todas las piezas', Number(totales?.importe) === esperado,
    `(${totales?.importe}, esperado ${esperado})`);
  check('Cuenta las piezas, no las partidas', Number(totales?.piezas) === 3, `(${totales?.piezas})`);
  check('Sabe que ya no falta ningún precio', totales?.completo === true);

  const bomba = conPrecios.data?.solicitud?.detalle?.find((d) => d.origen === 'LIBRE');
  check('Marca que el precio lo puso el comprador', bomba?.precio_origen === 'COMPRADOR');
  check('Guarda con quién la consiguió', /Bajío/.test(bomba?.nota_compras ?? ''));

  const negociada = conPrecios.data?.solicitud?.detalle
    ?.find((d) => d.sku_producto === REAL.sku);
  check('Respeta el precio negociado de una parte que sí está en Quiter',
    Number(negociada?.precio_cotizado) === NEGOCIADO,
    `(${negociada?.precio_cotizado}, lista ${PRECIO_REAL})`);

  const intentoVendedor = await api(`/solicitudes/${idLibre}`, {
    metodo: 'PATCH', token: tokenVendedor,
    body: {
      items: [{ sku_producto: 'XYZ-NO-EXISTE-9', descripcion: 'Bomba', cantidad_solicitada: 2,
                origen: 'LIBRE', precio_cotizado: 100, precio_origen: 'COMPRADOR' }],
    },
  });
  check('El vendedor no puede ponerse precios de compra -> 403', intentoVendedor.status === 403,
    `(${intentoVendedor.status})`);

  // Ésta es LA prueba de este bloque. El comprador se pasa media mañana
  // consiguiendo un precio; el vigía pasa cada hora refrescando precios contra
  // Quiter. Si el segundo le pisa el trabajo al primero, la cotización sale con
  // un precio que nadie negoció y NADIE SE ENTERA: no hay error, no hay aviso,
  // solo un número distinto. Por eso se prueba explícitamente.
  console.log('\n== El vigía no le pisa el precio al comprador ==');

  const antesDelVigia = await api(`/solicitudes/${idLibre}`, { token: tokenComprador });
  // Se sigue la partida que EXISTE en Quiter y trae precio negociado. Seguir la
  // capturada a mano no serviría: a ésa el vigía ni siquiera le pregunta precio,
  // así que estaría a salvo por accidente y la prueba pasaría con el error puesto.
  const negociadaAntes = antesDelVigia.data?.solicitud?.detalle
    ?.find((d) => d.origen === 'QUITER' && d.precio_origen === 'COMPRADOR');
  check('Hay una partida de catálogo con precio negociado que vigilar',
    Boolean(negociadaAntes), negociadaAntes ? `(${negociadaAntes.sku_producto})` : '');

  // Se dispara el refresco por el mismo endpoint que usa la pantalla y que el
  // vigía llama cada hora. Llamar al vigía completo aquí NO serviría: sin ERP
  // configurado se salta la tarea de precios entera y la prueba pasaría en
  // verde sin haber ejecutado ni una línea de lo que dice probar.
  const refrescoVigia = await api(`/solicitudes/${idLibre}/precios`, {
    metodo: 'POST', token: tokenComprador,
  });
  check('El refresco de precios corre', refrescoVigia.status === 200, `(${refrescoVigia.status})`);

  const despues = await api(`/solicitudes/${idLibre}`, { token: tokenComprador });
  const negociadaDespues = despues.data?.solicitud?.detalle
    ?.find((d) => d.sku_producto === negociadaAntes?.sku_producto);

  check('El precio negociado sigue intacto después de la vuelta del vigía',
    Number(negociadaDespues?.precio_cotizado) === Number(negociadaAntes?.precio_cotizado),
    `(antes ${negociadaAntes?.precio_cotizado}, después ${negociadaDespues?.precio_cotizado})`);

  check('Y se sigue reconociendo como puesto por el comprador',
    negociadaDespues?.precio_origen === 'COMPRADOR');

  // Que no se pise el compromiso no significa dejar de mirar a Quiter: el
  // precio de lista se sigue guardando aparte, que es lo que deja comparar.
  check('Pero sí se sigue guardando lo que dice Quiter hoy, para poder comparar',
    negociadaDespues?.precio_lista_actual !== null,
    `(lista ${negociadaDespues?.precio_lista_actual} vs negociado ${negociadaDespues?.precio_cotizado})`);

  console.log('\n== Rango de fechas de entrega ==');

  const rango = await api(`/solicitudes/${idLibre}`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { fecha_promesa_entrega: '2026-08-30', fecha_promesa_hasta: '2026-09-02' },
  });
  check('Acepta un rango de entrega', rango.status === 200, `(${rango.status})`);
  check('Guarda el desde', rango.data?.solicitud?.fecha_promesa_entrega === '2026-08-30',
    `(${rango.data?.solicitud?.fecha_promesa_entrega})`);
  check('Guarda el hasta', rango.data?.solicitud?.fecha_promesa_hasta === '2026-09-02',
    `(${rango.data?.solicitud?.fecha_promesa_hasta})`);

  const alReves = await api(`/solicitudes/${idLibre}`, {
    metodo: 'PATCH', token: tokenComprador,
    body: { fecha_promesa_entrega: '2026-09-10', fecha_promesa_hasta: '2026-09-01' },
  });
  check('Un rango al revés se rechaza con un mensaje entendible',
    alReves.status === 400 && /anterior/.test(alReves.data?.error ?? ''),
    `(${alReves.status} ${alReves.data?.error ?? ''})`);

  console.log('\n== Recotizar sin perder el folio ==');

  // Compras terminó; el vendedor la manda al cliente.
  await api(`/solicitudes/${idLibre}/compras`, {
    metodo: 'PATCH', token: tokenComprador, body: { estatus_compras: 'Completada' },
  });
  const envioLibre = await api(`/solicitudes/${idLibre}/enviar`, {
    metodo: 'POST', token: tokenVendedor,
  });
  check('Se envía al cliente', envioLibre.status === 200,
    `(${envioLibre.status} ${envioLibre.data?.error ?? ''})`);

  const antesDeRecotizar = await api(`/solicitudes/${idLibre}`, { token: tokenVendedor });
  const folioOriginal = antesDeRecotizar.data?.solicitud?.folio;
  check('Va en versión 1', Number(antesDeRecotizar.data?.solicitud?.version) === 1);

  const recotizada = await api(`/solicitudes/${idLibre}`, {
    metodo: 'PATCH', token: tokenComprador,
    body: {
      items: [
        { sku_producto: 'XYZ-NO-EXISTE-9', descripcion: 'Bomba hidráulica Cummins',
          cantidad_solicitada: 2, origen: 'LIBRE',
          precio_cotizado: 5200, precio_origen: 'COMPRADOR' },
      ],
      comentario: 'El proveedor subió el precio.',
    },
  });
  check('Se puede recotizar una cotización ya enviada', recotizada.status === 200,
    `(${recotizada.status} ${recotizada.data?.error ?? ''})`);
  check('EL FOLIO NO CAMBIA', recotizada.data?.solicitud?.folio === folioOriginal,
    `(${recotizada.data?.solicitud?.folio})`);
  check('Sube a versión 2', Number(recotizada.data?.solicitud?.version) === 2,
    `(${recotizada.data?.solicitud?.version})`);
  // Esto es lo que evita que el cliente ande con un papel que ya no vale y
  // nadie se entere.
  check('Deja de estar Enviada: hay que volver a mandarla',
    recotizada.data?.solicitud?.estatus_actual !== 'Enviada',
    `(${recotizada.data?.solicitud?.estatus_actual})`);
  check('Se reinicia el reloj de vencimiento',
    recotizada.data?.solicitud?.vence_en === null);
  check('El aviso lo dice con todas sus letras',
    /versión 2/i.test(recotizada.data?.aviso ?? ''), `(${recotizada.data?.aviso})`);
  check('La bitácora conserva todo el recorrido',
    (recotizada.data?.solicitud?.historial?.length ?? 0) >= 6,
    `(${recotizada.data?.solicitud?.historial?.length} movimientos)`);


  console.log('\n== Un pedido no se edita ==');

  const pedidoExistente = await api('/solicitudes?tipo=Pedido', { token: tokenComprador });
  const idPedido = pedidoExistente.data?.solicitudes?.[0]?.id;
  if (idPedido) {
    const intentoPedido = await api(`/solicitudes/${idPedido}`, {
      metodo: 'PATCH', token: tokenComprador,
      body: { observaciones: 'no debería dejarme' },
    });
    check('Editar un pedido se rechaza con explicación',
      intentoPedido.status === 409 && /cancél/i.test(intentoPedido.data?.error ?? ''),
      `(${intentoPedido.status} ${intentoPedido.data?.error ?? ''})`);
  } else {
    check('Editar un pedido se rechaza con explicación', false, '(no había pedidos que probar)');
  }


  // ───────────────────────────────────────────────────────────────────────────
  // LA FRONTERA ENTRE CATOSA Y CADUSA
  //
  // Éste es el bloque que no se puede romper. Lo que falle aquí no produce un
  // error en pantalla: produce información de una empresa en manos de la otra,
  // en silencio y sin que nadie se entere hasta que alguien lo note en una
  // junta. Por eso se prueba desde el servidor y no mirando botones: una
  // pantalla se salta escribiendo una dirección, una cláusula WHERE no.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n== La frontera entre CATOSA y CADUSA ==');

  // Se arma el escenario: una vendedora y un gerente de CADUSA.
  const [sucCadusa] = await query(
    "SELECT s.id, s.id_empresa FROM sucursales s JOIN empresas e ON e.id = s.id_empresa WHERE e.clave = 'CADUSA' LIMIT 1",
  );
  const PASS_CADUSA = 'CadusaPrueba2026';
  const hash = await bcrypt.hash(PASS_CADUSA, 4);
  const [vendCadusa] = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id, id_empresa, alcance, activo)
     VALUES ('Vendedor CADUSA', @em, @h, 'Vendedor', @suc, @emp, 'EMPRESA', TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, activo = TRUE
     RETURNING id`,
    { em: 'vendedor.cadusa@prueba.mx', h: hash, suc: sucCadusa.id, emp: sucCadusa.id_empresa },
  );
  await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, id_empresa, alcance, activo)
     VALUES ('Gerente CADUSA', @em, @h, 'Gerente', @emp, 'EMPRESA', TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, activo = TRUE`,
    { em: 'gerente.cadusa@prueba.mx', h: hash, emp: sucCadusa.id_empresa },
  );
  // El Gerente de CATOSA del seed queda con alcance de grupo para probar el
  // otro lado de la moneda: quien SÍ debe ver las dos.
  await query("UPDATE usuarios SET alcance = 'GRUPO' WHERE email = 'gerente@demo.mx'");

  const entrar = async (email, password) =>
    (await api('/auth/login', { metodo: 'POST', body: { email, password } })).data?.token;

  const tokVendCadusa = await entrar('vendedor.cadusa@prueba.mx', PASS_CADUSA);
  const tokGerCadusa  = await entrar('gerente.cadusa@prueba.mx', PASS_CADUSA);
  check('Entra el vendedor de CADUSA', Boolean(tokVendCadusa));
  check('Entra el gerente de CADUSA', Boolean(tokGerCadusa));

  // CADUSA levanta un folio propio. Sin esto, medio bloque pasaría por estar
  // vacío: `[].every(esDeCadusa)` es cierto, y una lista rota —o un filtro que
  // no devuelve nada nunca— se vería exactamente igual que una bien separada.
  const altaCadusa = await api('/solicitudes', {
    metodo: 'POST', token: tokVendCadusa,
    body: {
      id_sucursal: sucCadusa.id,
      nombre_cliente: 'Cliente de Durango',
      items: [{
        sku_producto: 'CAD-FRONTERA-1',
        descripcion: 'Pieza de prueba de la frontera',
        cantidad_solicitada: 2,
        origen: 'LIBRE',
      }],
    },
  });
  check('CADUSA puede levantar su propio folio', altaCadusa.status === 201,
    `(${altaCadusa.status} ${altaCadusa.data?.error ?? altaCadusa.data?.solicitud?.folio ?? ''})`);
  const folioCadusa = altaCadusa.data?.solicitud;
  check('Y el folio sale con el prefijo de SU empresa',
    /^SC-CADUSA-/.test(folioCadusa?.folio ?? ''), `(${folioCadusa?.folio})`);

  // 1. Los folios de CATOSA no existen para CADUSA.
  const deCatosa = await api('/solicitudes', { token: tokenComprador });
  const unFolioCatosa = deCatosa.data?.solicitudes?.[0];
  check('Hay folios de CATOSA que vigilar', Boolean(unFolioCatosa), `(${deCatosa.data?.solicitudes?.length})`);

  const listaCadusa = await api('/solicitudes', { token: tokGerCadusa });
  check('El gerente de CADUSA sí ve lo suyo',
    (listaCadusa.data?.solicitudes ?? []).some((x) => x.id === folioCadusa?.id),
    `(${listaCadusa.data?.solicitudes?.length} folios)`);
  check('El gerente de CADUSA no ve NINGÚN folio de CATOSA',
    (listaCadusa.data?.solicitudes ?? []).length > 0
    && (listaCadusa.data?.solicitudes ?? []).every((x) => x.empresa_clave === 'CADUSA'),
    `(${listaCadusa.data?.solicitudes?.length} folios, empresas: ${[...new Set((listaCadusa.data?.solicitudes ?? []).map((x) => x.empresa_clave))].join(',') || 'ninguna'})`);

  // 1-bis. Y el sentido contrario, que es el que se olvida: lo que acaba de
  //        capturar Durango no puede asomarse en la mesa de compras de
  //        Torreón. Una frontera que solo se vigila de un lado no es frontera.
  const comprasCatosa = await api('/solicitudes', { token: tokenComprador });
  check('El comprador de CATOSA no ve el folio de CADUSA',
    !(comprasCatosa.data?.solicitudes ?? []).some((x) => x.id === folioCadusa?.id),
    `(${comprasCatosa.data?.solicitudes?.length} folios suyos)`);
  const catosaLoTeclea = await api(`/solicitudes/${folioCadusa?.id}`, { token: tokenComprador });
  check('Y tecleando su id tampoco -> 404', catosaLoTeclea.status === 404,
    `(${catosaLoTeclea.status})`);

  // 2. Tecleando el id directo tampoco. Y se responde "no existe", no "no
  //    puedes": un "no tienes permiso" ya confirmaría que ese folio es real.
  const alTeclearlo = await api(`/solicitudes/${unFolioCatosa?.id}`, { token: tokGerCadusa });
  check('Abrir un folio de CATOSA por su id -> 404', alTeclearlo.status === 404,
    `(${alTeclearlo.status})`);
  check('Y el mensaje no confirma que exista',
    !/permiso|empresa/i.test(alTeclearlo.data?.error ?? ''), `(${alTeclearlo.data?.error})`);

  // 3. Tampoco puede levantar documentos en una sucursal ajena.
  const enSucursalAjena = await api('/solicitudes', {
    metodo: 'POST', token: tokGerCadusa,
    body: {
      id_sucursal: 1, // Torreón, de CATOSA
      items: [{ sku_producto: 'X-1', descripcion: 'Pieza', cantidad_solicitada: 1, origen: 'LIBRE' }],
    },
  });
  check('No puede capturar en una sucursal de CATOSA -> 403', enSucursalAjena.status === 403,
    `(${enSucursalAjena.status} ${enSucursalAjena.data?.error ?? ''})`);

  // 4. El catálogo de sucursales tampoco se las ofrece.
  const sucCadusaLista = await api('/catalogos/sucursales', { token: tokVendCadusa });
  check('Solo ve las sucursales de CADUSA',
    (sucCadusaLista.data?.sucursales ?? []).length === 3
    && sucCadusaLista.data.sucursales.every((x) => x.empresa_clave === 'CADUSA'),
    `(${sucCadusaLista.data?.sucursales?.map((x) => x.clave).join(', ')})`);

  // 5. Los usuarios de CATOSA no son suyos para administrar.
  const usuariosCadusa = await api('/usuarios', { token: tokGerCadusa });
  check('El gerente de CADUSA solo ve usuarios de CADUSA',
    (usuariosCadusa.data?.usuarios ?? []).every((u) => u.empresa_clave === 'CADUSA'),
    `(${usuariosCadusa.data?.usuarios?.length} usuarios)`);

  // 6. Los números del dashboard tampoco se mezclan.
  const dashCadusa = await api('/dashboard/gerencia?dias=365', { token: tokGerCadusa });
  const dashCatosa = await api('/dashboard/gerencia?dias=365', { token: tokenGerente });
  const nCadusa = Number(dashCadusa.data?.totales?.total_solicitudes ?? -1);
  const nGrupo  = Number(dashCatosa.data?.totales?.total_solicitudes ?? -1);
  check('El dashboard de CADUSA no cuenta los folios de CATOSA',
    nCadusa > 0 && nCadusa < nGrupo, `(CADUSA ${nCadusa} vs grupo ${nGrupo})`);
  check('Y el dashboard dice de qué empresa son sus números',
    Boolean(dashCadusa.data?.empresa?.nombre),
    `(CADUSA: "${dashCadusa.data?.empresa?.nombre}" · grupo: "${dashCatosa.data?.empresa?.nombre}")`);

  // 7. El Excel es por donde se escaparía sin hacer ruido: nadie revisa un
  //    archivo renglón por renglón.
  const excelCadusa = await fetch(`${BASE}/reportes/solicitudes`, {
    headers: { Authorization: `Bearer ${tokGerCadusa}` },
  });
  check('El Excel de CADUSA se genera', excelCadusa.status === 200);

  // 8. Y el otro lado: quien tiene alcance de grupo SÍ ve las dos.
  const listaGrupo = await api('/solicitudes', { token: tokenGerente });
  const empresasVistas = new Set((listaGrupo.data?.solicitudes ?? []).map((x) => x.empresa_clave));
  check('Quien ve el grupo sí ve las dos empresas', empresasVistas.size === 2,
    `(ve: ${[...empresasVistas].join(', ')})`);

  // 9. La existencia NO se separa: ése es el punto de compartir el sistema.
  const existGlobal = await api('/productos/existencias?sku=filtro', { token: tokVendCadusa });
  check('La consulta de existencias responde para CADUSA', existGlobal.status === 200);
  const almacenes = (existGlobal.data?.articulos ?? [])
    .flatMap((a) => [a, ...(a.existencia_otras_sucursales ?? [])]);
  check('Los almacenes vienen etiquetados con su empresa',
    almacenes.length > 0 && almacenes.some((x) => x.empresa_clave),
    `(${almacenes.map((x) => `${x.almacen}:${x.empresa_clave ?? '?'}`).join(' ')})`);
  check('Y se marca cuáles son de la otra empresa',
    almacenes.some((x) => x.es_otra_empresa === true || x.es_otra_empresa === false));

  console.log('\n== Catálogos ==');
  // Ya no son las 7 de Quiter: son las de SU empresa. Las de la hermana se ven
  // en la consulta de existencias, pero no son un lugar donde pueda capturar.
  const suc = await api('/catalogos/sucursales', { token: tokenVendedor });
  check('Solo lista las sucursales de su empresa',
    suc.data?.sucursales?.length === 4
    && suc.data.sucursales.every((x) => x.empresa_clave === 'CATOSA'),
    `(${suc.data?.sucursales?.length}: ${suc.data?.sucursales?.map((x) => x.clave).join(', ')})`);
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
