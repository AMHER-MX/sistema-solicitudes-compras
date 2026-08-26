-- =============================================================================
--  SGC - Sistema de Gestión de Solicitudes de Compras y Pedidos
--  Motor: Microsoft SQL Server 2016+
--  Archivo: 01_schema.sql  (estructura relacional)
--
--  IMPORTANTE: estas tablas viven en su PROPIA base de datos (SGC_COMPRAS),
--  no dentro de la base de Quiter. Mismo servidor y mismo respaldo, pero sin
--  ninguna posibilidad de tocar el esquema del ERP. A Quiter solo se le LEE.
--
--  Crear la base una sola vez:
--      CREATE DATABASE SGC_COMPRAS;
--
--  Aplicar este script:
--      cd backend && npm run db:setup
--  o bien:
--      sqlcmd -S localhost -d SGC_COMPRAS -i database/01_schema.sql
-- =============================================================================

-- Limpieza previa (útil en desarrollo). En producción NO ejecutar estos DROP.
IF OBJECT_ID('dbo.vw_solicitudes_resumen', 'V') IS NOT NULL DROP VIEW dbo.vw_solicitudes_resumen;
IF OBJECT_ID('dbo.solicitud_historial',    'U') IS NOT NULL DROP TABLE dbo.solicitud_historial;
IF OBJECT_ID('dbo.solicitudes_detalle',    'U') IS NOT NULL DROP TABLE dbo.solicitudes_detalle;
IF OBJECT_ID('dbo.solicitudes_compras',    'U') IS NOT NULL DROP TABLE dbo.solicitudes_compras;
IF OBJECT_ID('dbo.usuarios',               'U') IS NOT NULL DROP TABLE dbo.usuarios;
IF OBJECT_ID('dbo.clientes',               'U') IS NOT NULL DROP TABLE dbo.clientes;
IF OBJECT_ID('dbo.sucursales',             'U') IS NOT NULL DROP TABLE dbo.sucursales;
IF OBJECT_ID('dbo.seq_folio_solicitud', 'SO') IS NOT NULL DROP SEQUENCE dbo.seq_folio_solicitud;
GO

-- =============================================================================
-- 1. CATÁLOGOS BASE
-- =============================================================================

-- Sucursales / agencias. `clave` es la clave de ALMACÉN en Quiter
-- (columna ALMACEN de FTIGBI_PR): 101, 102, 103, 104, 201, 202, 203.
CREATE TABLE dbo.sucursales (
    id         INT            IDENTITY(1,1) NOT NULL,
    clave      NVARCHAR(20)   NOT NULL,
    nombre     NVARCHAR(120)  NOT NULL,
    ciudad     NVARCHAR(80)   NULL,
    activo     BIT            NOT NULL CONSTRAINT DF_sucursales_activo DEFAULT (1),
    creado_en  DATETIME2(3)   NOT NULL CONSTRAINT DF_sucursales_creado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_sucursales  PRIMARY KEY (id),
    CONSTRAINT UQ_sucursales_clave UNIQUE (clave)
);
GO

-- Clientes a los que se les promete el material.
CREATE TABLE dbo.clientes (
    id          INT            IDENTITY(1,1) NOT NULL,
    codigo_erp  NVARCHAR(40)   NULL,          -- FMCUBI_PR.CUENTA en Quiter
    nombre      NVARCHAR(180)  NOT NULL,
    rfc         NVARCHAR(20)   NULL,
    telefono    NVARCHAR(40)   NULL,
    email       NVARCHAR(120)  NULL,
    activo      BIT            NOT NULL CONSTRAINT DF_clientes_activo DEFAULT (1),
    creado_en   DATETIME2(3)   NOT NULL CONSTRAINT DF_clientes_creado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_clientes PRIMARY KEY (id),
    CONSTRAINT UQ_clientes_codigo_erp UNIQUE (codigo_erp)
);
GO

CREATE INDEX idx_clientes_nombre ON dbo.clientes (nombre);
GO

-- =============================================================================
-- 2. USUARIOS   (roles: Vendedor | Comprador | Gerente)
-- =============================================================================

CREATE TABLE dbo.usuarios (
    id             INT            IDENTITY(1,1) NOT NULL,
    nombre         NVARCHAR(120)  NOT NULL,
    email          NVARCHAR(160)  NOT NULL,
    password_hash  NVARCHAR(255)  NOT NULL,      -- bcrypt
    rol            NVARCHAR(20)   NOT NULL,
    sucursal_id    INT            NULL,
    activo         BIT            NOT NULL CONSTRAINT DF_usuarios_activo DEFAULT (1),
    ultimo_acceso  DATETIME2(3)   NULL,
    creado_en      DATETIME2(3)   NOT NULL CONSTRAINT DF_usuarios_creado DEFAULT (SYSUTCDATETIME()),

    -- Administración de cuentas (ver database/03_migracion_usuarios.sql).
    -- En 1, el usuario entra pero solo puede cambiar su contraseña temporal.
    debe_cambiar_password    BIT          NOT NULL
        CONSTRAINT DF_usuarios_debe_cambiar DEFAULT (0),
    -- Quién dio de alta la cuenta. NULL para las cuentas que carga el seed.
    creado_por               INT          NULL,
    -- NULL = nunca ha cambiado la contraseña desde que se creó la cuenta.
    password_actualizado_en  DATETIME2(3) NULL,

    CONSTRAINT PK_usuarios PRIMARY KEY (id),
    CONSTRAINT UQ_usuarios_email UNIQUE (email),
    CONSTRAINT CK_usuarios_rol CHECK (rol IN ('Vendedor', 'Comprador', 'Gerente')),
    CONSTRAINT FK_usuarios_sucursal FOREIGN KEY (sucursal_id)
        REFERENCES dbo.sucursales (id),
    CONSTRAINT FK_usuarios_creado_por FOREIGN KEY (creado_por)
        REFERENCES dbo.usuarios (id)
);
GO

CREATE INDEX idx_usuarios_rol        ON dbo.usuarios (rol);
CREATE INDEX idx_usuarios_sucursal   ON dbo.usuarios (sucursal_id);
CREATE INDEX idx_usuarios_rol_nombre ON dbo.usuarios (rol, nombre);
GO

-- =============================================================================
-- 3. SOLICITUDES DE COMPRA (ENCABEZADO)
--    Flujo: Pendiente -> En Cotizacion -> Autorizada -> En Transito -> Recibido
--           (Cancelada / Rechazada son estados terminales alternos)
-- =============================================================================

-- Secuencia del folio legible: SC-2026-000001
CREATE SEQUENCE dbo.seq_folio_solicitud AS INT START WITH 1 INCREMENT BY 1;
GO

CREATE TABLE dbo.solicitudes_compras (
    id                     INT            IDENTITY(1,1) NOT NULL,
    -- El folio se arma solo con la secuencia: no depende de la aplicación
    -- y no se puede repetir aunque dos vendedores capturen al mismo tiempo.
    folio                  NVARCHAR(30)   NOT NULL
        CONSTRAINT DF_solicitudes_folio DEFAULT (
            'SC-' + CONVERT(NVARCHAR(4), YEAR(SYSUTCDATETIME())) + '-' +
            RIGHT('000000' + CONVERT(NVARCHAR(10), NEXT VALUE FOR dbo.seq_folio_solicitud), 6)
        ),
    id_vendedor            INT            NOT NULL,
    id_sucursal            INT            NOT NULL,
    id_cliente             INT            NULL,
    prioridad              NVARCHAR(10)   NOT NULL CONSTRAINT DF_solicitudes_prioridad DEFAULT ('Normal'),
    estatus_actual         NVARCHAR(20)   NOT NULL CONSTRAINT DF_solicitudes_estatus   DEFAULT ('Pendiente'),
    observaciones          NVARCHAR(MAX)  NULL,
    fecha_creacion         DATETIME2(3)   NOT NULL CONSTRAINT DF_solicitudes_creacion  DEFAULT (SYSUTCDATETIME()),
    fecha_promesa_entrega  DATE           NULL,
    fecha_cierre           DATETIME2(3)   NULL,
    id_comprador_asignado  INT            NULL,
    actualizado_en         DATETIME2(3)   NOT NULL CONSTRAINT DF_solicitudes_actualizado DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_solicitudes PRIMARY KEY (id),
    CONSTRAINT UQ_solicitudes_folio UNIQUE (folio),
    CONSTRAINT CK_solicitudes_prioridad CHECK (prioridad IN ('Urgente', 'Normal', 'Baja')),
    CONSTRAINT CK_solicitudes_estatus CHECK (estatus_actual IN
        ('Pendiente', 'En Cotizacion', 'Autorizada', 'En Transito', 'Recibido', 'Cancelada', 'Rechazada')),
    CONSTRAINT FK_solicitudes_vendedor  FOREIGN KEY (id_vendedor) REFERENCES dbo.usuarios (id),
    CONSTRAINT FK_solicitudes_sucursal  FOREIGN KEY (id_sucursal) REFERENCES dbo.sucursales (id),
    CONSTRAINT FK_solicitudes_cliente   FOREIGN KEY (id_cliente)  REFERENCES dbo.clientes (id),
    CONSTRAINT FK_solicitudes_comprador FOREIGN KEY (id_comprador_asignado) REFERENCES dbo.usuarios (id)
);
GO

-- Índices pensados para los filtros reales de la Mesa de Trabajo y el Dashboard.
CREATE INDEX idx_sol_vendedor          ON dbo.solicitudes_compras (id_vendedor);
CREATE INDEX idx_sol_sucursal          ON dbo.solicitudes_compras (id_sucursal);
CREATE INDEX idx_sol_estatus           ON dbo.solicitudes_compras (estatus_actual);
CREATE INDEX idx_sol_prioridad         ON dbo.solicitudes_compras (prioridad);
CREATE INDEX idx_sol_fecha_creacion    ON dbo.solicitudes_compras (fecha_creacion DESC);
CREATE INDEX idx_sol_estatus_prioridad ON dbo.solicitudes_compras (estatus_actual, prioridad);
GO

-- =============================================================================
-- 4. DETALLE DE LA SOLICITUD (PARTIDAS)
-- =============================================================================

CREATE TABLE dbo.solicitudes_detalle (
    id                       INT            IDENTITY(1,1) NOT NULL,
    id_solicitud             INT            NOT NULL,
    sku_producto             NVARCHAR(60)   NOT NULL,   -- FTIGBI_PR.ARTICULO
    descripcion              NVARCHAR(255)  NOT NULL,   -- FTIGBI_PR.DES_ARTICULO
    cantidad_solicitada      DECIMAL(12,2)  NOT NULL,
    -- Foto de FTIGBI_PR.EXIS_REALES al momento de levantar la solicitud.
    existencia_real_almacen  DECIMAL(12,2)  NOT NULL CONSTRAINT DF_detalle_existencia DEFAULT (0),
    precio_estimado          DECIMAL(12,2)  NULL,       -- FTIGBI_PR.COSTO_MEDIO
    cantidad_surtida         DECIMAL(12,2)  NOT NULL CONSTRAINT DF_detalle_surtida    DEFAULT (0),
    creado_en                DATETIME2(3)   NOT NULL CONSTRAINT DF_detalle_creado     DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_detalle PRIMARY KEY (id),
    CONSTRAINT CK_detalle_cantidad CHECK (cantidad_solicitada > 0),
    -- Borrar la solicitud borra sus partidas.
    CONSTRAINT FK_detalle_solicitud FOREIGN KEY (id_solicitud)
        REFERENCES dbo.solicitudes_compras (id) ON DELETE CASCADE
);
GO

CREATE INDEX idx_detalle_solicitud ON dbo.solicitudes_detalle (id_solicitud);
CREATE INDEX idx_detalle_sku       ON dbo.solicitudes_detalle (sku_producto);
GO

-- =============================================================================
-- 5. HISTORIAL / BITÁCORA
--    Cada cambio de estatus deja huella: quién, cuándo y por qué.
-- =============================================================================

CREATE TABLE dbo.solicitud_historial (
    id                INT            IDENTITY(1,1) NOT NULL,
    id_solicitud      INT            NOT NULL,
    id_usuario        INT            NOT NULL,
    estatus_anterior  NVARCHAR(20)   NULL,       -- NULL en el alta
    estatus_nuevo     NVARCHAR(20)   NOT NULL,
    comentario        NVARCHAR(MAX)  NULL,
    fecha_movimiento  DATETIME2(3)   NOT NULL CONSTRAINT DF_historial_fecha DEFAULT (SYSUTCDATETIME()),

    CONSTRAINT PK_historial PRIMARY KEY (id),
    CONSTRAINT FK_historial_solicitud FOREIGN KEY (id_solicitud)
        REFERENCES dbo.solicitudes_compras (id) ON DELETE CASCADE,
    CONSTRAINT FK_historial_usuario FOREIGN KEY (id_usuario)
        REFERENCES dbo.usuarios (id)
);
GO

CREATE INDEX idx_historial_solicitud ON dbo.solicitud_historial (id_solicitud, fecha_movimiento);
CREATE INDEX idx_historial_usuario   ON dbo.solicitud_historial (id_usuario);
GO

-- =============================================================================
-- 6. VISTA DE APOYO PARA EL DASHBOARD
-- =============================================================================

CREATE VIEW dbo.vw_solicitudes_resumen AS
SELECT  s.id,
        s.folio,
        s.prioridad,
        s.estatus_actual,
        s.fecha_creacion,
        s.fecha_promesa_entrega,
        s.fecha_cierre,
        u.nombre   AS vendedor,
        su.nombre  AS sucursal,
        c.nombre   AS cliente,
        COUNT(d.id) AS total_partidas,
        ISNULL(SUM(d.cantidad_solicitada * ISNULL(d.precio_estimado, 0)), 0) AS monto_estimado,
        -- Horas transcurridas hasta el cierre (o hasta ahora si sigue abierta).
        DATEDIFF(SECOND, s.fecha_creacion, ISNULL(s.fecha_cierre, SYSUTCDATETIME())) / 3600.0 AS horas_atencion
FROM        dbo.solicitudes_compras s
JOIN        dbo.usuarios   u  ON u.id  = s.id_vendedor
JOIN        dbo.sucursales su ON su.id = s.id_sucursal
LEFT JOIN   dbo.clientes   c  ON c.id  = s.id_cliente
LEFT JOIN   dbo.solicitudes_detalle d ON d.id_solicitud = s.id
GROUP BY    s.id, s.folio, s.prioridad, s.estatus_actual, s.fecha_creacion,
            s.fecha_promesa_entrega, s.fecha_cierre, u.nombre, su.nombre, c.nombre;
GO
