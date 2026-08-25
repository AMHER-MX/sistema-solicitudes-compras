-- =============================================================================
--  SGC - Datos semilla para ambiente de PRUEBAS
--  Motor: Microsoft SQL Server
--  Archivo: 02_seed.sql
--
--  Todos los usuarios de prueba comparten la contraseña: demo1234
--  (hash bcrypt, cost 10)
--
--  Aplicar con:  cd backend && npm run db:setup
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
INSERT INTO dbo.sucursales (clave, nombre, ciudad)
SELECT v.clave, v.nombre, v.ciudad
FROM (VALUES
    (N'101', N'Refacciones Torreón',        N'Torreón'),
    (N'102', N'Refacciones Gómez Palacio',  N'Gómez Palacio'),
    (N'103', N'Refacciones Monclova',       N'Monclova'),
    (N'104', N'Refacciones Piedras Negras', N'Piedras Negras'),
    (N'201', N'Refacciones Durango',        N'Durango'),
    (N'202', N'Refacciones Poniente',       N'Poniente'),
    (N'203', N'Refacciones Zacatecas',      N'Zacatecas')
) AS v (clave, nombre, ciudad)
WHERE NOT EXISTS (SELECT 1 FROM dbo.sucursales s WHERE s.clave = v.clave);
GO

-- ---------- Clientes ---------------------------------------------------------
INSERT INTO dbo.clientes (codigo_erp, nombre, rfc, telefono, email)
SELECT v.codigo_erp, v.nombre, v.rfc, v.telefono, v.email
FROM (VALUES
    (N'CL-1001', N'Transportes del Norte SA de CV', N'TNO900101AB1', N'8181234567', N'compras@tnorte.mx'),
    (N'CL-1002', N'Constructora Vallarta SA',       N'CVA850505XY2', N'8187654321', N'admin@cvallarta.mx'),
    (N'CL-1003', N'Taller Mecánico El Águila',      N'TMA010203QW3', N'8112345678', N'elaguila@gmail.com')
) AS v (codigo_erp, nombre, rfc, telefono, email)
WHERE NOT EXISTS (SELECT 1 FROM dbo.clientes c WHERE c.codigo_erp = v.codigo_erp);
GO

-- ---------- Usuarios ---------------------------------------------------------
-- password de todos: demo1234
INSERT INTO dbo.usuarios (nombre, email, password_hash, rol, sucursal_id)
SELECT v.nombre, v.email, v.password_hash, v.rol,
       (SELECT s.id FROM dbo.sucursales s WHERE s.clave = v.clave_sucursal)
FROM (VALUES
    (N'Ana Ríos',       N'vendedor@demo.mx',  N'$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', N'Vendedor',  N'101'),
    (N'Luis Márquez',   N'vendedor2@demo.mx', N'$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', N'Vendedor',  N'102'),
    (N'Sofía Cárdenas', N'comprador@demo.mx', N'$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', N'Comprador', N'101'),
    (N'Jorge Treviño',  N'gerente@demo.mx',   N'$2a$10$dUQDq4.aeHJ9LBLDg5P0Q.ahwT8hwfijxUdiSfsEJ09b7LPs7NqsK', N'Gerente',   N'101')
) AS v (nombre, email, password_hash, rol, clave_sucursal)
WHERE NOT EXISTS (SELECT 1 FROM dbo.usuarios u WHERE u.email = v.email);
GO

-- =============================================================================
--  Solicitudes de ejemplo
--  El folio lo asigna solo la secuencia (DEFAULT de la columna).
-- =============================================================================

DECLARE @vendedor1  INT = (SELECT id FROM dbo.usuarios   WHERE email = N'vendedor@demo.mx');
DECLARE @vendedor2  INT = (SELECT id FROM dbo.usuarios   WHERE email = N'vendedor2@demo.mx');
DECLARE @comprador  INT = (SELECT id FROM dbo.usuarios   WHERE email = N'comprador@demo.mx');
DECLARE @torreon    INT = (SELECT id FROM dbo.sucursales WHERE clave = N'101');
DECLARE @gomez      INT = (SELECT id FROM dbo.sucursales WHERE clave = N'102');
DECLARE @cliente1   INT = (SELECT id FROM dbo.clientes   WHERE codigo_erp = N'CL-1001');
DECLARE @cliente2   INT = (SELECT id FROM dbo.clientes   WHERE codigo_erp = N'CL-1002');
DECLARE @cliente3   INT = (SELECT id FROM dbo.clientes   WHERE codigo_erp = N'CL-1003');
DECLARE @id INT;

-- Solo sembramos si la tabla está vacía, para no duplicar en cada corrida.
IF NOT EXISTS (SELECT 1 FROM dbo.solicitudes_compras)
BEGIN

    -- 1) Urgente, recién capturada
    INSERT INTO dbo.solicitudes_compras
        (id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual, observaciones)
    VALUES
        (@vendedor1, @torreon, @cliente1, N'Urgente', N'Pendiente',
         N'Cliente detiene unidad hasta recibir refacción.');
    SET @id = SCOPE_IDENTITY();

    INSERT INTO dbo.solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen, precio_estimado)
    VALUES
        (@id, N'FLT-4520', N'Filtro de aceite motor diésel 4520', 4, 0, 385.00),
        (@id, N'BAL-8890', N'Balata delantera cerámica 8890',     2, 0, 1250.00);

    INSERT INTO dbo.solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
    VALUES
        (@id, @vendedor1, NULL, N'Pendiente', N'Solicitud creada por el vendedor.');

    -- 2) Normal, ya en tránsito con promesa de entrega
    INSERT INTO dbo.solicitudes_compras
        (id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_promesa_entrega, id_comprador_asignado, observaciones)
    VALUES
        (@vendedor2, @gomez, @cliente2, N'Normal', N'En Transito',
         DATEADD(DAY, 5, CAST(SYSUTCDATETIME() AS DATE)), @comprador,
         N'Pedido consolidado con proveedor nacional.');
    SET @id = SCOPE_IDENTITY();

    INSERT INTO dbo.solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen, precio_estimado)
    VALUES
        (@id, N'ACE-15W40', N'Aceite motor 15W40 cubeta 19L', 10, 2, 2480.00);

    INSERT INTO dbo.solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario)
    VALUES
        (@id, @vendedor2, NULL,              N'Pendiente',     N'Solicitud creada por el vendedor.'),
        (@id, @comprador, N'Pendiente',      N'En Cotizacion', N'Solicitando precio a 3 proveedores.'),
        (@id, @comprador, N'En Cotizacion',  N'En Transito',   N'Orden de compra OC-3391 colocada.');

    -- 3) Baja, ya recibida (alimenta el KPI de tiempo promedio de atención)
    INSERT INTO dbo.solicitudes_compras
        (id_vendedor, id_sucursal, id_cliente, prioridad, estatus_actual,
         fecha_creacion, fecha_promesa_entrega, fecha_cierre, id_comprador_asignado)
    VALUES
        (@vendedor1, @torreon, @cliente3, N'Baja', N'Recibido',
         DATEADD(DAY, -9, SYSUTCDATETIME()),
         DATEADD(DAY, -2, CAST(SYSUTCDATETIME() AS DATE)),
         DATEADD(DAY, -2, SYSUTCDATETIME()),
         @comprador);
    SET @id = SCOPE_IDENTITY();

    INSERT INTO dbo.solicitudes_detalle
        (id_solicitud, sku_producto, descripcion, cantidad_solicitada, existencia_real_almacen,
         precio_estimado, cantidad_surtida)
    VALUES
        (@id, N'FLT-4520', N'Filtro de aceite motor diésel 4520', 6, 0, 385.00, 6);

    INSERT INTO dbo.solicitud_historial
        (id_solicitud, id_usuario, estatus_anterior, estatus_nuevo, comentario, fecha_movimiento)
    VALUES
        (@id, @vendedor1, NULL,             N'Pendiente',   N'Solicitud creada por el vendedor.', DATEADD(DAY, -9, SYSUTCDATETIME())),
        (@id, @comprador, N'Pendiente',     N'Autorizada',  N'Autorizada por gerencia.',          DATEADD(DAY, -8, SYSUTCDATETIME())),
        (@id, @comprador, N'Autorizada',    N'En Transito', N'Embarque en ruta.',                 DATEADD(DAY, -5, SYSUTCDATETIME())),
        (@id, @comprador, N'En Transito',   N'Recibido',    N'Material recibido en almacén.',     DATEADD(DAY, -2, SYSUTCDATETIME()));

END
GO
