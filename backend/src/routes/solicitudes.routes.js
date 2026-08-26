import { Router } from 'express';
import * as ctrl from '../controllers/solicitudes.controller.js';
import { autenticar, permitirRoles } from '../middleware/auth.js';
import { cuentaVigente } from '../middleware/cuenta.js';
import { ROLES } from '../utils/estatus.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// Todo lo de solicitudes requiere sesión y una cuenta activa
// (cuentaVigente además bloquea a quien traiga contraseña temporal).
router.use(autenticar, cuentaVigente);

// Levantar solicitud: vendedores (y gerencia, que también captura).
router.post('/', permitirRoles(ROLES.VENDEDOR, ROLES.GERENTE), asyncHandler(ctrl.crear));

// Consultas: cualquier rol autenticado (el controlador limita al vendedor).
router.get('/', asyncHandler(ctrl.listar));
router.get('/:id', asyncHandler(ctrl.detalle));

// Mover estatus: solo Compras y Gerencia.
router.patch(
  '/:id/estatus',
  permitirRoles(ROLES.COMPRADOR, ROLES.GERENTE),
  asyncHandler(ctrl.actualizarEstatus),
);

export default router;
