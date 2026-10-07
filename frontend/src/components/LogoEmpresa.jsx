/**
 * Elige el logo que toca según la empresa de quien está adentro.
 *
 * El sistema lo usan dos empresas del mismo grupo, y cada una tiene su marca.
 * Enseñarle a un vendedor de Durango el logo de CATOSA toda la jornada no es
 * un detalle estético: es decirle que la herramienta es de otros y que él
 * está de prestado. Así que el encabezado se pinta con la marca de su
 * empresa, que viene en `usuario.empresa_clave`.
 *
 * Si llegara una empresa que no conocemos —una tercera, o una cuenta a la que
 * se le olvidó asignarle la suya— se cae del lado seguro: se dibuja el nombre
 * en texto en vez de ponerle encima una marca que no es la suya.
 */
import { LogoCatosa, MarcaCatosa } from './LogoCatosa.jsx';
import { LogoCadusa, MarcaCadusa } from './LogoCadusa.jsx';

const MARCAS = {
  CATOSA: { Logo: LogoCatosa, Marca: MarcaCatosa, nombre: 'CATOSA' },
  CADUSA: { Logo: LogoCadusa, Marca: MarcaCadusa, nombre: 'CADUSA' },
};

/** ¿Tenemos dibujada la marca de esta empresa? */
export const hayMarca = (clave) => Boolean(MARCAS[clave]);

/**
 * Lockup de la empresa indicada.
 *   <LogoEmpresa clave="CADUSA" className="w-28" conBajada={false} />
 */
export default function LogoEmpresa({
  clave, className = 'w-28', conBajada = false, nombre,
}) {
  const marca = MARCAS[clave];

  if (!marca) {
    // Sin logo conocido: el nombre, compuesto para que ocupe el mismo renglón
    // y no descuadre el encabezado.
    return (
      <span className={`inline-block truncate text-base font-semibold tracking-tight ${className}`}>
        {nombre || clave || 'SGC'}
      </span>
    );
  }

  const { Logo } = marca;
  return <Logo className={className} conBajada={conBajada} />;
}

/** Solo el emblema: espacios cuadrados, listados, avatares. */
export function MarcaEmpresa({ clave, className = 'w-7' }) {
  const marca = MARCAS[clave];
  if (!marca) return null;
  const { Marca } = marca;
  return <Marca className={className} />;
}

/**
 * Las dos marcas juntas, para la pantalla de entrada.
 *
 * Antes de teclear la contraseña no sabemos de qué empresa es quien llega, y
 * poner solo una de las dos haría dudar a la otra mitad de la gente de si se
 * equivocó de dirección. Juntas dicen lo que es: una sola herramienta para
 * las dos empresas del grupo.
 */
export function LogosDelGrupo({ className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-4 ${className}`}>
      <LogoCatosa className="w-32 text-ink" conBajada={false} />
      <span className="h-9 w-px bg-hairline" aria-hidden />
      <LogoCadusa className="w-32 text-ink" conBajada={false} />
    </div>
  );
}
