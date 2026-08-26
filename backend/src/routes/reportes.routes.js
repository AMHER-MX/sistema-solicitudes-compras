import { Router } from 'express';
import * as ctrl from '../controllers/reportes.controller.js';
import { autenticar, permitirRoles } from '../middleware/auth.js';
import { cuentaVigente } from '../middleware/cuenta.js';
import { ROLES } from '../utils/estatus.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.use(autenticar, cuentaVigente);

// Un Vendedor sí puede bajar sus solicitudes y su seguimiento: el controlador
// le impone el filtro de "solo lo mío" aunque mande otro id.
router.get('/solicitudes', asyncHandler(ctrl.solicitudes));
router.get('/historial',   asyncHandler(ctrl.historial));

// Faltantes e indicadores son lectura de gestión: mismo criterio que el
// tablero, que tampoco ve un Vendedor.
router.get('/faltantes',   permitirRoles(ROLES.COMPRADOR, ROLES.GERENTE), asyncHandler(ctrl.faltantes));
router.get('/indicadores', permitirRoles(ROLES.COMPRADOR, ROLES.GERENTE), asyncHandler(ctrl.indicadores));

export default router;
