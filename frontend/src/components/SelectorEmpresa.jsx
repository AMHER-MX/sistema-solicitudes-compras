/**
 * Selector de empresa para quien ve a las dos.
 *
 * La mayoría de la gente pertenece a una sola empresa y no debe ver este
 * control: para ella no hay nada que elegir y un filtro de una sola opción
 * solo estorba. Por eso el componente se dibuja a sí mismo como nada cuando
 * el servidor contesta que esta cuenta ve una sola.
 *
 * Quién ve cuántas NO se deduce del rol aquí. Se le pregunta a
 * /catalogos/empresas, que contesta `ve_todas`. Si la regla cambiara —un
 * Comprador de grupo, por ejemplo— esta pantalla no se entera y sigue bien.
 */
import { useEffect, useState } from 'react';
import { catalogosApi } from '../api/client.js';
import { Select } from './ui/Primitivos.jsx';

/**
 * Carga las empresas visibles una sola vez.
 * Devuelve { empresas, veTodas, listo }.
 */
export function useEmpresas() {
  const [estado, setEstado] = useState({ empresas: [], veTodas: false, listo: false });

  useEffect(() => {
    let vivo = true;
    catalogosApi.empresas()
      .then((d) => {
        if (vivo) setEstado({ empresas: d.empresas, veTodas: d.ve_todas, listo: true });
      })
      // Si falla, se queda con una empresa: el filtro no aparece y la pantalla
      // sigue sirviendo. Es mejor que trabarla por un catálogo.
      .catch(() => { if (vivo) setEstado((e) => ({ ...e, listo: true })); });
    return () => { vivo = false; };
  }, []);

  return estado;
}

export default function SelectorEmpresa({
  valor, onChange, empresas, veTodas, className = 'w-48',
}) {
  if (!veTodas || empresas.length < 2) return null;

  return (
    <div className={className}>
      <Select value={valor} onChange={(e) => onChange(e.target.value)} aria-label="Empresa">
        <option value="">Las dos empresas</option>
        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
      </Select>
    </div>
  );
}
