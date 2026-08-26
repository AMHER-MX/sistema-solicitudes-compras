-- =============================================================================
--  SGC - Sistema de Gestión de Solicitudes de Compras y Pedidos
--  Motor: PostgreSQL 14+
--  Archivo: 01_schema.sql  (estructura relacional)
--
--  IMPORTANTE: estas tablas viven en su PROPIA base de datos. Quiter no se
--  toca desde aquí: las existencias se leen por la API interna de refacciones,
--  y el ERP solo se LEE, nunca se escribe.
--
--  Aplicar este script:
--      cd backend && npm run db:setup
--
--  ⚠  Empieza tirando las tablas. Sobre una base en uso, BORRA todo lo
--     capturado. Para una base que ya tiene datos, el comando es db:migrar.
-- =============================================================================

-- Limpieza previa (útil en desarrollo). En producción NO ejecutar estos DROP.
DROP VIEW  IF EXISTS vw_solicitudes_resumen;
DROP TABLE IF EXISTS solicitud_historial;
DROP TABLE IF EXISTS solicitudes_detalle;
DROP TABLE IF EXISTS solicitudes_compras;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS sucursales;
DROP SEQUENCE IF EXISTS seq_folio_solicitud;

-- =============================================================================
-- 1. CATÁLOGOS BASE
-- =============================================================================

-- Sucursales / agencias. `clave` es la clave de ALMACÉN en Quiter
-- (columna ALMACEN de FTIGBI_PR): 101, 102, 103, 104, 201, 202, 203.
CREATE TABLE sucursales (
    id         INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clave      VARCHAR(20)  NOT NULL UNIQUE,
    nombre     VARCHAR(120) NOT NULL,
    ciudad     VARCHAR(80),
    activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Clientes a los que se les promete el material.
CREATE TABLE clientes (
    id          INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_erp  VARCHAR(40)  UNIQUE,          -- FMCUBI_PR.CUENTA en Quiter
    nombre      VARCHAR(180) NOT NULL,
    rfc         VARCHAR(20),
    telefono    VARCHAR(40),
    email       VARCHAR(120),
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clientes_nombre ON clientes (nombre);

-- =============================================================================
-- 2. USUARIOS   (roles: Vendedor | Comprador | Gerente)
-- =============================================================================

CREATE TABLE usuarios (
    id             INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre         VARCHAR(120) NOT NULL,
    email          VARCHAR(160) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,      -- bcrypt
    rol            VARCHAR(20)  NOT NULL,
    sucursal_id    INTEGER      REFERENCES sucursales (id),
    activo         BOOLEAN      NOT NULL DEFAULT TRUE,
    ultimo_acceso  TIMESTAMPTZ,
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Administración de cuentas.
    -- En TRUE, el usuario entra pero solo puede cambiar su contraseña temporal.
    debe_cambiar_password    BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Quién dio de alta la cuenta. NULL para las cuentas que carga el seed.
    creado_por               INTEGER     REFERENCES usuarios (id),
    -- NULL = nunca ha cambiado la contraseña desde que se creó la cuenta.
    password_actualizado_en  TIMESTAMPTZ,

    CONSTRAINT ck_usuarios_rol CHECK (rol IN ('Vendedor', 'Comprador', 'Gerente'))
);

CREATE INDEX idx_usuarios_rol        ON usuarios (rol);
CREATE INDEX idx_usuarios_sucursal   ON usuarios (sucursal_id);
CREATE INDEX idx_usuarios_rol_nombre ON usuarios (rol, nombre);

-- =============================================================================
-- 3. SOLICITUDES (ENCABEZADO)
--
--    Un solo renglón sirve para los dos documentos del negocio, distinguidos
--    por `tipo`. NO se copia nada al pasar de uno a otro: es el mismo id y el
--    mismo folio, que cambia de tipo. Por eso el folio "es el mismo si pasa a
--    pedido", y por eso la bitácora queda de un solo hilo.
--
--    Cotización (lo que ve el cliente; aquí nace todo):
--        Borrador -> [Con Compras, si hay faltantes] -> Enviada
--                    -> se convierte en Pedido   (el cliente aprobó)
--                    -> Vencida                  (pasó su plazo sin respuesta)
--                    -> Cancelada                (a mano)
--
--    Pedido (lo que ya se está surtiendo):
--        Pendiente -> Con Proveedor -> Autorizada -> En Transito -> Recibido
--                    (Cancelada / Rechazada son terminales alternos)
--
--    OJO con 'Con Proveedor': antes se llamaba 'En Cotizacion' y nunca quiso
--    decir "cotización al cliente", sino "Compras está pidiendo precio al
--    proveedor". Se renombró para que la palabra Cotización signifique una
--    sola cosa en todo el sistema.
-- =============================================================================

-- Secuencia del folio legible: SC-2026-000001
CREATE SEQUENCE seq_folio_solicitud AS INTEGER START WITH 1 INCREMENT BY 1;

CREATE TABLE solicitudes_compras (
    id                     INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- El folio se arma solo con la secuencia: no depende de la aplicación
    -- y no se puede repetir aunque dos vendedores capturen al mismo tiempo.
    folio                  VARCHAR(30)  NOT NULL UNIQUE
        DEFAULT ('SC-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                 LPAD(NEXTVAL('seq_folio_solicitud')::TEXT, 6, '0')),
    -- Todo nace como Cotización. Se vuelve Pedido solo si el cliente aprueba.
    tipo                   VARCHAR(12)  NOT NULL DEFAULT 'Cotizacion',
    id_vendedor            INTEGER      NOT NULL REFERENCES usuarios (id),
    id_sucursal            INTEGER      NOT NULL REFERENCES sucursales (id),
    id_cliente             INTEGER      REFERENCES clientes (id),
    prioridad              VARCHAR(10)  NOT NULL DEFAULT 'Normal',
    estatus_actual         VARCHAR(20)  NOT NULL DEFAULT 'Borrador',
    observaciones          TEXT,
    fecha_creacion         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    fecha_promesa_entrega  DATE,
    fecha_cierre           TIMESTAMPTZ,
    id_comprador_asignado  INTEGER      REFERENCES usuarios (id),
    actualizado_en         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Fechas propias de la cotización. El reloj de vencimiento arranca al
    -- ENVIAR, no al capturar: una cotización que sigue en borrador, o que está
    -- esperando a que Compras consiga precio de un faltante, no tiene por qué
    -- irse venciendo mientras el cliente ni siquiera la ha visto.
    enviada_en             TIMESTAMPTZ,
    vence_en               TIMESTAMPTZ,
    convertida_en          TIMESTAMPTZ,
    dias_vigencia          INTEGER      NOT NULL DEFAULT 30,

    CONSTRAINT ck_solicitudes_prioridad CHECK (prioridad IN ('Urgente', 'Normal', 'Baja')),
    CONSTRAINT ck_solicitudes_tipo      CHECK (tipo IN ('Cotizacion', 'Pedido')),
    CONSTRAINT ck_solicitudes_vigencia  CHECK (dias_vigencia BETWEEN 1 AND 365),
    CONSTRAINT ck_solicitudes_estatus CHECK (estatus_actual IN
        ('Borrador', 'Con Compras', 'Enviada', 'Vencida',
         'Pendiente', 'Con Proveedor', 'Autorizada', 'En Transito', 'Recibido',
         'Cancelada', 'Rechazada')),

    -- Un estatus de cotización dentro de un Pedido (o al revés) sería un
    -- documento que ninguna pantalla sabe dibujar. Se impide de raíz.
    CONSTRAINT ck_solicitudes_tipo_estatus CHECK (
        (tipo = 'Cotizacion'
         AND estatus_actual IN ('Borrador','Con Compras','Enviada','Vencida','Cancelada'))
     OR (tipo = 'Pedido'
         AND estatus_actual IN ('Pendiente','Con Proveedor','Autorizada',
                                'En Transito','Recibido','Cancelada','Rechazada'))
    )
);

-- Índices pensados para los filtros reales de la Mesa de Trabajo y el Dashboard.
CREATE INDEX idx_sol_vendedor          ON solicitudes_compras (id_vendedor);
CREATE INDEX idx_sol_sucursal          ON solicitudes_compras (id_sucursal);
CREATE INDEX idx_sol_estatus           ON solicitudes_compras (estatus_actual);
CREATE INDEX idx_sol_prioridad         ON solicitudes_compras (prioridad);
CREATE INDEX idx_sol_fecha_creacion    ON solicitudes_compras (fecha_creacion DESC);
CREATE INDEX idx_sol_estatus_prioridad ON solicitudes_compras (estatus_actual, prioridad);
CREATE INDEX idx_sol_tipo              ON solicitudes_compras (tipo);
CREATE INDEX idx_sol_tipo_estatus      ON solicitudes_compras (tipo, estatus_actual);

-- El vigía busca justo esto varias veces al día: cotizaciones enviadas cuyo
-- plazo ya pasó. Parcial, para que el índice solo cargue lo que puede vencer.
CREATE INDEX idx_sol_por_vencer ON solicitudes_compras (vence_en)
    WHERE estatus_actual = 'Enviada';

-- =============================================================================
-- 4. DETALLE DE LA SOLICITUD (PARTIDAS)
-- =============================================================================

CREATE TABLE solicitudes_detalle (
    id                       INTEGER       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_solicitud             INTEGER       NOT NULL
        -- Borrar la solicitud borra sus partidas.
        REFERENCES solicitudes_compras (id) ON DELETE CASCADE,
    sku_producto             VARCHAR(60)   NOT NULL,   -- FTIGBI_PR.ARTICULO
    descripcion              VARCHAR(255)  NOT NULL,   -- FTIGBI_PR.DES_ARTICULO
    cantidad_solicitada      NUMERIC(12,2) NOT NULL,
    -- Foto de FTIGBI_PR.EXIS_REALES al momento de levantar la solicitud.
    existencia_real_almacen  NUMERIC(12,2) NOT NULL DEFAULT 0,
    precio_estimado          NUMERIC(12,2),            -- precio_lista al capturar

    -- Los dos precios son cosas distintas y por eso son dos columnas:
    --   precio_cotizado      lo que se le prometió al cliente. Se congela al
    --                        enviar la cotización y NO se vuelve a tocar.
    --   precio_lista_actual  lo que Quiter dice HOY. Lo refresca el vigía.
    --                        Nunca sustituye al cotizado: solo sirve para
    --                        avisar "esto subió, decide si lo respetas".
    -- Meterlos en una sola columna sería el error clásico: el papel que trae
    -- el cliente y la pantalla dejarían de coincidir sin que nadie se entere.
    precio_cotizado          NUMERIC(12,2),
    precio_lista_actual      NUMERIC(12,2),
    precio_actualizado_en    TIMESTAMPTZ,

    cantidad_surtida         NUMERIC(12,2) NOT NULL DEFAULT 0,
    creado_en                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_detalle_cantidad CHECK (cantidad_solicitada > 0)
);

CREATE INDEX idx_detalle_solicitud ON solicitudes_detalle (id_solicitud);
CREATE INDEX idx_detalle_sku       ON solicitudes_detalle (sku_producto);

-- =============================================================================
-- 5. HISTORIAL / BITÁCORA
--    Cada cambio de estatus deja huella: quién, cuándo y por qué.
-- =============================================================================

CREATE TABLE solicitud_historial (
    id                INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_solicitud      INTEGER     NOT NULL
        REFERENCES solicitudes_compras (id) ON DELETE CASCADE,
    id_usuario        INTEGER     NOT NULL REFERENCES usuarios (id),
    estatus_anterior  VARCHAR(20),            -- NULL en el alta
    estatus_nuevo     VARCHAR(20) NOT NULL,
    comentario        TEXT,
    fecha_movimiento  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_historial_solicitud ON solicitud_historial (id_solicitud, fecha_movimiento);
CREATE INDEX idx_historial_usuario   ON solicitud_historial (id_usuario);

-- =============================================================================
-- 6. VISTA DE APOYO PARA EL DASHBOARD
-- =============================================================================

CREATE VIEW vw_solicitudes_resumen AS
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
        COALESCE(SUM(d.cantidad_solicitada * COALESCE(d.precio_estimado, 0)), 0) AS monto_estimado,
        -- Horas transcurridas hasta el cierre (o hasta ahora si sigue abierta).
        EXTRACT(EPOCH FROM (COALESCE(s.fecha_cierre, NOW()) - s.fecha_creacion)) / 3600.0 AS horas_atencion
FROM        solicitudes_compras s
JOIN        usuarios   u  ON u.id  = s.id_vendedor
JOIN        sucursales su ON su.id = s.id_sucursal
LEFT JOIN   clientes   c  ON c.id  = s.id_cliente
LEFT JOIN   solicitudes_detalle d ON d.id_solicitud = s.id
GROUP BY    s.id, s.folio, s.prioridad, s.estatus_actual, s.fecha_creacion,
            s.fecha_promesa_entrega, s.fecha_cierre, u.nombre, su.nombre, c.nombre;
