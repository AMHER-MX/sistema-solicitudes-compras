/**
 * Cliente de SOLO LECTURA contra la base de datos SQL Server del ERP Quiter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ESTE ES EL ORIGEN DE DATOS RECOMENDADO PARA PRODUCCIÓN
 * ─────────────────────────────────────────────────────────────────────────────
 * Es el mismo camino que ya usa la app de Ventas de refacciones (catosa-api):
 * conexión directa a SQL Server con el driver `mssql`, sin API intermedia.
 *
 * Reglas de seguridad que este módulo respeta y que NO deben relajarse:
 *   1. El usuario de base de datos debe ser de SOLO LECTURA (ver README §6).
 *      Este archivo únicamente ejecuta SELECT; nunca INSERT/UPDATE/DELETE.
 *   2. Todo valor que venga del usuario viaja como parámetro (`.input(...)`),
 *      nunca concatenado en el SQL. Eso cierra la puerta a inyección SQL.
 *   3. Las credenciales viven en el .env, jamás en el código ni en el repo.
 *
 * Tabla consultada: FTIGBI_PR (inventario de refacciones)
 *   ARTICULO      -> número de parte (SKU)
 *   DES_ARTICULO  -> descripción
 *   EXIS_REALES   -> existencia real (esta es LA cifra que nos interesa)
 *   COSTO_MEDIO   -> costo medio
 *   UBICACION     -> ubicación física en el almacén
 *   ALMACEN       -> clave de almacén, TEXTO: '101', '102', '101LA', '102LA'
 */
import sql from 'mssql';
import { env } from '../../config/env.js';

/** ¿Está configurada la conexión a SQL Server? */
export const sqlServerConfigurado = () =>
  Boolean(env.erpSql.host && env.erpSql.database && env.erpSql.user);

const configuracion = () => ({
  server: env.erpSql.host,
  port: env.erpSql.port,
  database: env.erpSql.database,
  user: env.erpSql.user,
  password: env.erpSql.password,
  options: {
    // encrypt=true cifra el tráfico entre esta API y SQL Server.
    // Solo se desactiva si el servidor es antiguo y no lo soporta.
    encrypt: env.erpSql.encrypt,
    trustServerCertificate: env.erpSql.trustServerCertificate,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  connectionTimeout: env.erpSql.timeoutMs,
  requestTimeout: env.erpSql.timeoutMs,
});

// Un solo pool reutilizado por todo el proceso.
let poolPromesa = null;

async function obtenerPool() {
  if (!poolPromesa) {
    poolPromesa = new sql.ConnectionPool(configuracion())
      .connect()
      .catch((error) => {
        poolPromesa = null; // permite reintentar en la siguiente petición
        throw error;
      });
  }
  return poolPromesa;
}

/** Cierra el pool (lo usa el apagado ordenado del servidor). */
export async function cerrarPoolSqlServer() {
  if (!poolPromesa) return;
  try {
    const pool = await poolPromesa;
    await pool.close();
  } catch {
    /* si ya estaba cerrado, no hay nada que hacer */
  } finally {
    poolPromesa = null;
  }
}

/**
 * Consulta existencias por número de parte o por descripción.
 *
 * Nota sobre la consulta — dos detalles que importan:
 *
 *   a) `i.ALMACEN = @almacen` compara TEXTO contra TEXTO. La columna ALMACEN
 *      guarda valores como '101LA', así que compararla contra un número
 *      (ALMACEN = 101) obliga a SQL Server a convertir cada renglón a entero
 *      y revienta con "Conversion failed... to data type int".
 *
 *   b) Las condiciones del OR van entre PARÉNTESIS. Sin ellos, el AND toma
 *      precedencia sobre el OR y la búsqueda por descripción se escapa del
 *      filtro de almacén, trayendo renglones de toda la empresa.
 *
 * @param {string} termino  número de parte o texto de la descripción
 * @param {string} almacen  clave de almacén de la sucursal que consulta
 * @param {number} limite   máximo de artículos distintos a devolver
 */
export async function consultarExistenciasSqlServer(termino, almacen, limite = 20) {
  const pool = await obtenerPool();
  const almacenes = env.erpSql.almacenes; // ej. ['101','102','101LA','102LA']

  const peticion = pool.request();
  // Lista IN parametrizada: @alm0, @alm1, ... (nunca concatenamos valores).
  almacenes.forEach((clave, i) => peticion.input(`alm${i}`, sql.VarChar(20), clave));
  peticion.input('almacen', sql.VarChar(20), almacen);
  peticion.input('busqueda', sql.VarChar(120), `%${termino}%`);
  peticion.input('exacto', sql.VarChar(120), termino);
  peticion.input('limite', sql.Int, limite);

  const { recordset } = await peticion.query(construirSqlExistencias(almacenes));
  return agruparPorArticulo(recordset, almacen);
}

/**
 * Arma el SQL de existencias. Se mantiene aparte de la conexión para poder
 * probarlo sin una base de datos (ver scripts/testErpSql.js).
 *
 * 1) `coincidencias` elige los artículos que empatan, priorizando los que SÍ
 *    hay en el almacén de quien consulta.
 * 2) El SELECT exterior trae todos sus renglones por almacén, para poder
 *    decirle al vendedor si otra sucursal puede surtirlo.
 *
 * @param {string[]} almacenes claves de almacén a considerar
 */
export function construirSqlExistencias(almacenes) {
  // Solo se interpolan nombres de parámetro (@alm0, @alm1...), nunca valores.
  const listaAlmacenes = almacenes.map((_, i) => `@alm${i}`).join(', ');

  return `
    WITH coincidencias AS (
      SELECT TOP (@limite) i.ARTICULO
      FROM   FTIGBI_PR i
      WHERE  i.ALMACEN IN (${listaAlmacenes})
        AND (i.ARTICULO = @exacto OR i.ARTICULO LIKE @busqueda OR i.DES_ARTICULO LIKE @busqueda)
      GROUP BY i.ARTICULO
      ORDER BY
        -- primero coincidencia exacta de número de parte
        MAX(CASE WHEN i.ARTICULO = @exacto THEN 1 ELSE 0 END) DESC,
        -- luego lo que hay en el almacén consultado
        SUM(CASE WHEN i.ALMACEN = @almacen THEN i.EXIS_REALES ELSE 0 END) DESC,
        i.ARTICULO ASC
    )
    SELECT i.ARTICULO, i.DES_ARTICULO, i.ALMACEN, i.NOM_ALMACEN,
           i.EXIS_REALES, i.COSTO_MEDIO, i.UBICACION
    FROM   FTIGBI_PR i
    JOIN   coincidencias c ON c.ARTICULO = i.ARTICULO
    WHERE  i.ALMACEN IN (${listaAlmacenes})
    ORDER BY i.ARTICULO ASC, i.ALMACEN ASC
  `;
}

/**
 * Convierte los renglones (un renglón por artículo+almacén) al contrato
 * interno del sistema: un objeto por artículo, con la existencia del almacén
 * consultado y el desglose de las demás sucursales.
 */
export function agruparPorArticulo(renglones, almacenConsultado) {
  const porArticulo = new Map();

  for (const r of renglones) {
    const sku = (r.ARTICULO ?? '').toString().trim();
    if (!sku) continue;

    if (!porArticulo.has(sku)) {
      porArticulo.set(sku, {
        sku,
        descripcion: (r.DES_ARTICULO ?? '').toString().trim(),
        linea: null,
        precio_lista: Number(r.COSTO_MEDIO ?? 0),
        ubicacion: (r.UBICACION ?? '').toString().trim() || null,
        almacen: almacenConsultado,
        existencia: 0,
        // Mapa clave -> total, porque Quiter puede traer VARIOS renglones del
        // mismo artículo en el mismo almacén y hay que sumarlos, no listarlos
        // por separado (comprobado con datos reales: Durango aparecía dos veces).
        _otras: new Map(),
      });
    }

    const articulo = porArticulo.get(sku);
    const clave = (r.ALMACEN ?? '').toString().trim();
    const cantidad = Number(r.EXIS_REALES ?? 0);

    if (clave === almacenConsultado) {
      articulo.existencia += cantidad;
      // La ubicación útil es la del almacén propio.
      if (r.UBICACION) articulo.ubicacion = r.UBICACION.toString().trim();
    } else {
      const previo = articulo._otras.get(clave) ?? {
        almacen: clave,
        nombre: (r.NOM_ALMACEN ?? '').toString().trim() || null,
        existencia: 0,
      };
      previo.existencia += cantidad;
      articulo._otras.set(clave, previo);
    }
  }

  // Solo se reportan las sucursales que realmente pueden surtir.
  return [...porArticulo.values()].map(({ _otras, ...articulo }) => ({
    ...articulo,
    existencia_otras_sucursales: [..._otras.values()]
      .filter((o) => o.existencia > 0)
      .sort((a, b) => b.existencia - a.existencia),
  }));
}

/** Prueba de conectividad para /api/health. */
export async function probarSqlServer() {
  const pool = await obtenerPool();
  const { recordset } = await pool.request().query('SELECT 1 AS ok');
  return recordset[0]?.ok === 1;
}
