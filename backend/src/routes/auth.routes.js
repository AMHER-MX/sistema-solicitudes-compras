import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { autenticar } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.post('/login', asyncHandler(ctrl.login));
router.get('/yo', autenticar, asyncHandler(ctrl.yo));

export default router;
