/**
 * Botón de descarga a Excel.
 *
 * Baja siempre lo que está viendo el usuario: recibe los mismos filtros que la
 * pantalla tiene puestos. Si alguien filtró por "Urgentes de Torreón" y le da
 * a descargar, eso es lo que debe traer el archivo — no la tabla completa.
 *
 * Mientras el servidor arma el archivo el botón se bloquea y lo dice, porque un
 * reporte de miles de renglones tarda unos segundos y sin señal la gente vuelve
 * a hacer clic tres veces.
 */
import { useState } from 'react';
import { Check, FileSpreadsheet } from 'lucide-react';
import { reportesApi } from '../api/client.js';
import { Boton } from './ui/Primitivos.jsx';

export default function BotonExcel({
  tipo,
  filtros = {},
  etiqueta = 'Excel',
  variante = 'secundario',
  onError,
  className = '',
}) {
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState(false);

  const descargar = async () => {
    setOcupado(true);
    try {
      await reportesApi.descargar(tipo, filtros);
      setListo(true);
      setTimeout(() => setListo(false), 2500);
    } catch (error) {
      onError?.(error.mensaje || 'No se pudo generar el archivo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Boton
      variante={variante}
      icono={listo ? Check : FileSpreadsheet}
      cargando={ocupado}
      onClick={descargar}
      className={className}
      title="Descargar en Excel lo que estás viendo, con los filtros aplicados"
    >
      {ocupado ? 'Generando...' : (listo ? 'Descargado' : etiqueta)}
    </Boton>
  );
}
