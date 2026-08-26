/**
 * Catálogos de apoyo que necesita el frontend para llenar sus selects.
 *  GET /api/catalogos/sucursales
 *  GET /api/catalogos/clientes?q=texto
 */
import { query } from '../config/db.js';
import { buscarClientes } from '../services/clientes.service.js';

export async function sucursales(_req, res) {
  const rows = await query(
    `SELECT id, clave, nombre, ciudad
     FROM   sucursales
     WHERE  activo
     ORDER BY nombre
     LIMIT 50`,
  );
  res.json({ ok: true, sucursales: rows });
}

/**
 * Buscador de clientes.
 *
 * Los clientes vienen del padrón de Quiter, que el vigía copia a la base local
 * cada hora. Se busca aquí y no contra el ERP porque su API devuelve el padrón
 * completo sin filtro: buscar en vivo sería bajar cientos de renglones en cada
 * tecla que teclea el vendedor.
 */
export async function clientes(req, res) {
  const resultado = await buscarClientes(req.query.q ?? '');
  res.json({ ok: true, ...resultado });
}
