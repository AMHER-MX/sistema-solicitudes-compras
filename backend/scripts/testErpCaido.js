/**
 * QUÉ PASA CUANDO QUITER NO CONTESTA
 *
 *   cd backend && npm run test:erp
 *
 * El 23 de octubre de 2026, una hora antes de abrirle el sistema al equipo, el
 * buscador seguía enseñando refacciones con toda normalidad —precios,
 * existencias, "disponible en Gómez Palacio (3)"— pero eran del catálogo de
 * demostración: la API de refacciones no estaba contestando. Lo único que lo
 * decía era una barra color ámbar arriba de los resultados.
 *
 * Dos cosas estaban mal y las dos se arreglaron:
 *
 *   1. Se podía LEVANTAR una cotización con esos números. Quedaban guardados
 *      como existencia y precio de Quiter, y después nadie podía distinguir
 *      un folio bueno de uno armado con datos inventados.
 *
 *   2. /api/health decía `QUITER_API` igual que cualquier otro día, porque
 *      informaba cómo estaba CONFIGURADO el ERP, no si respondía. Una caída
 *      era invisible salvo que un vendedor leyera la barra ámbar y avisara.
 *
 * Esta prueba levanta un ERP de mentiras que se puede apagar a media prueba, y
 * revisa los dos lados: que con el ERP caído el sistema se niegue y lo diga, y
 * que con el ERP sano todo siga funcionando igual que siempre. Lo segundo
 * importa tanto como lo primero: una protección que también estorba el día
 * normal termina quitándose.
 */
import { createServer } from 'node:http';

// ── El ERP de mentiras ──────────────────────────────────────────────────────
// Se puede apagar a media prueba poniendo `caido = true`: así se cubren los
// dos caminos en una sola corrida, sin reiniciar nada.
let caido = false;

const PIEZAS = [
  {
    sku: 'BAL-8890',
    descripcion: 'Balata delantera cerámica 8890',
    precio_lista: 1399,
    existencia: 0,
    existencia_otras_sucursales: [
      { almacen: '102', nombre: 'Refacciones Gómez Palacio', existencia: 2 },
    ],
  },
  { sku: 'BAL-8891', descripcion: 'Balata trasera semimetálica 8891', precio_lista: 1020, existencia: 7 },
];

const erpFalso = createServer((req, res) => {
  if (caido) { res.statusCode = 503; return res.end('{}'); }

  const u = new URL(req.url, 'http://erp');
  res.setHeader('Content-Type', 'application/json');

  if (u.pathname === '/api/existencias') {
    const q = (u.searchParams.get('sku') ?? '').toLowerCase();
    return res.end(JSON.stringify(PIEZAS.filter(
      (p) => p.sku.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q),
    )));
  }
  if (u.pathname === '/api/clientes') return res.end('[]');

  res.statusCode = 404;
  return res.end('{}');
});

await new Promise((listo) => erpFalso.listen(0, '127.0.0.1', listo));
const puertoErp = erpFalso.address().port;

// La configuración se lee al importar, así que se deja puesta ANTES de traer
// la aplicación. Por eso el import es dinámico y no de los de arriba.
process.env.QUITER_BASE_URL = `http://127.0.0.1:${puertoErp}`;
// Sin caché: esta prueba apaga el ERP a media corrida y necesita que la
// siguiente consulta vaya de verdad, no que conteste una respuesta guardada.
process.env.ERP_CACHE_TTL_SEG = '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'pruebaErpCaido1234567890';

const { crearApp } = await import('../src/app.js');
const { cerrarPool } = await import('../src/config/db.js');

const app = crearApp();
const servidor = app.listen(0);
const BASE = `http://127.0.0.1:${servidor.address().port}/api`;

// ── Andamiaje ───────────────────────────────────────────────────────────────
let fallos = 0;

const check = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${detalle ? ` ${detalle}` : ''}`);
  if (!ok) fallos += 1;
};

const api = async (ruta, { metodo = 'GET', token, body } = {}) => {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const DE_CATALOGO = [{
  sku_producto: 'BAL-8890',
  descripcion: 'Balata delantera cerámica 8890',
  cantidad_solicitada: 2,
  existencia_real_almacen: 0,
  precio_estimado: 1399,
  origen: 'CATALOGO',
}];

const A_MANO = [{
  sku_producto: 'TUR-9900-HX',
  descripcion: 'Turbo reconstruido Cummins ISX 15',
  cantidad_solicitada: 1,
  existencia_real_almacen: 0,
  origen: 'LIBRE',
}];

try {
  const entrada = await api('/auth/login', {
    metodo: 'POST',
    body: { email: 'vendedor@demo.mx', password: 'demo1234' },
  });
  const token = entrada.data?.token;

  if (!token) {
    console.error('\n  No se pudo entrar con la cuenta de demostración.');
    console.error('  Esta prueba necesita la base de pruebas con su seed (npm run db:setup).\n');
    process.exit(1);
  }

  // ── 1. El día normal: el ERP contesta ────────────────────────────────────
  console.log('\n== Con el ERP contestando ==');

  const saludSana = await api('/health');
  check('/api/health dice que está contestando',
    saludSana.data?.erp?.responde === true,
    `(responde: ${saludSana.data?.erp?.responde}, estado: "${saludSana.data?.erp?.estado}")`);

  const busqueda = await api('/productos/existencias?sku=balata', { token });
  check('El buscador no avisa de respaldo', !busqueda.data?.aviso,
    `("${busqueda.data?.aviso ?? 'sin aviso'}")`);
  check('Y los precios son los del ERP, no los del catálogo local',
    busqueda.data?.articulos?.some((a) => Number(a.precio_lista) === 1399),
    `(${busqueda.data?.articulos?.map((a) => `${a.sku}:${a.precio_lista}`).join(' ')})`);

  const altaSana = await api('/solicitudes', { metodo: 'POST', token, body: { items: DE_CATALOGO } });
  check('Se levanta la cotización con normalidad -> 201', altaSana.status === 201,
    `(${altaSana.status} ${altaSana.data?.solicitud?.folio ?? altaSana.data?.error ?? ''})`);
  check('Y guarda el precio que dio el ERP',
    Number(altaSana.data?.solicitud?.detalle?.[0]?.precio_cotizado) === 1399,
    `(${altaSana.data?.solicitud?.detalle?.[0]?.precio_cotizado})`);

  // ── 2. Se cae el ERP ─────────────────────────────────────────────────────
  caido = true;
  console.log('\n== Con el ERP caído ==');

  const saludCaida = await api('/health');
  check('/api/health deja de decir que todo está bien',
    saludCaida.data?.erp?.responde === false,
    `(responde: ${saludCaida.data?.erp?.responde}, estado: "${saludCaida.data?.erp?.estado}")`);
  check('...pero sigue reportando que el ERP SÍ está configurado',
    saludCaida.data?.erp?.origen === 'QUITER_API', `(${saludCaida.data?.erp?.origen})`);
  check('...y lo explica en español, no con un booleano suelto',
    /no responde/i.test(saludCaida.data?.erp?.aviso ?? ''),
    `("${(saludCaida.data?.erp?.aviso ?? 'sin aviso').slice(0, 44)}...")`);

  const busquedaCaida = await api('/productos/existencias?sku=balata', { token });
  check('El buscador advierte que lo que enseña es de respaldo',
    /respaldo/i.test(busquedaCaida.data?.aviso ?? ''),
    `("${(busquedaCaida.data?.aviso ?? 'sin aviso').slice(0, 44)}...")`);

  // Lo que de verdad importa.
  const altaCaida = await api('/solicitudes', { metodo: 'POST', token, body: { items: DE_CATALOGO } });
  check('NO se puede levantar una cotización de catálogo -> 400',
    altaCaida.status === 400, `(${altaCaida.status})`);
  check('...y el mensaje dice qué pasó, qué hacer y a quién avisarle',
    /quiter/i.test(altaCaida.data?.error ?? '') && /sistemas/i.test(altaCaida.data?.error ?? ''),
    `("${(altaCaida.data?.error ?? '').slice(0, 52)}...")`);

  // Y lo que NO debe bloquearse: una parte que el ERP no conoce de todos modos.
  // Es justo la herramienta que sirve cuando el ERP no está; quitarla aquí
  // sería castigar al vendedor por una falla que no es suya.
  const aManoCaida = await api('/solicitudes', { metodo: 'POST', token, body: { items: A_MANO } });
  check('Pero una parte capturada a mano SÍ se puede -> 201',
    aManoCaida.status === 201,
    `(${aManoCaida.status} ${aManoCaida.data?.solicitud?.folio ?? aManoCaida.data?.error ?? ''})`);

  // ── 3. Vuelve el ERP ─────────────────────────────────────────────────────
  caido = false;
  console.log('\n== Cuando el ERP vuelve ==');

  const altaDeVuelta = await api('/solicitudes', { metodo: 'POST', token, body: { items: DE_CATALOGO } });
  check('Se vuelve a poder levantar, sin reiniciar nada -> 201',
    altaDeVuelta.status === 201,
    `(${altaDeVuelta.status} ${altaDeVuelta.data?.solicitud?.folio ?? altaDeVuelta.data?.error ?? ''})`);
} finally {
  servidor.close();
  erpFalso.close();
  await cerrarPool().catch(() => {});
}

console.log(fallos
  ? `\nERP: ${fallos} PRUEBA(S) FALLARON ✗\n`
  : '\nERP: TODAS LAS PRUEBAS PASARON ✓\n');
process.exit(fallos ? 1 : 0);
