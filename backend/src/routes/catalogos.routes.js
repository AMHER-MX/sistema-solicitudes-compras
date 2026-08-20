import { Router } from 'express';
import * as ctrl from '../controllers/catalogos.controller.js';
import { autenticar } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.use(autenticar);
router.get('/sucursales', asyncHandler(ctrl.sucursales));
router.get('/clientes', asyncHandler(ctrl.clientes));

export default router;
