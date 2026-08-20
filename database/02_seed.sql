-- =============================================================================
--  SGC - Datos semilla para ambiente de DESARROLLO
--  Archivo: 02_seed.sql
--
--  Todos los usuarios de prueba comparten la contraseña: demo1234
--  (hash bcrypt, cost 10)
--
--  Ejecutar con:
--    psql -U postgres -d sgc_compras -f database/02_seed.sql
-- =============================================================================

-- ---------- Sucursales -------------------------------------------------------
INSERT INTO sucursales (clave, nombre, ciudad) VALUES
    ('SUC01', 'Matriz Monterrey',   'Monterrey'),
    ('SUC02', 'Sucursal Saltillo',  'Saltillo'),
    ('SUC03', 'Sucursal Guadalupe', 'Guadalupe')
ON CONFLICT (clave) DO NOTHING;

-- ---------- Clientes ---------------------------------------------------------
INSERT INTO clientes (codigo_erp, nombre, rfc, telefono, email) VALUES
    ('CL-1001', 'Transportes del Norte SA de CV', 'TNO900101AB1', '8181234567', 'compras@tnorte.mx'),
    ('CL-1002', 'Constructora Vallarta SA',       'CVA850505XY2', '8187654321', 'admin@cvallarta.mx'),
    ('CL-1003', 'Taller Mecánico El Águila',      'TMA010203QW3', '8112345678', 'elaguila@gmail.com')
ON CONFLICT (codigo_erp) DO NOTHING;

-- ---------- Usuarios ---------------------------------------------------------
-- password de todos: demo1234
INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id) VALUES
    ('Ana Ríos',        'vendedor@demo.mx',  '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Vendedor',  1),
    ('Luis Márquez',    'vendedor2@demo.mx', '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Vendedor',  2),
    ('Sofía Cárdenas',  'comprador@demo.mx', '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Comprador', 1),
    ('Jorge Treviño',   'gerente@demo.mx',   '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Gerente',   1)
ON CONFLICT (email) DO NOTHING;

-- ---------- Solicitudes de ejemplo ------------------------------------------
-- Nota: el folio lo asigna el trigger tg_solicitudes_folio.

-- 1) Urgente, recién capturada
WITH nueva AS (
    INSERT INTO solicitudes_compras
        (folio, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual, observaciones)
    VALUES (NULL, 1, 1, 1, 'Urgente', 'Pendiente', 'Cliente detiene unidad hasta recibir refacción.')
    RETURNING id
), det AS (
    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen, precio_estimado)
    SELECT id, 'FLT-4520', 'Filtro de aceite motor diésel 4520', 4, 0, 385.00  FROM nueva
    UNION ALL
    SELECT id, 'BAL-8890', 'Balata delantera cerámica 8890',     2, 0, 1250.00 FROM nueva
    RETURNING id_solicitud
)
INSERT INTO solicitud_historial (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
SELECT DISTINCT id_solicitud, 1, NULL, 'Pendiente', 'Solicitud creada por el vendedor.' FROM det;

-- 2) Normal, ya en tránsito con promesa de entrega
WITH nueva AS (
    INSERT INTO solicitudes_compras
        (folio, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_promesa_entrega, id_comprador_asignado, observaciones)
    VALUES (NULL, 2, 2, 2, 'Normal', 'En Transito',
            CURRENT_DATE + INTERVAL '5 day', 3, 'Pedido consolidado con proveedor nacional.')
    RETURNING id
), det AS (
    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen, precio_estimado)
    SELECT id, 'ACE-15W40', 'Aceite motor 15W40 cubeta 19L', 10, 2, 2480.00 FROM nueva
    RETURNING id_solicitud
)
INSERT INTO solicitud_historial (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
SELECT DISTINCT id_solicitud, 2, NULL,            'Pendiente',   'Solicitud creada por el vendedor.'   FROM det
UNION ALL
SELECT DISTINCT id_solicitud, 3, 'Pendiente',     'En Cotizacion','Solicitando precio a 3 proveedores.' FROM det
UNION ALL
SELECT DISTINCT id_solicitud, 3, 'En Cotizacion', 'En Transito',  'Orden de compra OC-3391 colocada.'   FROM det;

-- 3) Baja, ya recibida (sirve para el KPI de tiempo promedio de atención)
WITH nueva AS (
    INSERT INTO solicitudes_compras
        (folio, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_creacion, fecha_promesa_entrega, fecha_cierre, id_comprador_asignado)
    VALUES (NULL, 1, 1, 3, 'Baja', 'Recibido',
            NOW() - INTERVAL '9 day', CURRENT_DATE - INTERVAL '2 day', NOW() - INTERVAL '2 day', 3)
    RETURNING id
), det AS (
    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen,
         precio_estimado, cantidad_surtida)
    SELECT id, 'FLT-4520', 'Filtro de aceite motor diésel 4520', 6, 0, 385.00, 6 FROM nueva
    RETURNING id_solicitud
)
INSERT INTO solicitud_historial (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario, fecha_movimiento)
SELECT DISTINCT id_solicitud, 1, NULL,          'Pendiente',  'Solicitud creada por el vendedor.', NOW() - INTERVAL '9 day' FROM det
UNION ALL
SELECT DISTINCT id_solicitud, 3, 'Pendiente',   'Autorizada', 'Autorizada por gerencia.',          NOW() - INTERVAL '8 day' FROM det
UNION ALL
SELECT DISTINCT id_solicitud, 3, 'Autorizada',  'En Transito','Embarque en ruta.',                 NOW() - INTERVAL '5 day' FROM det
UNION ALL
SELECT DISTINCT id_solicitud, 3, 'En Transito', 'Recibido',   'Material recibido en almacén.',     NOW() - INTERVAL '2 day' FROM det;
