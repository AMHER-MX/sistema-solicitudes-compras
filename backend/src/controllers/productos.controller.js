/**
 * Controlador de productos / existencias del ERP.
 *  GET /api/productos/existencias?sku=FLT-4520&almacen=SUC01
 *
 * `sku` acepta también texto parcial de la descripción, para que el
 * vendedor pueda buscar "filtro" y no solo el código exacto.
 */
import { consultarExistencias } from '../services/erp/index.js';
import { queryUno } from '../config/db.js';
import { badRequest } from '../utils/errors.js';

export async function existencias(req, res) {
  const termino = (req.query.sku ?? req.query.q ?? '').toString().trim();
  if (termino.length < 2) {
    throw badRequest('Indica al menos 2 caracteres en el parámetro `sku`');
  }

  // Si no se especifica almacén, usamos la clave de la sucursal del usuario.
  let almacen = (req.query.almacen ?? '').toString().trim();
  if (!almacen && req.usuario?.sucursal_id) {
    const suc = await queryUno(
      'SELECT clave FROM dbo.sucursales WHERE id = @id',
      { id: req.usuario.sucursal_id },
    );
    almacen = suc?.clave || '';
  }

  const resultado = await consultarExistencias({ termino, almacen });

  res.json({
    ok: true,
    termino,
    ...resultado,
    // Atajo para la UI: ¿hay algo con existencia?
    hay_existencia: resultado.articulos.some((a) => Number(a.existencia) > 0),
  });
}
