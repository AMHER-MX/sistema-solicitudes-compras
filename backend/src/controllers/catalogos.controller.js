/**
 * Catálogos de apoyo que necesita el frontend para llenar sus selects.
 *  GET /api/catalogos/sucursales
 *  GET /api/catalogos/clientes?q=texto
 */
import { query } from '../config/db.js';

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

export async function clientes(req, res) {
  const q = (req.query.q ?? '').toString().trim();

  const rows = await query(
    `SELECT id, codigo_erp, nombre, rfc
     FROM   clientes
     WHERE  activo
       AND (@q = '' OR nombre ILIKE @patron OR codigo_erp ILIKE @patron)
     ORDER BY nombre
     LIMIT 50`,
    { q, patron: `%${q}%` },
  );

  res.json({ ok: true, clientes: rows });
}
