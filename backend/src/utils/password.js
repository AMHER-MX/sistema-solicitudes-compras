/**
 * Generación y validación de contraseñas.
 *
 * Dos reglas que valen para todo el sistema:
 *   1. La contraseña en claro solo existe un momento, en memoria. Lo que se
 *      guarda en la base es siempre el hash de bcrypt.
 *   2. La contraseña temporal la genera el servidor, nunca la escribe una
 *      persona. Así nadie tiene que inventar "Compras2026" para cuatro cuentas.
 */
import { randomInt } from 'node:crypto';

/**
 * Alfabeto sin caracteres que se confunden al dictarlos o leerlos:
 * fuera 0/O, 1/l/I y los símbolos. Sin símbolos a propósito: estas claves se
 * copian, se pegan en WhatsApp y a veces se escriben a mano, y un `#` o un `$`
 * causa más problemas (en archivos .env, en terminales) de los que resuelve.
 * La fuerza viene de la longitud, no de los símbolos.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Largo de la contraseña temporal. 14 sobre este alfabeto ≈ 81 bits. */
const LARGO_TEMPORAL = 14;

/**
 * Contraseña temporal para una cuenta nueva o un restablecimiento.
 *
 * Usa randomInt de node:crypto (aleatoriedad criptográfica), no Math.random,
 * que es predecible y no sirve para nada que proteja una cuenta.
 *
 * @returns {string} p. ej. "kR7mQp2vXn4tHs"
 */
export function generarPasswordTemporal(largo = LARGO_TEMPORAL) {
  let salida = '';
  for (let i = 0; i < largo; i += 1) {
    salida += ALFABETO[randomInt(ALFABETO.length)];
  }
  return salida;
}

/** Largo mínimo de una contraseña elegida por el usuario. */
export const LARGO_MINIMO = 10;

/**
 * Revisa que una contraseña elegida por el usuario sea razonable.
 * Devuelve la lista de problemas: vacía significa que pasó.
 *
 * Se piden letras y números, no símbolos obligatorios: exigir símbolos empuja
 * a la gente a terminar todo en "!" —lo cual no agrega nada— mientras que la
 * longitud sí sirve.
 *
 * @param {string} password
 * @param {{ nombre?: string, email?: string }} [datos] Para evitar que la
 *        contraseña sea el propio nombre o correo del usuario.
 * @returns {string[]}
 */
export function revisarPassword(password, datos = {}) {
  const problemas = [];
  const valor = typeof password === 'string' ? password : '';

  if (valor.length < LARGO_MINIMO) {
    problemas.push(`Debe tener al menos ${LARGO_MINIMO} caracteres.`);
  }
  if (valor.length > 200) {
    problemas.push('Es demasiado larga (máximo 200 caracteres).');
  }
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(valor)) {
    problemas.push('Debe incluir al menos una letra.');
  }
  if (!/[0-9]/.test(valor)) {
    problemas.push('Debe incluir al menos un número.');
  }
  if (/^\s|\s$/.test(valor)) {
    problemas.push('No puede empezar ni terminar con espacios.');
  }

  const enMinusculas = valor.toLowerCase();

  // Las cuatro sospechosas de siempre, más las que este sistema invita a usar.
  const PROHIBIDAS = [
    'password', 'contrasena', 'contraseña', '12345678', '1234567890',
    'qwertyuiop', 'compras2026', 'refacciones', 'catosa', 'cacesa', 'quiter',
    'demo1234', 'administrador',
  ];
  if (PROHIBIDAS.some((mala) => enMinusculas.includes(mala))) {
    problemas.push('Es demasiado fácil de adivinar; elige otra.');
  }

  // La parte del correo antes de la @, y el nombre de pila.
  const usuario = (datos.email || '').split('@')[0].toLowerCase();
  if (usuario.length >= 4 && enMinusculas.includes(usuario)) {
    problemas.push('No puede contener tu correo.');
  }
  // El umbral aquí es 3, no 4, porque hay nombres de tres letras (Ana, Luz,
  // Eva) y son justo los que la gente usa de contraseña. A cambio, alguna
  // palabra inocente que los contenga se rechaza de más; el mensaje explica
  // por qué y elegir otra cuesta un segundo.
  const nombrePila = (datos.nombre || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (nombrePila.length >= 3 && enMinusculas.includes(nombrePila)) {
    problemas.push('No puede contener tu nombre.');
  }

  return problemas;
}
