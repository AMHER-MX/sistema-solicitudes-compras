/**
 * Diagnóstico de la base de datos, en JSON.
 *
 *   cd backend && npm run db:estado
 *
 * Existe para poder decidir sin adivinar qué hacer con la base:
 *
 *   base inalcanzable  -> detenerse y decir por qué
 *   base vacía         -> instalar el esquema (db:setup)
 *   base con datos     -> solo migrar (db:migrar), nunca db:setup
 *
 * Esa última distinción es la importante: `db:setup` empieza tirando las
 * tablas. Correrlo por error sobre una base en uso borraría todas las
 * solicitudes capturadas, y no hay forma de deshacerlo.
 *
 * Imprime UNA sola línea de JSON en la salida estándar.
 */
import { cerrarPool, obtenerPool, query } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const base = {
  destino: env.db.url ? '(DATABASE_URL)' : `${env.db.host}:${env.db.port}/${env.db.database}`,
  conecta: false,
  esquema_listo: false,
  usuarios: 0,
  solicitudes: 0,
  cuentas_demo_activas: 0,
  columnas_de_usuarios_al_dia: false,
  accion_sugerida: 'revisar',
  error: null,
};

async function main() {
  // 1) ¿Se alcanza la base? Con la cadena de conexión ya se apunta a una base
  //    concreta, así que basta con preguntarle la hora.
  try {
    await obtenerPool();
    await query('SELECT 1');
    base.conecta = true;
  } catch (error) {
    base.error = error.message;
    base.accion_sugerida = 'revisar_conexion';
    return;
  }

  // 2) ¿Ya está el esquema?
  const [tabla] = await query("SELECT to_regclass('public.usuarios') AS existe");
  base.esquema_listo = tabla.existe !== null;

  if (!base.esquema_listo) {
    base.accion_sugerida = 'instalar_esquema';
    return;
  }

  const [conteos] = await query(`
    SELECT (SELECT COUNT(*) FROM usuarios)            AS usuarios,
           (SELECT COUNT(*) FROM solicitudes_compras) AS solicitudes,
           (SELECT COUNT(*) FROM usuarios
            WHERE activo AND email LIKE '%@demo.mx')  AS demo
  `);

  base.usuarios = Number(conteos.usuarios);
  base.solicitudes = Number(conteos.solicitudes);
  base.cuentas_demo_activas = Number(conteos.demo);

  // ¿Ya tiene las columnas de administración de usuarios?
  const [columnas] = await query(`
    SELECT COUNT(*) AS n
    FROM   information_schema.columns
    WHERE  table_name = 'usuarios'
      AND  column_name IN ('debe_cambiar_password', 'creado_por', 'password_actualizado_en')
  `);
  base.columnas_de_usuarios_al_dia = Number(columnas.n) === 3;

  // Con datos capturados, migrar. Vacía, da igual: migrar nunca destruye, así
  // que es la opción segura en ambos casos.
  base.accion_sugerida = 'migrar';
}

main()
  .catch((error) => {
    base.error = error.message;
    base.accion_sugerida = 'revisar';
  })
  .finally(async () => {
    await cerrarPool().catch(() => {});
    process.stdout.write(`${JSON.stringify(base)}\n`);
    // Código de salida 0 siempre: el diagnóstico se lee del JSON, no del código.
    process.exit(0);
  });
