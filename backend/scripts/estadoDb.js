/**
 * Diagnóstico de la base de datos, en JSON.
 *
 *   cd backend && npm run db:estado
 *
 * Existe para que el script de despliegue pueda decidir solo, sin adivinar,
 * qué hacer con la base:
 *
 *   servidor inalcanzable  -> detenerse y decir por qué
 *   la base no existe      -> ofrecerse a crearla
 *   base vacía             -> instalar el esquema (db:setup)
 *   base con datos         -> solo migrar (db:migrar), nunca db:setup
 *
 * Esa última distinción es la importante: `db:setup` empieza tirando las
 * tablas. Correrlo por error sobre una base en uso borraría todas las
 * solicitudes capturadas, y no hay forma de deshacerlo.
 *
 * Imprime UNA sola línea de JSON en la salida estándar. Los mensajes para
 * personas van a la salida de error, para no ensuciar el JSON.
 */
import sql from 'mssql';
import { env } from '../src/config/env.js';

const base = {
  servidor: `${env.db.host}:${env.db.port}`,
  base_datos: env.db.database,
  conecta: false,
  base_existe: false,
  esquema_listo: false,
  usuarios: 0,
  solicitudes: 0,
  cuentas_demo_activas: 0,
  columnas_de_usuarios_al_dia: false,
  accion_sugerida: 'revisar',
  error: null,
};

const configuracion = (nombreBase) => ({
  server: env.db.host,
  port: env.db.port,
  database: nombreBase,
  user: env.db.user,
  password: env.db.password,
  options: {
    encrypt: env.db.encrypt,
    trustServerCertificate: env.db.trustServerCertificate,
    useUTC: true,
  },
  connectionTimeout: 15_000,
  requestTimeout: 20_000,
  pool: { max: 2, min: 0, idleTimeoutMillis: 5_000 },
});

async function main() {
  // 1) ¿Se alcanza el servidor? Se pregunta contra master, que siempre existe:
  //    así se distingue "no hay servidor" de "no existe la base".
  let pool;
  try {
    pool = await new sql.ConnectionPool(configuracion('master')).connect();
    base.conecta = true;
  } catch (error) {
    base.error = error.message;
    base.accion_sugerida = 'revisar_conexion';
    return;
  }

  try {
    const { recordset } = await pool.request()
      .input('nombre', sql.NVarChar, env.db.database)
      .query('SELECT name FROM sys.databases WHERE name = @nombre');
    base.base_existe = recordset.length > 0;
  } finally {
    await pool.close();
  }

  if (!base.base_existe) {
    base.accion_sugerida = 'crear_base';
    return;
  }

  // 2) La base existe: ver qué tiene dentro.
  const propio = await new sql.ConnectionPool(configuracion(env.db.database)).connect();
  try {
    const [tabla] = (await propio.request().query(
      "SELECT OBJECT_ID('dbo.usuarios') AS id",
    )).recordset;
    base.esquema_listo = tabla.id !== null;

    if (!base.esquema_listo) {
      base.accion_sugerida = 'instalar_esquema';
      return;
    }

    const [conteos] = (await propio.request().query(`
      SELECT (SELECT COUNT(*) FROM dbo.usuarios)            AS usuarios,
             (SELECT COUNT(*) FROM dbo.solicitudes_compras) AS solicitudes,
             (SELECT COUNT(*) FROM dbo.usuarios
              WHERE activo = 1 AND email LIKE '%@demo.mx')  AS demo
    `)).recordset;

    base.usuarios = conteos.usuarios;
    base.solicitudes = conteos.solicitudes;
    base.cuentas_demo_activas = conteos.demo;

    // ¿Ya tiene las columnas de administración de usuarios?
    const [columnas] = (await propio.request().query(`
      SELECT CASE WHEN COL_LENGTH('dbo.usuarios','debe_cambiar_password') IS NOT NULL
                   AND COL_LENGTH('dbo.usuarios','creado_por') IS NOT NULL
                   AND COL_LENGTH('dbo.usuarios','password_actualizado_en') IS NOT NULL
                  THEN 1 ELSE 0 END AS al_dia
    `)).recordset;
    base.columnas_de_usuarios_al_dia = columnas.al_dia === 1;

    // Con datos capturados, migrar. Vacía, da igual, pero migrar también sirve
    // y nunca destruye: es la opción segura en ambos casos.
    base.accion_sugerida = 'migrar';
  } finally {
    await propio.close();
  }
}

main()
  .catch((error) => {
    base.error = error.message;
    base.accion_sugerida = 'revisar';
  })
  .finally(() => {
    process.stdout.write(`${JSON.stringify(base)}\n`);
    // Código de salida 0 siempre: el diagnóstico se lee del JSON, no del código.
    // Si saliera con error, PowerShell lo trataría como falla del comando.
    process.exit(0);
  });
