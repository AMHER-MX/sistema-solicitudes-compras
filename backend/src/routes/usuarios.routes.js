import { Router } from 'express';
import * as ctrl from '../controllers/usuarios.controller.js';
import { autenticar, permitirRoles } from '../middleware/auth.js';
import { cuentaVigente } from '../middleware/cuenta.js';
import { ROLES } from '../utils/estatus.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// Todo este módulo es exclusivo del Gerente.
router.use(autenticar, cuentaVigente, permitirRoles(ROLES.GERENTE));

router.get('/', asyncHandler(ctrl.listar));
router.get('/:id', asyncHandler(ctrl.detalle));
router.post('/', asyncHandler(ctrl.crear));
router.patch('/:id', asyncHandler(ctrl.actualizar));
router.post('/:id/password', asyncHandler(ctrl.restablecer));

export default router;
