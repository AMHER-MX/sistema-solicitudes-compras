/**
 * Controlador de productos / existencias del ERP.
 *  GET /api/productos/existencias?sku=FLT-4520&almacen=101
 *
 * `sku` acepta también texto parcial de la descripción, para que el
 * vendedor pueda buscar "filtro" y no solo el código exacto.
 *
 * LA EXISTENCIA NO SE FILTRA POR EMPRESA, Y ES A PROPÓSITO
 *   Todo lo demás en este sistema se separa entre CATOSA y CADUSA: los folios,
 *   los reportes, los usuarios. La existencia no. Un vendedor de CATOSA que no
 *   tiene la pieza necesita saber que está en Durango aunque Durango sea de
 *   CADUSA — ésa es justamente la razón por la que las dos empresas comparten
 *   este sistema.
 *
 *   Lo que sí se hace es DECIRLO: cada almacén viene etiquetado con su empresa
 *   y con `es_otra_empresa`, para que la pantalla pueda mostrar "hay 3 en
 *   Durango (CADUSA)" y nadie confunda una pieza ajena con una propia.
 */
import { consultarExistencias } from '../services/erp/index.js';
import { query, queryUno } from '../config/db.js';
import { badRequest } from '../utils/errors.js';

/**
 * Mapa clave de almacén -> { nombre, empresa }.
 *
 * Se arma con una sola consulta por petición. Son siete renglones: no vale la
 * pena ni cachearlo, y leerlo siempre significa que dar de alta una sucursal
 * nueva en la base se refleja de inmediato.
 */
async function directorioDeAlmacenes() {
  const filas = await query(
    `SELECT s.clave, s.nombre, s.id_empresa,
            e.clave AS empresa_clave, e.nombre AS empresa_nombre
     FROM      sucursales s
     LEFT JOIN empresas e ON e.id = s.id_empresa`,
  );
  return new Map(filas.map((f) => [String(f.clave), f]));
}

/** Le pega a un almacén su nombre y su empresa, vistos desde quien pregunta. */
function describirAlmacen(clave, directorio, idEmpresaDelUsuario) {
  const info = directorio.get(String(clave));
  if (!info) {
    // Un almacén que Quiter conoce y la base no. No se inventa a quién
    // pertenece: se devuelve tal cual y la pantalla lo muestra sin etiqueta.
    return { almacen: clave, nombre: null, empresa_clave: null, es_otra_empresa: null };
  }
  return {
    almacen: clave,
    nombre: info.nombre,
    empresa_clave: info.empresa_clave,
    empresa_nombre: info.empresa_nombre,
    es_otra_empresa: info.id_empresa !== null
      && Number(info.id_empresa) !== Number(idEmpresaDelUsuario),
  };
}

export async function existencias(req, res) {
  const termino = (req.query.sku ?? req.query.q ?? '').toString().trim();
  if (termino.length < 2) {
    throw badRequest('Indica al menos 2 caracteres en el parámetro `sku`');
  }

  // Si no se especifica almacén, usamos la clave de la sucursal del usuario.
  let almacen = (req.query.almacen ?? '').toString().trim();
  if (!almacen && req.usuario?.sucursal_id) {
    const suc = await queryUno(
      'SELECT clave FROM sucursales WHERE id = @id',
      { id: req.usuario.sucursal_id },
    );
    almacen = suc?.clave || '';
  }

  const [resultado, directorio] = await Promise.all([
    consultarExistencias({ termino, almacen }),
    directorioDeAlmacenes(),
  ]);

  const miEmpresa = req.usuario?.id_empresa;

  const articulos = resultado.articulos.map((a) => ({
    ...a,
    ...describirAlmacen(a.almacen, directorio, miEmpresa),
    existencia_otras_sucursales: (a.existencia_otras_sucursales ?? []).map((o) => ({
      ...o,
      ...describirAlmacen(o.almacen, directorio, miEmpresa),
      // El nombre que trae el ERP gana si lo trae: es el que la gente conoce.
      nombre: o.nombre ?? describirAlmacen(o.almacen, directorio, miEmpresa).nombre,
    })),
  }));

  res.json({
    ok: true,
    termino,
    ...resultado,
    articulos,
    // Atajo para la UI: ¿hay algo con existencia?
    hay_existencia: articulos.some((a) => Number(a.existencia) > 0),
    // ¿Y hay algo, aunque sea en la empresa hermana? Es lo que convierte un
    // "no hay" en una llamada telefónica en vez de una orden de compra.
    hay_en_otra_empresa: articulos.some((a) =>
      (a.existencia_otras_sucursales ?? []).some((o) => o.es_otra_empresa && o.existencia > 0)),
  });
}
