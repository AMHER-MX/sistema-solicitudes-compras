/**
 * Controlador del dashboard gerencial.
 *  GET /api/dashboard/gerencia?dias=30&sucursal=1
 */
import { query } from '../config/db.js';
import { metricasGerencia } from '../services/solicitudes.service.js';
import { empresaParaConsulta } from '../utils/empresas.js';

export async function gerencia(req, res) {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
  const idEmpresa = empresaParaConsulta(req.usuario, req.query.empresa);

  const metricas = await metricasGerencia({ dias, sucursal: req.query.sucursal, id_empresa: idEmpresa });

  // La pantalla necesita poder decir DE QUIÉN son estos números. Un dashboard
  // que no dice si trae una empresa o las dos es una junta con un malentendido
  // esperando a pasar.
  //
  // El nombre se consulta en vez de darlo por hecho: quien ve el grupo puede
  // pedir la empresa hermana, y entonces el suyo sería justo el equivocado
  // —números de CADUSA con el rótulo de CATOSA encima—, que es exactamente el
  // malentendido que este bloque existe para evitar.
  let empresa = { clave: null, nombre: 'Las dos empresas' };
  if (idEmpresa !== null) {
    empresa = idEmpresa === req.usuario.id_empresa
      ? { clave: req.usuario.empresa_clave, nombre: req.usuario.empresa_nombre }
      : (await query('SELECT clave, nombre FROM empresas WHERE id = @id', { id: idEmpresa }))[0]
        ?? { clave: null, nombre: 'Empresa desconocida' };
  }

  res.json({ ok: true, ...metricas, empresa });
}
