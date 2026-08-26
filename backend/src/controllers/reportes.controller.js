/**
 * Descargas a Excel.
 *
 *   GET /api/reportes/solicitudes   Solicitudes con su detalle
 *   GET /api/reportes/historial     Bitácora de cada folio
 *   GET /api/reportes/faltantes     Concentrado de lo que más falta
 *   GET /api/reportes/indicadores   Los números del tablero
 *
 * Todos aceptan los mismos filtros que las pantallas (estatus, sucursal,
 * prioridad, desde, hasta, busqueda, dias), para que lo que se baja sea
 * exactamente lo que se está viendo.
 *
 * Un Vendedor solo puede bajar lo suyo: el filtro se le impone en el servidor,
 * mande lo que mande en la petición.
 */
import {
  bitacoraPorFolio, concentradoFaltantes, indicadoresGerencia, solicitudesConDetalle,
} from '../services/reportes.service.js';
import {
  FORMATO, aBuffer, escribirBloque, escribirPortada, escribirTabla, nuevoLibro,
} from '../services/excel.js';
import { ROLES } from '../utils/estatus.js';
import { badRequest } from '../utils/errors.js';

/** Filtros de la petición, ya limpios. */
function filtrosDe(req) {
  const f = {
    id_vendedor: req.query.id_vendedor,
    sucursal: req.query.sucursal,
    prioridad: req.query.prioridad,
    estatus: req.query.estatus,
    desde: req.query.desde,
    hasta: req.query.hasta,
    busqueda: req.query.busqueda,
    dias: req.query.dias,
  };

  // Un Vendedor solo ve lo suyo, aunque mande otro id en la query.
  if (req.usuario.rol === ROLES.VENDEDOR) f.id_vendedor = req.usuario.id;

  return f;
}

/** Descripción legible de los filtros, para la portada del archivo. */
function describirFiltros(req, filtros) {
  const partes = [];
  if (filtros.estatus) partes.push(`Estatus: ${filtros.estatus}`);
  if (filtros.prioridad) partes.push(`Prioridad: ${filtros.prioridad}`);
  if (filtros.busqueda) partes.push(`Búsqueda: "${filtros.busqueda}"`);
  if (filtros.desde) partes.push(`Desde: ${filtros.desde}`);
  if (filtros.hasta) partes.push(`Hasta: ${filtros.hasta}`);
  if (filtros.dias) partes.push(`Últimos ${filtros.dias} días`);
  if (req.usuario.rol === ROLES.VENDEDOR) partes.push('Solo mis solicitudes');
  else if (filtros.sucursal) partes.push(`Sucursal (id): ${filtros.sucursal}`);
  return partes;
}

/** Manda el libro como descarga, con un nombre que se entienda en la carpeta. */
async function enviar(res, libro, nombreBase) {
  const fecha = new Date().toISOString().slice(0, 10);
  const archivo = `${nombreBase}-${fecha}.xlsx`;
  const buffer = await aBuffer(libro);

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
  // El navegador necesita ver este encabezado para poder leer el nombre.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(Buffer.from(buffer));
}

// ─────────────────────────────────────────────────────────────────────────────

export async function solicitudes(req, res) {
  const filtros = filtrosDe(req);
  const renglones = await solicitudesConDetalle(filtros);

  const libro = nuevoLibro('Solicitudes de compra');
  const hoja = libro.addWorksheet('Solicitudes', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const inicio = escribirPortada(hoja, {
    titulo: 'Solicitudes de compra · detalle por partida',
    subtitulo: 'Un renglón por pieza pedida. El folio se repite en cada partida de la misma solicitud.',
    generadoPor: req.usuario.nombre,
    filtros: describirFiltros(req, filtros),
  });

  escribirTabla(hoja, {
    filaInicial: inicio,
    renglones,
    columnas: [
      { titulo: 'Folio',            campo: 'folio',                   ancho: 16 },
      { titulo: 'Fecha',            campo: 'fecha_creacion',          ancho: 12, formato: FORMATO.fecha },
      { titulo: 'Estatus',          campo: 'estatus_actual',          ancho: 14 },
      { titulo: 'Prioridad',        campo: 'prioridad',               ancho: 10 },
      { titulo: 'Vendedor',         campo: 'vendedor',                ancho: 20 },
      { titulo: 'Suc.',             campo: 'sucursal_clave',          ancho: 7,  alineacion: 'center' },
      { titulo: 'Sucursal',         campo: 'sucursal',                ancho: 22 },
      { titulo: 'Cliente',          campo: 'cliente',                 ancho: 26 },
      { titulo: 'No. de parte',     campo: 'sku_producto',            ancho: 18 },
      { titulo: 'Descripción',      campo: 'descripcion',             ancho: 34 },
      { titulo: 'Cant.',            campo: 'cantidad_solicitada',     ancho: 9,  formato: FORMATO.cantidad, alineacion: 'right', total: true },
      { titulo: 'Exist. al pedir',  campo: 'existencia_real_almacen', ancho: 12, formato: FORMATO.cantidad, alineacion: 'right' },
      { titulo: 'Surtido',          campo: 'cantidad_surtida',        ancho: 9,  formato: FORMATO.cantidad, alineacion: 'right', total: true },
      { titulo: 'Precio est.',      campo: 'precio_estimado',         ancho: 13, formato: FORMATO.moneda,   alineacion: 'right' },
      { titulo: 'Importe est.',     campo: 'importe_estimado',        ancho: 15, formato: FORMATO.moneda,   alineacion: 'right', total: true },
      { titulo: 'Comprador',        campo: 'comprador',               ancho: 20 },
      { titulo: 'Promesa',          campo: 'fecha_promesa_entrega',   ancho: 12, formato: FORMATO.fecha },
      { titulo: 'Cierre',           campo: 'fecha_cierre',            ancho: 16, formato: FORMATO.fechaHora },
      { titulo: 'Días abierta',     campo: 'dias_abierta',            ancho: 12, formato: FORMATO.decimal1, alineacion: 'right' },
      { titulo: 'Observaciones',    campo: 'observaciones',           ancho: 40 },
    ],
  });

  await enviar(res, libro, 'solicitudes');
}

export async function historial(req, res) {
  const filtros = filtrosDe(req);
  const renglones = await bitacoraPorFolio(filtros);

  const libro = nuevoLibro('Seguimiento por folio');
  const hoja = libro.addWorksheet('Seguimiento', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const inicio = escribirPortada(hoja, {
    titulo: 'Seguimiento de cada folio',
    subtitulo: 'Quién movió qué y cuándo. "Horas desde el anterior" mide cuánto tardó ESE tramo,'
             + ' no la solicitud completa: sirve para ver dónde se atora el proceso.',
    generadoPor: req.usuario.nombre,
    filtros: describirFiltros(req, filtros),
  });

  escribirTabla(hoja, {
    filaInicial: inicio,
    renglones,
    conTotales: false,
    columnas: [
      { titulo: 'Folio',              campo: 'folio',                ancho: 16 },
      { titulo: 'Fecha y hora',       campo: 'fecha_movimiento',     ancho: 17, formato: FORMATO.fechaHora },
      { titulo: 'Quién lo movió',     campo: 'quien',                ancho: 22 },
      { titulo: 'Rol',                campo: 'rol',                  ancho: 12 },
      { titulo: 'De',                 campo: 'estatus_anterior',     ancho: 14 },
      { titulo: 'A',                  campo: 'estatus_nuevo',        ancho: 14 },
      { titulo: 'Horas en ese paso',  campo: 'horas_desde_anterior', ancho: 15, formato: FORMATO.decimal1, alineacion: 'right' },
      { titulo: 'Comentario',         campo: 'comentario',           ancho: 50 },
    ],
  });

  await enviar(res, libro, 'seguimiento');
}

export async function faltantes(req, res) {
  const filtros = filtrosDe(req);
  const renglones = await concentradoFaltantes(filtros);

  const libro = nuevoLibro('Concentrado de faltantes');
  const hoja = libro.addWorksheet('Faltantes', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const inicio = escribirPortada(hoja, {
    titulo: 'Lo que más falta',
    subtitulo: 'Solo las partidas que al pedirse tenían CERO existencia en la sucursal.'
             + ' Ordenado por piezas pedidas: arriba está lo que más conviene evaluar para tener en piso.',
    generadoPor: req.usuario.nombre,
    filtros: describirFiltros(req, filtros),
  });

  escribirTabla(hoja, {
    filaInicial: inicio,
    renglones,
    columnas: [
      { titulo: 'No. de parte',        campo: 'sku_producto',            ancho: 18 },
      { titulo: 'Descripción',         campo: 'descripcion',             ancho: 40 },
      { titulo: 'Piezas pedidas',      campo: 'piezas_pedidas',          ancho: 14, formato: FORMATO.cantidad, alineacion: 'right', total: true },
      { titulo: 'Veces pedido',        campo: 'veces_pedido',            ancho: 12, formato: FORMATO.entero,   alineacion: 'right', total: true },
      { titulo: 'Solicitudes',         campo: 'solicitudes',             ancho: 12, formato: FORMATO.entero,   alineacion: 'right' },
      { titulo: 'Veces urgente',       campo: 'veces_urgente',           ancho: 13, formato: FORMATO.entero,   alineacion: 'right' },
      { titulo: 'Sucursales',          campo: 'sucursales_que_lo_piden', ancho: 11, formato: FORMATO.entero,   alineacion: 'right' },
      { titulo: 'Cuáles',              campo: 'claves_sucursal',         ancho: 22 },
      { titulo: 'Precio promedio',     campo: 'precio_promedio',         ancho: 15, formato: FORMATO.moneda,   alineacion: 'right' },
      { titulo: 'Importe estimado',    campo: 'importe_estimado',        ancho: 16, formato: FORMATO.moneda,   alineacion: 'right', total: true },
      { titulo: 'Último pedido',       campo: 'ultimo_pedido',           ancho: 16, formato: FORMATO.fechaHora },
    ],
  });

  await enviar(res, libro, 'faltantes');
}

export async function indicadores(req, res) {
  const filtros = filtrosDe(req);
  const datos = await indicadoresGerencia(filtros);

  const libro = nuevoLibro('Indicadores de compras');
  const hoja = libro.addWorksheet('Indicadores');

  let fila = escribirPortada(hoja, {
    titulo: 'Indicadores de compras',
    subtitulo: 'Los mismos números del tablero de gerencia, para el periodo filtrado.',
    generadoPor: req.usuario.nombre,
    filtros: describirFiltros(req, filtros),
  });

  hoja.getColumn(1).width = 34;
  hoja.getColumn(2).width = 18;

  const r = datos.resumen ?? {};
  fila = escribirBloque(hoja, fila, 'Resumen del periodo', [
    ['Solicitudes',                 r.solicitudes,        FORMATO.entero],
    ['Abiertas',                    r.abiertas,           FORMATO.entero],
    ['Urgentes abiertas',           r.urgentes_abiertas,  FORMATO.entero],
    ['Vencidas (promesa pasada)',   r.vencidas,           FORMATO.entero],
    ['Piezas solicitadas',          r.piezas,             FORMATO.cantidad],
    ['Monto estimado',              r.monto_estimado,     FORMATO.moneda],
  ]);

  const t = datos.tiempos ?? {};
  fila = escribirBloque(hoja, fila, 'Tiempo de atención (solicitudes ya cerradas)', [
    ['Solicitudes cerradas',        t.cerradas,           FORMATO.entero],
    ['Promedio en horas',           t.horas_promedio,     FORMATO.decimal1],
    ['Promedio en días',            t.dias_promedio,      FORMATO.decimal1],
  ]);

  fila = escribirTabla(hoja, {
    filaInicial: fila,
    renglones: datos.porEstatus,
    conTotales: true,
    columnas: [
      { titulo: 'Estatus',     campo: 'estatus',     ancho: 24 },
      { titulo: 'Solicitudes', campo: 'solicitudes', ancho: 14, formato: FORMATO.entero, alineacion: 'right', total: true },
    ],
  });

  fila = escribirTabla(hoja, {
    filaInicial: fila,
    renglones: datos.porSucursal,
    columnas: [
      { titulo: 'Suc.',            campo: 'clave',          ancho: 8,  alineacion: 'center' },
      { titulo: 'Sucursal',        campo: 'sucursal',       ancho: 26 },
      { titulo: 'Solicitudes',     campo: 'solicitudes',    ancho: 13, formato: FORMATO.entero, alineacion: 'right', total: true },
      { titulo: 'Abiertas',        campo: 'abiertas',       ancho: 11, formato: FORMATO.entero, alineacion: 'right', total: true },
      { titulo: 'Monto estimado',  campo: 'monto_estimado', ancho: 17, formato: FORMATO.moneda, alineacion: 'right', total: true },
    ],
  });

  escribirTabla(hoja, {
    filaInicial: fila,
    renglones: datos.porVendedor,
    columnas: [
      { titulo: 'Vendedor',        campo: 'vendedor',       ancho: 26 },
      { titulo: 'Solicitudes',     campo: 'solicitudes',    ancho: 13, formato: FORMATO.entero, alineacion: 'right', total: true },
      { titulo: 'Abiertas',        campo: 'abiertas',       ancho: 11, formato: FORMATO.entero, alineacion: 'right', total: true },
      { titulo: 'Monto estimado',  campo: 'monto_estimado', ancho: 17, formato: FORMATO.moneda, alineacion: 'right', total: true },
    ],
  });

  // La portada ya congeló el panel en las tablas anteriores; en esta hoja de
  // bloques no aplica, porque no hay una sola tabla que recorrer.
  hoja.views = [{ state: 'normal' }];
  hoja.autoFilter = undefined;

  await enviar(res, libro, 'indicadores');
}

/** Rechaza un tipo de reporte que no existe, con la lista de los que sí. */
export function tipoInvalido(req) {
  throw badRequest(`No existe el reporte "${req.params.tipo}". `
    + 'Opciones: solicitudes, historial, faltantes, indicadores.');
}
