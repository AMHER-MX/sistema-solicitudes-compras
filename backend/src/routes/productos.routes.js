import { Router } from 'express';
import * as ctrl from '../controllers/productos.controller.js';
import { autenticar } from '../middleware/auth.js';
import { cuentaVigente } from '../middleware/cuenta.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// Consulta de existencias en el ERP (Quiter) — disponible para todos los roles.
router.get('/existencias', autenticar, cuentaVigente, asyncHandler(ctrl.existencias));

export default router;
