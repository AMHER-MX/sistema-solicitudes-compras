/**
 * Conexión a la base de datos PROPIA del sistema (SQL Server).
 *
 * Aquí viven las solicitudes, sus partidas y la bitácora. Es una base aparte
 * (SGC_COMPRAS) en el mismo servidor donde está Quiter: mismo respaldo y misma
 * administración, pero sin ninguna posibilidad de tocar el esquema del ERP.
 *
 * Exporta:
 *   query(sql, params)        -> ejecuta una consulta y devuelve los renglones
 *   withTransaction(fn)       -> BEGIN / COMMIT / ROLLBACK automático
 *   T                         -> tipos de dato, para parámetros explícitos
 *   probarConexion()          -> chequeo de salud
 */
import sql from 'mssql';
import { env } from './env.js';

/** Tipos de dato de SQL Server, para cuando haga falta ser explícito. */
export const T = sql;

const configuracion = {
  server: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  options: {
    encrypt: env.db.encrypt,
    trustServerCertificate: env.db.trustServerCertificate,
    // Evita que las fechas se conviertan a la zona horaria local del servidor.
    useUTC: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
  connectionTimeout: 15_000,
  requestTimeout: 30_000,
};

// ── Modo "ensayo" ───────────────────────────────────────────────────────────
// Con SGC_DRY_RUN=1 no se conecta a nada: cada consulta se registra en lugar
// de ejecutarse. Sirve para revisar el SQL que emite la aplicación sin tener
// un servidor delante (lo usa scripts/validarSql.js).
const ensayo = process.env.SGC_DRY_RUN === '1';
export const sqlEmitido = [];
const registrar = (sqlText) => {
  sqlEmitido.push(sqlText);
  // Renglón ficticio: suficiente para que el código que encadena consultas
  // (por ejemplo, usar el id recién insertado) siga su curso.
  return [{ id: 1, estatus_actual: 'Pendiente', clave: '101', ahora: new Date() }];
};

let poolPromesa = null;

/** Pool único, reutilizado por todo el proceso. */
export async function obtenerPool() {
  if (!poolPromesa) {
    poolPromesa = new sql.ConnectionPool(configuracion)
      .connect()
      .catch((error) => {
        poolPromesa = null; // permite reintentar en la siguiente petición
        throw error;
      });
  }
  return poolPromesa;
}

/**
 * Agrega los parámetros a una petición de mssql.
 *
 * Cada parámetro puede ser un valor suelto (mssql infiere el tipo) o un objeto
 * `{ tipo, valor }` cuando hace falta forzarlo — típicamente con NULL, donde
 * no hay nada de dónde inferir.
 *
 * @example
 *   query('SELECT * FROM t WHERE id = @id', { id: 5 })
 *   query('... @obs', { obs: { tipo: T.NVarChar, valor: null } })
 */
function agregarParametros(peticion, params = {}) {
  for (const [nombre, dato] of Object.entries(params)) {
    if (dato !== null && typeof dato === 'object' && 'valor' in dato) {
      peticion.input(nombre, dato.tipo, dato.valor);
    } else if (dato === null || dato === undefined) {
      // Sin tipo explícito, un NULL suelto se manda como NVARCHAR.
      peticion.input(nombre, sql.NVarChar, null);
    } else {
      peticion.input(nombre, dato);
    }
  }
  return peticion;
}

/**
 * Ejecuta una consulta y devuelve el arreglo de renglones.
 * Todo valor variable DEBE ir como parámetro, nunca concatenado en el texto.
 */
export async function query(sqlText, params = {}) {
  if (ensayo) return registrar(sqlText);
  const pool = await obtenerPool();
  const resultado = await agregarParametros(pool.request(), params).query(sqlText);
  return resultado.recordset ?? [];
}

/** Igual que `query`, pero devuelve solo el primer renglón (o undefined). */
export async function queryUno(sqlText, params = {}) {
  const filas = await query(sqlText, params);
  return filas[0];
}

/**
 * Envuelve varias consultas en una sola transacción.
 * Si el callback lanza un error se hace ROLLBACK automáticamente.
 *
 * El callback recibe una función `ejecutar(sql, params)` que corre dentro
 * de la transacción.
 *
 * @example
 *   const solicitud = await withTransaction(async (ejecutar) => {
 *     const [fila] = await ejecutar('INSERT ... OUTPUT INSERTED.* VALUES (@a)', { a: 1 });
 *     return fila;
 *   });
 */
export async function withTransaction(fn) {
  if (ensayo) return fn(async (sqlText) => registrar(sqlText));
  const pool = await obtenerPool();
  const transaccion = new sql.Transaction(pool);
  await transaccion.begin();

  const ejecutar = async (sqlText, params = {}) => {
    const peticion = agregarParametros(new sql.Request(transaccion), params);
    const resultado = await peticion.query(sqlText);
    return resultado.recordset ?? [];
  };

  try {
    const resultado = await fn(ejecutar);
    await transaccion.commit();
    return resultado;
  } catch (error) {
    try { await transaccion.rollback(); } catch { /* ya estaba deshecha */ }
    throw error;
  }
}

/** Verificación de salud usada por /api/health y al arrancar el servidor. */
export async function probarConexion() {
  const fila = await queryUno('SELECT SYSUTCDATETIME() AS ahora');
  return fila.ahora;
}

/** Cierre ordenado del pool. */
export async function cerrarPool() {
  if (!poolPromesa) return;
  try {
    const pool = await poolPromesa;
    await pool.close();
  } catch { /* ya estaba cerrado */ } finally {
    poolPromesa = null;
  }
}
