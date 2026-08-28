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

// Enviar la cotización al cliente: la manda quien la levantó (o Gerencia).
// Es el momento en que se congela el precio y arranca el reloj de vigencia.
router.post(
  '/:id/enviar',
  permitirRoles(ROLES.VENDEDOR, ROLES.GERENTE),
  asyncHandler(ctrl.enviar),
);

// El cliente aprobó: la cotización se vuelve Pedido conservando su folio.
// También lo puede hacer Compras, porque a veces el cliente les habla directo
// o el vendedor anda fuera y el pedido no se puede quedar esperando.
// El controlador verifica además que sea SU cotización si quien llama es Vendedor.
router.post(
  '/:id/convertir',
  permitirRoles(ROLES.VENDEDOR, ROLES.COMPRADOR, ROLES.GERENTE),
  asyncHandler(ctrl.convertir),
);

// Volver a preguntarle el precio a Quiter. Cualquier rol con acceso al
// documento: si ya se envió al cliente, solo actualiza la referencia.
router.post('/:id/precios', asyncHandler(ctrl.actualizarPrecios));

// Editar / recotizar. Vendedor (lo suyo), Comprador y Gerente: el controlador
// impide que el vendedor toque precios, que es lo único que no le corresponde.
router.patch(
  '/:id',
  permitirRoles(ROLES.VENDEDOR, ROLES.COMPRADOR, ROLES.GERENTE),
  asyncHandler(ctrl.editar),
);

// Cómo va el trabajo de Compras sobre una cotización. Es un eje aparte del
// estatus del documento, y por eso tiene su propio endpoint: mezclarlos haría
// que un comprador marcando "Cotización Parcial" moviera, sin querer, algo que
// el vendedor y el cliente están leyendo.
router.patch(
  '/:id/compras',
  permitirRoles(ROLES.COMPRADOR, ROLES.GERENTE),
  asyncHandler(ctrl.actualizarEstatusCompras),
);

// Mover estatus. El Vendedor entra aquí para mandar su cotización a Compras
// o cancelarla; el controlador le impide tocar el flujo de un Pedido.
router.patch(
  '/:id/estatus',
  permitirRoles(ROLES.VENDEDOR, ROLES.COMPRADOR, ROLES.GERENTE),
  asyncHandler(ctrl.actualizarEstatus),
);

export default router;
