import { Router } from 'express';
import * as ctrl from '../controllers/dashboard.controller.js';
import { autenticar, permitirRoles } from '../middleware/auth.js';
import { ROLES } from '../utils/estatus.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// Métricas gerenciales: Gerente y Comprador (compras también necesita el tablero).
router.get(
  '/gerencia',
  autenticar,
  permitirRoles(ROLES.GERENTE, ROLES.COMPRADOR),
  asyncHandler(ctrl.gerencia),
);

export default router;
