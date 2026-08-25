/**
 * Enrutador raíz: monta todos los módulos bajo /api.
 */
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import catalogosRoutes from './catalogos.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import productosRoutes from './productos.routes.js';
import solicitudesRoutes from './solicitudes.routes.js';
import { probarConexion } from '../config/db.js';
import { estadoErp } from '../services/erp/index.js';
import { ESTATUS, PRIORIDADES, TRANSICIONES } from '../utils/estatus.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

/** Chequeo de salud: BD + integración ERP. Útil para monitoreo. */
router.get('/health', asyncHandler(async (_req, res) => {
  const ahora = await probarConexion();
  res.json({
    ok: true,
    servicio: 'sgc-compras-api',
    bd: { conectada: true, hora: ahora },
    erp: await estadoErp(),
  });
}));

/** Metadatos que el frontend usa para pintar selects y badges. */
router.get('/meta', (_req, res) => {
  res.json({ ok: true, estatus: Object.values(ESTATUS), prioridades: PRIORIDADES, transiciones: TRANSICIONES });
});

router.use('/auth', authRoutes);
router.use('/catalogos', catalogosRoutes);
router.use('/productos', productosRoutes);
router.use('/solicitudes', solicitudesRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
