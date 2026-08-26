-- =============================================================================
--  SGC - Datos semilla para ambiente de PRUEBAS
--  Motor: PostgreSQL
--  Archivo: 02_seed.sql
--
--  Todos los usuarios de prueba comparten la contraseña: demo1234
--  (hash bcrypt, cost 10)
--
--  Aplicar con:  cd backend && npm run db:setup
--
--  ⚠  Estas cuatro cuentas @demo.mx son de prueba. Antes de dar acceso al
--     equipo, crea las cuentas reales desde la pantalla Usuarios y desactiva
--     éstas: su contraseña está escrita aquí arriba.
-- =============================================================================

-- ---------- Sucursales -------------------------------------------------------
-- `clave` = clave de ALMACÉN en Quiter (columna ALMACEN de FTIGBI_PR).
-- Estos valores NO son inventados: salen de las columnas ALMACEN y NOM_ALMACEN
-- de la propia tabla, leídas el 21/08/2026.
--
-- Quiter tiene además tres almacenes que NO son sucursales de venta y por eso
-- quedan fuera:
--     102LA  CONSIGNA LALA                  (material en consignación)
--     104CU  CORES USADOS PIEDRAS NEGRAS    (cores para devolución)
--     201RE  RESCATES 24 HORAS DURANGO      (rescates)
INSERT INTO sucursales (clave, nombre, ciudad)
VALUES
    ('101', 'Refacciones Torreón',        'Torreón'),
    ('102', 'Refacciones Gómez Palacio',  'Gómez Palacio'),
    ('103', 'Refacciones Monclova',       'Monclova'),
    ('104', 'Refacciones Piedras Negras', 'Piedras Negras'),
    ('201', 'Refacciones Durango',        'Durango'),
    ('202', 'Refacciones Poniente',       'Poniente'),
    ('203', 'Refacciones Zacatecas',      'Zacatecas')
ON CONFLICT (clave) DO NOTHING;

-- ---------- Clientes ---------------------------------------------------------
INSERT INTO clientes (codigo_erp, nombre, rfc, telefono, email)
VALUES
    ('CL-1001', 'Transportes del Norte SA de CV', 'TNO900101AB1', '8181234567', 'compras@tnorte.mx'),
    ('CL-1002', 'Constructora Vallarta SA',       'CVA850505XY2', '8187654321', 'admin@cvallarta.mx'),
    ('CL-1003', 'Taller Mecánico El Águila',      'TMA010203QW3', '8112345678', 'elaguila@gmail.com')
ON CONFLICT (codigo_erp) DO NOTHING;

-- ---------- Usuarios ---------------------------------------------------------
-- password de todos: demo1234
INSERT INTO usuarios (nombre, email, password_hash, rol, sucursal_id)
SELECT v.nombre, v.email, v.password_hash, v.rol,
       (SELECT s.id FROM sucursales s WHERE s.clave = v.clave_sucursal)
FROM (VALUES
    ('Ana Ríos',       'vendedor@demo.mx',  '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Vendedor',  '101'),
    ('Luis Márquez',   'vendedor2@demo.mx', '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Vendedor',  '102'),
    ('Sofía Cárdenas', 'comprador@demo.mx', '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Comprador', '101'),
    ('Jorge Treviño',  'gerente@demo.mx',   '$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', 'Gerente',   '101')
) AS v (nombre, email, password_hash, rol, clave_sucursal)
ON CONFLICT (email) DO NOTHING;

-- =============================================================================
--  Solicitudes de ejemplo
--  El folio lo asigna solo la secuencia (DEFAULT de la columna).
--
--  Todo el bloque va dentro de un DO: PostgreSQL necesita un bloque de código
--  para poder declarar variables, y aquí hacen falta para encadenar el id de
--  cada solicitud con sus partidas y su bitácora.
-- =============================================================================
DO $$
DECLARE
    v_vendedor1 INTEGER;
    v_vendedor2 INTEGER;
    v_comprador INTEGER;
    v_torreon   INTEGER;
    v_gomez     INTEGER;
    v_cliente1  INTEGER;
    v_cliente2  INTEGER;
    v_cliente3  INTEGER;
    v_id        INTEGER;
BEGIN
    -- Solo se siembra si la tabla está vacía, para no duplicar en cada corrida.
    IF EXISTS (SELECT 1 FROM solicitudes_compras) THEN
        RETURN;
    END IF;

    SELECT id INTO v_vendedor1 FROM usuarios   WHERE email = 'vendedor@demo.mx';
    SELECT id INTO v_vendedor2 FROM usuarios   WHERE email = 'vendedor2@demo.mx';
    SELECT id INTO v_comprador FROM usuarios   WHERE email = 'comprador@demo.mx';
    SELECT id INTO v_torreon   FROM sucursales WHERE clave = '101';
    SELECT id INTO v_gomez     FROM sucursales WHERE clave = '102';
    SELECT id INTO v_cliente1  FROM clientes   WHERE codigo_erp = 'CL-1001';
    SELECT id INTO v_cliente2  FROM clientes   WHERE codigo_erp = 'CL-1002';
    SELECT id INTO v_cliente3  FROM clientes   WHERE codigo_erp = 'CL-1003';

    -- 1) Urgente, recién capturada
    INSERT INTO solicitudes_compras
        (tipo, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual, observaciones)
    VALUES
        ('Pedido', v_vendedor1, v_torreon, v_cliente1, 'Urgente', 'Pendiente',
         'Cliente detiene unidad hasta recibir refacción.')
    RETURNING id INTO v_id;

    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen, precio_estimado)
    VALUES
        (v_id, 'FLT-4520', 'Filtro de aceite motor diésel 4520', 4, 0, 385.00),
        (v_id, 'BAL-8890', 'Balata delantera cerámica 8890',     2, 0, 1250.00);

    INSERT INTO solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
    VALUES
        (v_id, v_vendedor1, NULL, 'Pendiente', 'Solicitud creada por el vendedor.');

    -- 2) Normal, ya en tránsito con promesa de entrega
    INSERT INTO solicitudes_compras
        (tipo, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_promesa_entrega, id_comprador_asignado, observaciones)
    VALUES
        ('Pedido', v_vendedor2, v_gomez, v_cliente2, 'Normal', 'En Transito',
         (NOW() + INTERVAL '5 days')::DATE, v_comprador,
         'Pedido consolidado con proveedor nacional.')
    RETURNING id INTO v_id;

    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen, precio_estimado)
    VALUES
        (v_id, 'ACE-15W40', 'Aceite motor 15W40 cubeta 19L', 10, 2, 2480.00);

    INSERT INTO solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
    VALUES
        (v_id, v_vendedor2, NULL,             'Pendiente',     'Solicitud creada por el vendedor.'),
        (v_id, v_comprador, 'Pendiente',      'Con Proveedor', 'Solicitando precio a 3 proveedores.'),
        (v_id, v_comprador, 'Con Proveedor',  'En Transito',   'Orden de compra OC-3391 colocada.');

    -- 3) Baja, ya recibida (alimenta el KPI de tiempo promedio de atención)
    INSERT INTO solicitudes_compras
        (tipo, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_creacion, fecha_promesa_entrega, fecha_cierre, id_comprador_asignado)
    VALUES
        ('Pedido', v_vendedor1, v_torreon, v_cliente3, 'Baja', 'Recibido',
         NOW() - INTERVAL '9 days',
         (NOW() - INTERVAL '2 days')::DATE,
         NOW() - INTERVAL '2 days',
         v_comprador)
    RETURNING id INTO v_id;

    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen,
         precio_estimado, cantidad_surtida)
    VALUES
        (v_id, 'FLT-4520', 'Filtro de aceite motor diésel 4520', 6, 0, 385.00, 6);

    INSERT INTO solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario, fecha_movimiento)
    VALUES
        (v_id, v_vendedor1, NULL,           'Pendiente',   'Solicitud creada por el vendedor.', NOW() - INTERVAL '9 days'),
        (v_id, v_comprador, 'Pendiente',    'Autorizada',  'Autorizada por gerencia.',          NOW() - INTERVAL '8 days'),
        (v_id, v_comprador, 'Autorizada',   'En Transito', 'Embarque en ruta.',                 NOW() - INTERVAL '5 days'),
        (v_id, v_comprador, 'En Transito',  'Recibido',    'Material recibido en almacén.',     NOW() - INTERVAL '2 days');

    -- ─────────────────────────────────────────────────────────────────────────
    -- COTIZACIONES: lo que todavía no aprueba el cliente
    -- ─────────────────────────────────────────────────────────────────────────

    -- 4) Enviada al cliente hace 3 días, con 27 por delante.
    --    Una de sus partidas ya subió de precio en Quiter: sirve para ver el
    --    aviso amarillo sin tener que esperar a que la vida lo produzca.
    INSERT INTO solicitudes_compras
        (tipo, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_creacion, enviada_en, vence_en, dias_vigencia, observaciones)
    VALUES
        ('Cotizacion', v_vendedor1, v_torreon, v_cliente2, 'Normal', 'Enviada',
         NOW() - INTERVAL '4 days',
         NOW() - INTERVAL '3 days',
         NOW() + INTERVAL '27 days',
         30,
         'Cliente pidió cotización por escrito para su comité.')
    RETURNING id INTO v_id;

    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen,
         precio_estimado, precio_cotizado, precio_lista_actual, precio_actualizado_en)
    VALUES
        -- Esta subió 6.5% desde que se cotizó: el sistema debe advertirlo y
        -- NO cambiar lo que se le prometió al cliente.
        (v_id, 'BAL-8890', 'Balata delantera cerámica 8890', 4, 6,
         1250.00, 1250.00, 1331.00, NOW()),
        (v_id, 'ACE-15W40', 'Aceite motor 15W40 cubeta 19L', 2, 8,
         2480.00, 2480.00, 2480.00, NOW());

    INSERT INTO solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario, fecha_movimiento)
    VALUES
        (v_id, v_vendedor1, NULL,       'Borrador', 'Cotización creada. Todo en existencia: lista para enviar al cliente.', NOW() - INTERVAL '4 days'),
        (v_id, v_vendedor1, 'Borrador', 'Enviada',  'Cotización enviada al cliente. Precios congelados, vigencia de 30 días.', NOW() - INTERVAL '3 days');

    -- 5) Con faltantes: esperando a que Compras consiga precio y tiempo.
    INSERT INTO solicitudes_compras
        (tipo, id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_creacion, observaciones)
    VALUES
        ('Cotizacion', v_vendedor2, v_gomez, v_cliente3, 'Urgente', 'Con Compras',
         NOW() - INTERVAL '1 day',
         'No hay en piso. El cliente necesita saber en cuánto tiempo llega.')
    RETURNING id INTO v_id;

    INSERT INTO solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen,
         precio_estimado, precio_cotizado)
    VALUES
        (v_id, 'FLT-4520', 'Filtro de aceite motor diésel 4520', 12, 0, 385.00, 385.00);

    INSERT INTO solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario, fecha_movimiento)
    VALUES
        (v_id, v_vendedor2, NULL, 'Con Compras',
         'Cotización creada. Hay faltantes: pasa a Compras para precio y tiempo de entrega.',
         NOW() - INTERVAL '1 day');
END $$;
