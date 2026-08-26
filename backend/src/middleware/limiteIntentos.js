/**
 * Freno a los intentos de adivinar contraseñas.
 *
 * POR QUÉ HACE FALTA
 *   Al publicar el sistema por el túnel, la pantalla de entrada queda expuesta
 *   a internet. Sin un freno, un programa puede probar miles de contraseñas por
 *   minuto contra una cuenta hasta atinarle. No es un ataque sofisticado: es lo
 *   primero que hace cualquier robot que encuentra un formulario de login.
 *
 * CÓMO FUNCIONA
 *   1. Por cuenta: 8 intentos fallidos en 15 minutos y ese correo queda
 *      bloqueado el resto de la ventana. Un intento correcto borra el contador,
 *      así que quien sí sabe su contraseña nunca se topa con esto.
 *   2. Freno general: si en la ventana hay MUCHOS fallos repartidos entre
 *      distintos correos —lo típico cuando alguien prueba una contraseña común
 *      contra todo el directorio—, cada respuesta de login empieza a tardar dos
 *      segundos. Nadie se queda fuera; el ataque simplemente deja de ser
 *      práctico.
 *
 * POR QUÉ NO SE LIMITA POR DIRECCIÓN IP
 *   Detrás del túnel de Cloudflare, todas las peticiones le llegan a Node desde
 *   127.0.0.1. Limitar por IP bloquearía a toda la empresa de un golpe. La IP
 *   real viene en un encabezado que se puede falsificar, y confiar en él abre
 *   la puerta a que alguien bloquee a un usuario legítimo a propósito. Limitar
 *   por cuenta no tiene ninguno de los dos problemas.
 *
 * ALCANCE
 *   El contador vive en memoria: se reinicia si se reinicia el servicio, y no
 *   se comparte entre procesos. Para un solo Node en el servidor de la empresa
 *   es justo lo que se necesita. Si algún día corren varias instancias, esto
 *   tendría que moverse a la base o a Redis.
 */
import { ApiError } from '../utils/errors.js';

/** Ventana de observación. */
const VENTANA_MS = 15 * 60 * 1000;

/** Fallos tolerados por cuenta dentro de la ventana. */
const MAX_FALLOS_POR_CUENTA = 8;

/** A partir de aquí, el freno general empieza a demorar cada respuesta. */
const FALLOS_PARA_FRENO_GENERAL = 100;

/** Cuánto se demora cada respuesta con el freno general puesto. */
const DEMORA_MS = 2000;

/**
 * Tope de correos distintos que se recuerdan. Evita que alguien haga crecer la
 * memoria del proceso mandando millones de correos inventados.
 */
const MAX_CUENTAS_RECORDADAS = 5000;

/** correo -> { fallos, expira } */
const porCuenta = new Map();

/** Fallos de todas las cuentas juntas dentro de la ventana. */
let fallosGlobales = [];

const ahora = () => Date.now();

/** Tira lo que ya salió de la ventana. */
function purgar() {
  const t = ahora();
  for (const [clave, dato] of porCuenta) {
    if (dato.expira <= t) porCuenta.delete(clave);
  }
  fallosGlobales = fallosGlobales.filter((momento) => momento > t - VENTANA_MS);
}

const normalizar = (email) => String(email ?? '').trim().toLowerCase();

/**
 * Se llama ANTES de revisar la contraseña.
 * Si la cuenta está bloqueada, lanza 429 y el login ni siquiera se intenta.
 */
export async function revisarIntentos(email) {
  purgar();

  const clave = normalizar(email);
  const dato = porCuenta.get(clave);

  if (dato && dato.fallos >= MAX_FALLOS_POR_CUENTA && dato.expira > ahora()) {
    const minutos = Math.max(1, Math.ceil((dato.expira - ahora()) / 60000));
    const error = new ApiError(
      429,
      `Demasiados intentos fallidos. Vuelve a intentar en ${minutos} minuto${minutos === 1 ? '' : 's'}, `
      + 'o pídele a un Gerente que te restablezca la contraseña.',
    );
    error.codigo = 'DEMASIADOS_INTENTOS';
    throw error;
  }

  // Freno general: no bloquea a nadie, solo hace lento el ataque.
  if (fallosGlobales.length >= FALLOS_PARA_FRENO_GENERAL) {
    await new Promise((resolver) => { setTimeout(resolver, DEMORA_MS); });
  }
}

/** Se llama cuando el correo o la contraseña no fueron correctos. */
export function registrarFallo(email) {
  purgar();

  const clave = normalizar(email);
  if (!clave) return;

  // Si ya se recuerdan demasiadas cuentas, se suelta la más vieja. El Map de
  // JavaScript conserva el orden de inserción, así que la primera es esa.
  if (!porCuenta.has(clave) && porCuenta.size >= MAX_CUENTAS_RECORDADAS) {
    const primera = porCuenta.keys().next().value;
    porCuenta.delete(primera);
  }

  const dato = porCuenta.get(clave) ?? { fallos: 0, expira: 0 };
  dato.fallos += 1;
  // La ventana se cuenta desde el último fallo: insistir no acorta el castigo.
  dato.expira = ahora() + VENTANA_MS;
  porCuenta.set(clave, dato);

  fallosGlobales.push(ahora());

  if (dato.fallos === MAX_FALLOS_POR_CUENTA) {
    console.warn(`[seguridad] cuenta bloqueada por intentos fallidos: ${clave}`);
  }
}

/** Se llama cuando alguien entra bien: se le borra el historial de fallos. */
export function limpiarIntentos(email) {
  porCuenta.delete(normalizar(email));
}

/** Solo para las pruebas: deja el contador como recién arrancado. */
export function reiniciarIntentos() {
  porCuenta.clear();
  fallosGlobales = [];
}

/**
 * Estado del contador. Solo lo usan las pruebas: a propósito NO se expone en
 * /api/health, que es público — decirle a un atacante cuántos intentos lleva
 * es ayudarle a calibrar.
 */
export const estadoIntentos = () => ({
  cuentas_vigiladas: porCuenta.size,
  fallos_en_la_ventana: fallosGlobales.length,
  freno_general: fallosGlobales.length >= FALLOS_PARA_FRENO_GENERAL,
});
