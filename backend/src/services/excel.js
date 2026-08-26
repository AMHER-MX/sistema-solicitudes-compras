/**
 * Generación de archivos Excel (.xlsx).
 *
 * Un reporte que se abre y se lee sin tener que arreglarlo primero: encabezado
 * congelado, filtros puestos, columnas a la medida del contenido, fechas como
 * fechas y dinero como dinero. Si al abrirlo hay que ensanchar columnas o
 * cambiar formatos, el reporte no está terminado.
 *
 * Dos decisiones que vale la pena explicar:
 *
 *  · Los totales van como fórmula (=SUM), no como número calculado aquí. Así,
 *    si alguien filtra u ordena en Excel —que es lo primero que va a hacer—,
 *    el total sigue cuadrando con lo que ve.
 *
 *  · Cada archivo lleva una portada con quién lo bajó, cuándo y con qué
 *    filtros. Un Excel sin eso, reenviado por correo tres veces, se vuelve un
 *    dato sin origen que nadie puede volver a reproducir.
 */
import ExcelJS from 'exceljs';

/** Tipografía sobria y disponible en cualquier Windows. */
const FUENTE = 'Arial';

const COLOR_ENCABEZADO = 'FF1F3864';   // azul institucional oscuro
const COLOR_TEXTO_ENCABEZADO = 'FFFFFFFF';
const COLOR_BANDA = 'FFF2F5FA';        // franja tenue para renglones alternos
const COLOR_TOTAL = 'FFE8EDF5';

/** Formatos de número. Los negativos entre paréntesis, el cero como guion. */
export const FORMATO = {
  moneda: '$#,##0.00;($#,##0.00);"-"',
  cantidad: '#,##0.##;(#,##0.##);"-"',
  entero: '#,##0;(#,##0);"-"',
  decimal1: '#,##0.0;(#,##0.0);"-"',
  fecha: 'dd/mm/yyyy',
  fechaHora: 'dd/mm/yyyy hh:mm',
  porcentaje: '0.0%',
};

/**
 * Crea el libro con las propiedades del archivo ya puestas.
 * @param {string} titulo
 */
export function nuevoLibro(titulo) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'SGC Compras · CATOSA';
  libro.lastModifiedBy = 'SGC Compras';
  libro.created = new Date();
  libro.title = titulo;
  return libro;
}

/**
 * Escribe el bloque de portada al inicio de una hoja.
 * Devuelve el número del renglón donde debe empezar la tabla.
 */
export function escribirPortada(hoja, { titulo, subtitulo, generadoPor, filtros = [] }) {
  const t = hoja.getCell('A1');
  t.value = titulo;
  t.font = { name: FUENTE, size: 15, bold: true, color: { argb: COLOR_ENCABEZADO } };
  hoja.getRow(1).height = 22;

  let fila = 2;
  if (subtitulo) {
    const s = hoja.getCell(`A${fila}`);
    s.value = subtitulo;
    s.font = { name: FUENTE, size: 10, color: { argb: 'FF555555' } };
    fila += 1;
  }

  const generado = hoja.getCell(`A${fila}`);
  generado.value = `Generado el ${new Date().toLocaleString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })}${generadoPor ? ` por ${generadoPor}` : ''}`;
  generado.font = { name: FUENTE, size: 9, color: { argb: 'FF777777' } };
  fila += 1;

  const descripcion = filtros.length
    ? `Filtros aplicados: ${filtros.join(' · ')}`
    : 'Sin filtros: incluye toda la información disponible.';
  const f = hoja.getCell(`A${fila}`);
  f.value = descripcion;
  f.font = { name: FUENTE, size: 9, italic: true, color: { argb: 'FF777777' } };

  return fila + 2; // un renglón en blanco antes de la tabla
}

/**
 * Dibuja una tabla con encabezado, bandas, formatos y totales.
 *
 * @param {object} hoja
 * @param {object} opciones
 * @param {number} opciones.filaInicial
 * @param {Array<{titulo:string, campo:string, ancho?:number, formato?:string,
 *                alineacion?:string, total?:boolean}>} opciones.columnas
 * @param {Array<object>} opciones.renglones
 * @param {boolean} [opciones.conTotales]
 * @returns {number} el renglón siguiente al final de la tabla
 */
export function escribirTabla(hoja, { filaInicial, columnas, renglones, conTotales = true }) {
  const filaEncabezado = hoja.getRow(filaInicial);

  columnas.forEach((col, i) => {
    const celda = filaEncabezado.getCell(i + 1);
    celda.value = col.titulo;
    celda.font = { name: FUENTE, size: 10, bold: true, color: { argb: COLOR_TEXTO_ENCABEZADO } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
    celda.alignment = { vertical: 'middle', horizontal: col.alineacion ?? 'left', wrapText: true };
    celda.border = { bottom: { style: 'thin', color: { argb: COLOR_ENCABEZADO } } };
    hoja.getColumn(i + 1).width = col.ancho ?? 16;
  });
  filaEncabezado.height = 26;

  renglones.forEach((dato, indice) => {
    const fila = hoja.getRow(filaInicial + 1 + indice);
    columnas.forEach((col, i) => {
      const celda = fila.getCell(i + 1);
      celda.value = normalizar(dato[col.campo], col.formato);
      celda.font = { name: FUENTE, size: 10 };
      if (col.formato) celda.numFmt = col.formato;
      celda.alignment = { horizontal: col.alineacion ?? 'left', vertical: 'top' };
      // Bandas: leer 40 renglones de números sin ellas es perder el renglón.
      if (indice % 2 === 1) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BANDA } };
      }
    });
  });

  const primeraDatos = filaInicial + 1;
  const ultimaDatos = filaInicial + renglones.length;
  let siguiente = ultimaDatos + 1;

  // Filtros y panel congelado: en un reporte de cientos de renglones, es la
  // diferencia entre poder trabajarlo y tener que exportarlo otra vez.
  if (renglones.length > 0) {
    hoja.autoFilter = {
      from: { row: filaInicial, column: 1 },
      to: { row: ultimaDatos, column: columnas.length },
    };
    hoja.views = [{ state: 'frozen', ySplit: filaInicial }];
  }

  const hayTotales = conTotales && renglones.length > 0 && columnas.some((c) => c.total);
  if (hayTotales) {
    const fila = hoja.getRow(siguiente);
    columnas.forEach((col, i) => {
      const celda = fila.getCell(i + 1);
      if (i === 0) {
        celda.value = 'TOTAL';
      } else if (col.total) {
        const letra = hoja.getColumn(i + 1).letter;
        // Fórmula, no número: si filtran u ordenan, el total sigue cuadrando.
        celda.value = { formula: `SUM(${letra}${primeraDatos}:${letra}${ultimaDatos})` };
        if (col.formato) celda.numFmt = col.formato;
      }
      celda.font = { name: FUENTE, size: 10, bold: true };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOTAL } };
      celda.alignment = { horizontal: col.alineacion ?? 'left' };
      celda.border = { top: { style: 'thin', color: { argb: COLOR_ENCABEZADO } } };
    });
    siguiente += 1;
  }

  if (renglones.length === 0) {
    const celda = hoja.getCell(`A${siguiente}`);
    celda.value = 'No hay información que cumpla estos filtros.';
    celda.font = { name: FUENTE, size: 10, italic: true, color: { argb: 'FF777777' } };
    siguiente += 1;
  }

  return siguiente + 1;
}

/**
 * Convierte lo que devuelve la base a algo que Excel entienda como dato.
 *
 * PostgreSQL entrega NUMERIC como texto para no perder precisión. Si ese texto
 * se escribe tal cual, Excel lo trata como texto: no suma, no ordena por valor
 * y el formato de moneda no aplica. Aquí se vuelve número.
 */
function normalizar(valor, formato) {
  if (valor === null || valor === undefined) return null;

  const esNumerico = formato && formato !== FORMATO.fecha && formato !== FORMATO.fechaHora;
  if (esNumerico && typeof valor === 'string' && valor.trim() !== '' && !Number.isNaN(Number(valor))) {
    return Number(valor);
  }

  // Las fechas que ya vienen como texto 'YYYY-MM-DD' se convierten a fecha real
  // fijando el mediodía: así ningún ajuste de zona horaria las corre de día.
  if ((formato === FORMATO.fecha || formato === FORMATO.fechaHora)
      && typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split('-').map(Number);
    return new Date(a, m - 1, d, 12, 0, 0);
  }

  return valor;
}

/**
 * Escribe un bloque de "etiqueta: valor" (para la hoja de indicadores).
 * @returns {number} el renglón siguiente
 */
export function escribirBloque(hoja, filaInicial, titulo, pares) {
  const t = hoja.getCell(`A${filaInicial}`);
  t.value = titulo;
  t.font = { name: FUENTE, size: 11, bold: true, color: { argb: COLOR_ENCABEZADO } };

  let fila = filaInicial + 1;
  for (const [etiqueta, valor, formato] of pares) {
    const e = hoja.getCell(`A${fila}`);
    e.value = etiqueta;
    e.font = { name: FUENTE, size: 10 };

    const v = hoja.getCell(`B${fila}`);
    v.value = normalizar(valor, formato);
    v.font = { name: FUENTE, size: 10, bold: true };
    if (formato) v.numFmt = formato;
    v.alignment = { horizontal: 'right' };
    fila += 1;
  }
  return fila + 1;
}

/** Devuelve el libro como Buffer, listo para mandarlo por HTTP. */
export const aBuffer = (libro) => libro.xlsx.writeBuffer();
