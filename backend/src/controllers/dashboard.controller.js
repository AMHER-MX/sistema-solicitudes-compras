/**
 * Controlador del dashboard gerencial.
 *  GET /api/dashboard/gerencia?dias=30&sucursal=1
 */
import { metricasGerencia } from '../services/solicitudes.service.js';

export async function gerencia(req, res) {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
  const metricas = await metricasGerencia({ dias, sucursal: req.query.sucursal });
  res.json({ ok: true, ...metricas });
}
