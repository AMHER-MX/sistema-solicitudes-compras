import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { autenticar } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.post('/login', asyncHandler(ctrl.login));

// Estas dos van con `autenticar` pero SIN `cuentaVigente`: quien trae una
// contraseña temporal tiene que poder consultarse a sí mismo y cambiarla.
// Si pasaran por cuentaVigente quedaría atrapado —le negaría justo la ruta
// que necesita para salir del bloqueo.
router.get('/yo', autenticar, asyncHandler(ctrl.yo));
router.post('/cambiar-password', autenticar, asyncHandler(ctrl.cambiarPassword));

export default router;
