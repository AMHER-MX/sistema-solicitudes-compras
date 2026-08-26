/**
 * Buscador de clientes.
 *
 * Con tres clientes inventados bastaba una lista desplegable. Con el padrón
 * real de Quiter —cientos de nombres, muchos parecidos entre sí— buscar
 * desplazando una lista es inservible: hay que poder teclear.
 *
 * Decisiones que vale la pena conocer:
 *
 *  · Se busca en el servidor, no en memoria. Traer el padrón completo al
 *    navegador de cada vendedor para filtrarlo aquí sería mover cientos de
 *    renglones en cada carga de pantalla para usar uno.
 *
 *  · Espera 250 ms desde la última tecla antes de preguntar. Sin eso, escribir
 *    "transportes" dispara once consultas y la última en llegar —que puede ser
 *    la de "transp"— pisa a la buena.
 *
 *  · Se puede usar sin tocar el ratón: flechas para moverse, Enter para elegir,
 *    Escape para cerrar. Quien captura veinte cotizaciones al día no quiere
 *    soltar el teclado.
 *
 *  · Se muestra la ciudad junto al nombre. En un padrón real hay homónimos, y
 *    la ciudad suele ser lo que los distingue.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { catalogosApi } from '../api/client.js';

export default function SelectorCliente({ valor, onCambiar, deshabilitado = false }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  // El cliente ya elegido, para poder seguir mostrando su nombre cuando la
  // lista de resultados ya cambió por debajo.
  const [elegido, setElegido] = useState(null);

  const contenedor = useRef(null);
  const entrada = useRef(null);
  // Cada búsqueda lleva número: si llega una respuesta vieja, se tira.
  const turno = useRef(0);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    const alHacerClic = (e) => {
      if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', alHacerClic);
    return () => document.removeEventListener('mousedown', alHacerClic);
  }, []);

  // Buscar, con freno.
  useEffect(() => {
    if (!abierto) return undefined;

    const mio = ++turno.current;
    setBuscando(true);

    const t = setTimeout(async () => {
      try {
        const d = await catalogosApi.clientes(texto);
        if (turno.current !== mio) return; // llegó tarde: ya hay una búsqueda más nueva
        setOpciones(d.clientes ?? []);
        setHayMas(Boolean(d.hay_mas));
        setResaltado(0);
      } catch {
        if (turno.current === mio) { setOpciones([]); setHayMas(false); }
      } finally {
        if (turno.current === mio) setBuscando(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [texto, abierto]);

  const abrir = () => {
    if (deshabilitado) return;
    setAbierto(true);
    setTexto('');
    setTimeout(() => entrada.current?.focus(), 0);
  };

  const elegir = (c) => {
    setElegido(c);
    onCambiar(c ? c.id : null);
    setAbierto(false);
  };

  const limpiar = (e) => {
    e.stopPropagation();
    elegir(null);
  };

  const alTeclear = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setResaltado((i) => Math.min(i + 1, opciones.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltado((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (opciones[resaltado]) elegir(opciones[resaltado]);
    } else if (e.key === 'Escape') {
      setAbierto(false);
    }
  };

  return (
    <div ref={contenedor} className="relative">
      {/* Lo que se ve cuando está cerrado */}
      {!abierto && (
        <button
          type="button"
          onClick={abrir}
          disabled={deshabilitado}
          className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2
                     text-left text-sm ring-1 ring-hairline transition-colors
                     hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={valor && elegido ? 'text-ink' : 'text-muted'}>
            {valor && elegido
              ? <>
                  {elegido.nombre}
                  {elegido.ciudad && <span className="text-muted"> · {elegido.ciudad}</span>}
                </>
              : 'Buscar cliente...'}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {valor && elegido && (
              <span
                role="button"
                tabIndex={-1}
                onClick={limpiar}
                title="Quitar el cliente"
                className="rounded p-0.5 text-muted hover:bg-surface-alt hover:text-ink"
              >
                <X size={14} />
              </span>
            )}
            <ChevronDown size={15} className="text-muted" />
          </span>
        </button>
      )}

      {/* Lo que se ve cuando está abierto */}
      {abierto && (
        <>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={entrada}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={alTeclear}
              placeholder="Nombre o código del cliente..."
              aria-label="Buscar cliente"
              className="w-full rounded-lg bg-surface py-2 pl-9 pr-3 text-sm text-ink
                         ring-1 ring-brand/50 outline-none placeholder:text-muted"
            />
          </div>

          <ul
            role="listbox"
            className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-surface
                       py-1 shadow-lg ring-1 ring-hairline"
          >
            {buscando && opciones.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted">Buscando...</li>
            )}

            {!buscando && opciones.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted">
                {texto
                  ? `Ningún cliente coincide con "${texto}".`
                  : 'Todavía no hay clientes en el padrón.'}
              </li>
            )}

            {/* Poder cotizar sin cliente sigue siendo válido: a veces el
                mostrador pregunta antes de decir quién es. */}
            <li>
              <button
                type="button"
                onClick={() => elegir(null)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs
                           text-muted hover:bg-surface-alt"
              >
                Sin cliente asignado
                {!valor && <Check size={14} />}
              </button>
            </li>

            {opciones.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.id === valor}
                  onClick={() => elegir(c)}
                  onMouseEnter={() => setResaltado(i)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left
                              ${i === resaltado ? 'bg-surface-alt' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{c.nombre}</span>
                    <span className="block truncate text-[11px] text-muted tabular">
                      {c.codigo_erp}
                      {c.ciudad && ` · ${c.ciudad}`}
                      {c.estado && `, ${c.estado}`}
                    </span>
                  </span>
                  {c.id === valor && <Check size={14} className="shrink-0 text-brand" />}
                </button>
              </li>
            ))}

            {/* Decirlo evita que alguien crea que su cliente no existe cuando
                lo que pasa es que quedó fuera de los primeros cincuenta. */}
            {hayMas && (
              <li className="border-t border-hairline px-3 py-2 text-[11px] text-muted">
                Hay más resultados. Escribe un poco más para acotar.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
