/**
 * Catálogos de apoyo que necesita el frontend para llenar sus selects.
 *  GET /api/catalogos/sucursales
 *  GET /api/catalogos/clientes?q=texto
 */
import { query } from '../config/db.js';
import { empresaParaConsulta } from '../utils/empresas.js';
import { buscarClientes } from '../services/clientes.service.js';

/**
 * Sucursales donde esta persona puede levantar documentos.
 *
 * Son las de SU empresa, no todas. Las de la empresa hermana se ven en la
 * consulta de existencias —ahí sí interesa saber que Durango tiene la pieza—
 * pero no son un lugar donde pueda capturar.
 */
export async function sucursales(req, res) {
  const empresa = empresaParaConsulta(req.usuario, req.query.empresa);

  const rows = await query(
    `SELECT s.id, s.clave, s.nombre, s.ciudad, s.id_empresa,
            e.clave AS empresa_clave, e.nombre AS empresa_nombre
     FROM      sucursales s
     LEFT JOIN empresas e ON e.id = s.id_empresa
     WHERE     s.activo
       AND (@empresa::int IS NULL OR s.id_empresa = @empresa::int)
     ORDER BY e.clave, s.nombre
     LIMIT 50`,
    { empresa },
  );
  res.json({ ok: true, sucursales: rows });
}

/** Las empresas que esta persona puede ver. Para el selector de quien ve ambas. */
export async function empresas(req, res) {
  const limite = empresaParaConsulta(req.usuario, undefined);
  const rows = await query(
    `SELECT id, clave, nombre FROM empresas
     WHERE activo AND (@empresa::int IS NULL OR id = @empresa::int)
     ORDER BY clave`,
    { empresa: limite },
  );
  res.json({ ok: true, empresas: rows, ve_todas: limite === null });
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
