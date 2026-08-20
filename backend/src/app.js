/**
 * Construcción de la app Express (sin arrancar el servidor).
 * Separarlo de server.js permite montar la app en pruebas automatizadas.
 */
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { env } from './config/env.js';
import { manejadorErrores, rutaNoEncontrada } from './middleware/errorHandler.js';
import routes from './routes/index.js';

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

  app.get('/', (_req, res) =>
    res.json({ ok: true, mensaje: 'API SGC Compras. Consulta /api/health' }));

  // Estos dos van al final, en este orden.
  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);

  return app;
}
