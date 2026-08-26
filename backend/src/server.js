/**
 * Punto de entrada del backend.
 *   npm run dev    -> con recarga automática
 *   npm start      -> producción
 */
import { RUTA_INTERFAZ, crearApp } from './app.js';
import { env } from './config/env.js';
import { cerrarPool, probarConexion } from './config/db.js';
import { estadoErp } from './services/erp/index.js';
import { cuentasDemoActivas } from './services/usuarios.service.js';
import { detenerVigia, iniciarVigia } from './services/vigia.js';

/**
 * Avisa si las cuentas de demostración siguen activas.
 *
 * Son cuatro cuentas con la misma contraseña conocida (demo1234) que carga el
 * seed. Sirven para probar, pero en el servidor de producción son una puerta
 * abierta: cualquiera que haya visto el README puede entrar como Gerente.
 * En producción el aviso es grande y con instrucciones.
 */
async function avisarCuentasDemo() {
  let demo = [];
  try {
    demo = await cuentasDemoActivas();
  } catch {
    return; // si la tabla aún no existe, no es momento de avisar nada
  }
  if (demo.length === 0) return;

  if (env.nodeEnv === 'production') {
    console.warn('──────────────────────────────────────────────');
    console.warn(` ⚠  ATENCIÓN: hay ${demo.length} cuenta(s) de PRUEBA activas en producción.`);
    for (const u of demo) console.warn(`      ${u.email}  (${u.rol})`);
    console.warn('    Todas usan la misma contraseña, que está en el README.');
    console.warn('    Desactívalas desde la pantalla Usuarios antes de dar acceso a nadie.');
  } else {
    console.log(` Cuentas demo: ${demo.length} activas (${demo.map((u) => u.email).join(', ')})`);
  }
}

const app = crearApp();

const servidor = app.listen(env.port, async () => {
  console.log('──────────────────────────────────────────────');
  console.log(` SGC Compras API escuchando en :${env.port}`);
  console.log(` Entorno    : ${env.nodeEnv}`);
  console.log(` CORS       : ${env.corsOrigin.join(', ')}`);

  const { existsSync } = await import('node:fs');
  const conInterfaz = existsSync(`${RUTA_INTERFAZ}/index.html`);
  console.log(` Interfaz   : ${conInterfaz
    ? `servida desde este mismo servidor -> http://localhost:${env.port}`
    : 'no compilada (en desarrollo la sirve Vite en :5173)'}`);

  const erp = await estadoErp();
  const descripcionErp = {
    QUITER_API: () => `API de refacciones ${erp.api.base_url}`,
    MOCK: () => 'NO configurado (usando catálogo simulado)',
  }[erp.origen];
  console.log(` ERP        : ${descripcionErp()}`);

  try {
    const hora = await probarConexion();
    console.log(` Base       : conectada (${hora.toISOString()})`);
    await avisarCuentasDemo();
    // Solo con base viva: sin ella el vigía no tendría qué vencer y estaría
    // gritando errores cada hora sin que nadie pueda hacer nada.
    iniciarVigia();
  } catch (e) {
    console.error(` Base       : SIN CONEXIÓN -> ${e.message}`);
    console.error('   Revisa DATABASE_URL o las variables DB_* en tu archivo .env');
  }
  console.log('──────────────────────────────────────────────');
});

// Cierre ordenado: deja de aceptar conexiones y libera el pool.
const cerrar = (senal) => async () => {
  console.log(`\n[${senal}] Cerrando servidor...`);
  detenerVigia();
  servidor.close(async () => {
    await cerrarPool();
    process.exit(0);
  });
};

process.on('SIGINT', cerrar('SIGINT'));
process.on('SIGTERM', cerrar('SIGTERM'));
