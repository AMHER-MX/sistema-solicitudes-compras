/**
 * Conexión a la base de datos PROPIA del sistema (PostgreSQL).
 *
 * Aquí viven las solicitudes, sus partidas y la bitácora. Es una base aparte de
 * Quiter: el ERP se lee y nunca se escribe.
 *
 * Exporta:
 *   query(sql, params)        -> ejecuta una consulta y devuelve los renglones
 *   queryUno(sql, params)     -> solo el primer renglón
 *   withTransaction(fn)       -> BEGIN / COMMIT / ROLLBACK automático
 *   probarConexion()          -> chequeo de salud
 *
 * ── Sobre los parámetros con nombre ────────────────────────────────────────
 * PostgreSQL numera los parámetros ($1, $2, ...). Eso es incómodo de leer y
 * fácil de romper: basta agregar un filtro a la mitad de una consulta para
 * tener que renumerar todo lo que sigue, y el error resultante —un valor
 * puesto en el lugar equivocado— no truena, simplemente devuelve datos mal.
 *
 * Por eso las consultas se escriben con nombres (@vendedor, @desde) y aquí se
 * traducen a la numeración que espera el driver. El texto que llega a la base
 * es SQL parametrizado de verdad: los valores viajan aparte, nunca pegados a
 * la consulta.
 */
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

/**
 * Compatibilidad: antes, con SQL Server, algunas consultas declaraban el tipo
 * de un parámetro para poder mandar NULL. En PostgreSQL eso se resuelve con un
 * cast en el propio SQL (`$1::int`), así que aquí los tipos son sellos vacíos.
 * Se conservan para no tener que tocar cada consulta del sistema.
 */
export const T = new Proxy({}, { get: () => 'sin-tipo' });

// ── Modo "ensayo" ───────────────────────────────────────────────────────────
// Con SGC_DRY_RUN=1 no se conecta a nada: cada consulta se registra en lugar
// de ejecutarse. Sirve para revisar el SQL que emite la aplicación sin tener
// una base delante (lo usa scripts/validarSql.js).
const ensayo = process.env.SGC_DRY_RUN === '1';
export const sqlEmitido = [];

/**
 * Gancho opcional para el modo ensayo: recibe el texto del SQL y devuelve los
 * renglones que debe fingir la consulta, o `undefined` para dejar el renglón
 * genérico de abajo.
 */
let ganchoEnsayo = null;
export const definirRespuestaEnsayo = (fn) => { ganchoEnsayo = fn; };

const registrar = (sqlText) => {
  sqlEmitido.push(sqlText);
  if (ganchoEnsayo) {
    const respuesta = ganchoEnsayo(sqlText);
    if (respuesta !== undefined) return respuesta;
  }
  return [{ id: 1, estatus_actual: 'Pendiente', clave: '101', ahora: new Date() }];
};

/**
 * Traduce `@nombre` a `$n` y arma el arreglo de valores en el orden correcto.
 *
 * Recorre el texto carácter por carácter en lugar de usar una expresión
 * regular porque el SQL del sistema contiene arrobas que NO son parámetros:
 * `email LIKE '%@demo.mx'`. Una expresión regular convertiría ese pedazo de
 * texto en un parámetro y la consulta dejaría de funcionar. También se saltan
 * los comentarios, por la misma razón.
 *
 * @param {string} sqlText
 * @param {Record<string, unknown>} params
 * @returns {{ texto: string, valores: unknown[] }}
 */
export function traducirParametros(sqlText, params = {}) {
  const valores = [];
  const posiciones = new Map(); // nombre -> índice ya asignado
  let salida = '';
  let i = 0;

  while (i < sqlText.length) {
    const c = sqlText[i];

    // Cadena de texto: se copia tal cual hasta la comilla de cierre.
    // Dentro, '' es una comilla escapada y no termina la cadena.
    if (c === "'") {
      salida += c; i += 1;
      while (i < sqlText.length) {
        if (sqlText[i] === "'" && sqlText[i + 1] === "'") { salida += "''"; i += 2; continue; }
        salida += sqlText[i];
        if (sqlText[i] === "'") { i += 1; break; }
        i += 1;
      }
      continue;
    }

    // Comentario de línea.
    if (c === '-' && sqlText[i + 1] === '-') {
      while (i < sqlText.length && sqlText[i] !== '\n') { salida += sqlText[i]; i += 1; }
      continue;
    }

    // Comentario de bloque.
    if (c === '/' && sqlText[i + 1] === '*') {
      while (i < sqlText.length && !(sqlText[i] === '*' && sqlText[i + 1] === '/')) {
        salida += sqlText[i]; i += 1;
      }
      salida += '*/'; i += 2;
      continue;
    }

    // Parámetro.
    if (c === '@' && /[A-Za-z_]/.test(sqlText[i + 1] ?? '')) {
      let j = i + 1;
      while (j < sqlText.length && /[A-Za-z0-9_]/.test(sqlText[j])) j += 1;
      const nombre = sqlText.slice(i + 1, j);

      if (!posiciones.has(nombre)) {
        if (!(nombre in params)) {
          throw new Error(`La consulta usa @${nombre} pero no se le pasó ese parámetro`);
        }
        const dato = params[nombre];
        // Compatibilidad con la forma { tipo, valor } que usaba SQL Server.
        const valor = (dato !== null && typeof dato === 'object' && 'valor' in dato)
          ? dato.valor
          : dato;
        valores.push(valor === undefined ? null : valor);
        posiciones.set(nombre, valores.length);
      }
      salida += `$${posiciones.get(nombre)}`;
      i = j;
      continue;
    }

    salida += c;
    i += 1;
  }

  return { texto: salida, valores };
}

let poolPromesa = null;

/** Pool único, reutilizado por todo el proceso. */
export function obtenerPool() {
  if (!poolPromesa) {
    const pool = new Pool({
      ...(env.db.url
        // Railway (y casi cualquier hospedaje) entrega una sola cadena de
        // conexión. Si está, manda sobre los valores sueltos.
        ? { connectionString: env.db.url }
        : {
          host: env.db.host,
          port: env.db.port,
          database: env.db.database,
          user: env.db.user,
          password: env.db.password,
        }),
      ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    // Sin este manejador, un corte de red tumba el proceso entero.
    pool.on('error', (error) => {
      console.error('[BD] Error inesperado en el pool:', error.message);
    });

    poolPromesa = Promise.resolve(pool);
  }
  return poolPromesa;
}

/**
 * Ejecuta una consulta y devuelve el arreglo de renglones.
 * Todo valor variable DEBE ir como parámetro, nunca concatenado en el texto.
 */
export async function query(sqlText, params = {}) {
  if (ensayo) return registrar(sqlText);
  const pool = await obtenerPool();
  const { texto, valores } = traducirParametros(sqlText, params);
  const resultado = await pool.query(texto, valores);
  return resultado.rows ?? [];
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
 */
export async function withTransaction(fn) {
  if (ensayo) return fn(async (sqlText) => registrar(sqlText));

  const pool = await obtenerPool();
  const cliente = await pool.connect();

  const ejecutar = async (sqlText, params = {}) => {
    const { texto, valores } = traducirParametros(sqlText, params);
    const resultado = await cliente.query(texto, valores);
    return resultado.rows ?? [];
  };

  try {
    await cliente.query('BEGIN');
    const resultado = await fn(ejecutar);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try { await cliente.query('ROLLBACK'); } catch { /* ya estaba deshecha */ }
    throw error;
  } finally {
    cliente.release(); // siempre devolver la conexión al pool
  }
}

/** Verificación de salud usada por /api/health y al arrancar el servidor. */
export async function probarConexion() {
  const fila = await queryUno('SELECT NOW() AS ahora');
  return fila.ahora;
}

/** Cierre ordenado del pool. */
export async function cerrarPool() {
  if (!poolPromesa) return;
  try {
    const pool = await poolPromesa;
    await pool.end();
  } catch { /* ya estaba cerrado */ } finally {
    poolPromesa = null;
  }
}
