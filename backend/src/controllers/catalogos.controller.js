/**
 * Catálogos de apoyo que necesita el frontend para llenar sus selects.
 *  GET /api/catalogos/sucursales
 *  GET /api/catalogos/clientes?q=texto
 */
import { query } from '../config/db.js';

export async function sucursales(_req, res) {
  const rows = await query(
    `SELECT id, clave, nombre, ciudad
     FROM   dbo.sucursales
     WHERE  activo = 1
     ORDER BY nombre`,
  );
  res.json({ ok: true, sucursales: rows });
}

export async function clientes(req, res) {
  const q = (req.query.q ?? '').toString().trim();

  const rows = await query(
    `SELECT TOP (50) id, codigo_erp, nombre, rfc
     FROM   dbo.clientes
     WHERE  activo = 1
       AND (@q = '' OR nombre LIKE @patron OR codigo_erp LIKE @patron)
     ORDER BY nombre`,
    { q, patron: `%${q}%` },
  );

  res.json({ ok: true, clientes: rows });
}
