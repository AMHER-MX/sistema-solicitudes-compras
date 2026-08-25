/**
 * Construcción de la app Express (sin arrancar el servidor).
 * Separarlo de server.js permite montar la app en pruebas automatizadas.
 *
 * Este servidor sirve DOS cosas:
 *   /api/...  -> la API del sistema
 *   todo lo demás -> la interfaz de React ya compilada (frontend/dist)
 *
 * Tenerlo junto significa un solo despliegue, un solo dominio y ningún
 * problema de CORS en producción: el navegador pide la interfaz y los datos
 * al mismo origen. En desarrollo siguen separados (Vite en :5173 con proxy).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { env } from './config/env.js';
import { manejadorErrores, rutaNoEncontrada } from './middleware/errorHandler.js';
import routes from './routes/index.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
/** Carpeta que genera `npm run build` en el frontend. */
export const RUTA_INTERFAZ = path.resolve(aqui, '..', '..', 'frontend', 'dist');

export function crearApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  // Los datos de esta API cambian constantemente (existencias, estatus, KPIs):
  // desactivamos ETag y pedimos que nadie los cachee. Así el navegador nunca
  // muestra un tablero viejo ni recibe un 304 con cuerpo vacío.
  app.disable('etag');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Todas las rutas de negocio viven bajo /api
  app.use('/api', routes);

  const hayInterfaz = existsSync(path.join(RUTA_INTERFAZ, 'index.html'));

  if (hayInterfaz) {
    // Caché: los archivos de /assets llevan un hash en el nombre
    // (index-DFWk_M9Y.js), así que su contenido nunca cambia — se pueden
    // guardar un año. index.html es lo contrario: es el que apunta a los
    // archivos de la versión nueva, y si el navegador se queda con uno viejo
    // pedirá archivos que ya no existen y verá una pantalla en blanco.
    app.use(express.static(RUTA_INTERFAZ, {
      index: false,
      setHeaders: (res, archivo) => {
        const enAssets = path.dirname(archivo).split(path.sep).includes('assets');
        res.set('Cache-Control', enAssets
          ? 'public, max-age=31536000, immutable'
          : 'no-cache');
      },
    }));

    // La interfaz maneja su propia navegación, así que cualquier ruta que no
    // sea /api debe devolver index.html y dejar que React decida qué mostrar.
    // El patrón excluye /api para que un endpoint mal escrito siga dando un
    // 404 en JSON y no una página HTML, que sería mucho más difícil de
    // diagnosticar desde el frontend.
    app.get(/^\/(?!api\/|api$).*/, (_req, res) => {
      // Nunca cachear el index: ver la nota de arriba.
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(RUTA_INTERFAZ, 'index.html'));
    });
  } else {
    // Sin interfaz compilada (típico en desarrollo, donde Vite la sirve).
    app.get('/', (_req, res) => res.json({
      ok: true,
      mensaje: 'API SGC Compras. Consulta /api/health',
      interfaz: 'no compilada — corre `npm run build:interfaz` para servirla desde aquí',
    }));
  }

  // Estos dos van al final, en este orden.
  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);

  return app;
}
