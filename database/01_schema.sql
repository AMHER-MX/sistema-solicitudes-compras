-- =============================================================================
--  SGC - Sistema de Gestión de Solicitudes de Compras y Pedidos
--  Motor: PostgreSQL 14+
--  Archivo: 01_schema.sql  (estructura relacional)
--
--  Ejecutar con:
--    psql -U postgres -d sgc_compras -f database/01_schema.sql
-- =============================================================================

-- Nos aseguramos de trabajar sobre un esquema limpio (útil en desarrollo).
-- ¡OJO! En producción NO ejecutar estos DROP.
DROP TABLE IF EXISTS solicitud_historial CASCADE;
DROP TABLE IF EXISTS solicitudes_detalle CASCADE;
DROP TABLE IF EXISTS solicitudes_compras CASCADE;
DROP TABLE IF EXISTS usuarios            CASCADE;
DROP TABLE IF EXISTS clientes            CASCADE;
DROP TABLE IF EXISTS sucursales          CASCADE;

-- =============================================================================
-- 1. CATÁLOGOS BASE
-- =============================================================================

-- Sucursales / agencias de la distribuidora.
CREATE TABLE sucursales (
    id          SERIAL       PRIMARY KEY,
    clave       VARCHAR(20)  NOT NULL UNIQUE,   -- clave usada en el ERP Quiter
    nombre      VARCHAR(120) NOT NULL,
    ciudad      VARCHAR(80),
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN sucursales.clave IS 'Clave de sucursal equivalente en el ERP (Quiter)';

-- Clientes a los que se les cotiza / vende el material solicitado.
CREATE TABLE clientes (
    id            SERIAL       PRIMARY KEY,
    codigo_erp    VARCHAR(40)  UNIQUE,          -- código de cliente en Quiter
    nombre        VARCHAR(180) NOT NULL,
    rfc           VARCHAR(20),
    telefono      VARCHAR(40),
    email         VARCHAR(120),
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clientes_nombre ON clientes (LOWER(nombre));

-- =============================================================================
-- 2. USUARIOS
--    Roles soportados: Vendedor | Comprador | Gerente
-- =============================================================================

CREATE TABLE usuarios (
    id              SERIAL       PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL,
    email           VARCHAR(160) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,       -- bcrypt
    rol             VARCHAR(20)  NOT NULL,
    sucursal_id     INTEGER      NULL,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    ultimo_acceso   TIMESTAMPTZ  NULL,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_usuarios_rol
        CHECK (rol IN ('Vendedor', 'Comprador', 'Gerente')),
    CONSTRAINT fk_usuarios_sucursal
        FOREIGN KEY (sucursal_id) REFERENCES sucursales (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX idx_usuarios_rol      ON usuarios (rol);
CREATE INDEX idx_usuarios_sucursal ON usuarios (sucursal_id);

-- =============================================================================
-- 3. SOLICITUDES DE COMPRA (ENCABEZADO)
--    Flujo de estatus:
--      Pendiente -> En Cotizacion -> Autorizada -> En Transito -> Recibido
--      (Cancelada / Rechazada son estados terminales alternos)
-- =============================================================================

-- Secuencia usada para construir el folio legible (SC-2026-000001).
CREATE SEQUENCE IF NOT EXISTS seq_folio_solicitud START 1;

CREATE TABLE solicitudes_compras (
    id                      SERIAL       PRIMARY KEY,
    folio                   VARCHAR(30)  NOT NULL UNIQUE,
    id_vendedor             INTEGER      NOT NULL,
    id_sucursal             INTEGER      NOT NULL,
    id_cliente              INTEGER      NULL,   -- puede ser stock propio, sin cliente
    prioridad               VARCHAR(10)  NOT NULL DEFAULT 'Normal',
    estatus_actual          VARCHAR(20)  NOT NULL DEFAULT 'Pendiente',
    observaciones           TEXT         NULL,
    fecha_creacion          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    fecha_promesa_entrega   DATE         NULL,   -- la fija Compras al dar seguimiento
    fecha_cierre            TIMESTAMPTZ  NULL,   -- se sella al llegar a Recibido/Cancelada
    id_comprador_asignado   INTEGER      NULL,
    actualizado_en          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_solicitudes_prioridad
        CHECK (prioridad IN ('Urgente', 'Normal', 'Baja')),
    CONSTRAINT chk_solicitudes_estatus
        CHECK (estatus_actual IN ('Pendiente', 'En Cotizacion', 'Autorizada',
                                  'En Transito', 'Recibido', 'Cancelada', 'Rechazada')),
    CONSTRAINT fk_solicitudes_vendedor
        FOREIGN KEY (id_vendedor)  REFERENCES usuarios (id)   ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_solicitudes_sucursal
        FOREIGN KEY (id_sucursal)  REFERENCES sucursales (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_solicitudes_cliente
        FOREIGN KEY (id_cliente)   REFERENCES clientes (id)   ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_solicitudes_comprador
        FOREIGN KEY (id_comprador_asignado) REFERENCES usuarios (id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Índices pensados para los filtros de la Mesa de Trabajo y el Dashboard.
CREATE INDEX idx_sol_vendedor        ON solicitudes_compras (id_vendedor);
CREATE INDEX idx_sol_sucursal        ON solicitudes_compras (id_sucursal);
CREATE INDEX idx_sol_estatus         ON solicitudes_compras (estatus_actual);
CREATE INDEX idx_sol_prioridad       ON solicitudes_compras (prioridad);
CREATE INDEX idx_sol_fecha_creacion  ON solicitudes_compras (fecha_creacion DESC);
-- Índice compuesto para la consulta más frecuente: bandeja abierta por prioridad.
CREATE INDEX idx_sol_estatus_prioridad ON solicitudes_compras (estatus_actual, prioridad);

-- =============================================================================
-- 4. DETALLE DE LA SOLICITUD (PARTIDAS)
-- =============================================================================

CREATE TABLE solicitudes_detalle (
    id                        SERIAL        PRIMARY KEY,
    id_solicitud              INTEGER       NOT NULL,
    sku_producto              VARCHAR(60)   NOT NULL,
    descripcion               VARCHAR(255)  NOT NULL,
    cantidad_solicitada       NUMERIC(12,2) NOT NULL,
    existencia_real_almacen   NUMERIC(12,2) NOT NULL DEFAULT 0, -- foto del ERP al momento de solicitar
    precio_estimado           NUMERIC(12,2) NULL,
    cantidad_surtida          NUMERIC(12,2) NOT NULL DEFAULT 0,
    creado_en                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_detalle_cantidad
        CHECK (cantidad_solicitada > 0),
    CONSTRAINT fk_detalle_solicitud
        FOREIGN KEY (id_solicitud) REFERENCES solicitudes_compras (id)
        ON UPDATE CASCADE ON DELETE CASCADE   -- borrar la solicitud borra sus partidas
);

CREATE INDEX idx_detalle_solicitud ON solicitudes_detalle (id_solicitud);
CREATE INDEX idx_detalle_sku       ON solicitudes_detalle (sku_producto);

-- =============================================================================
-- 5. HISTORIAL / BITÁCORA DE MOVIMIENTOS
--    Cada cambio de estatus deja huella: quién, cuándo y por qué.
-- =============================================================================

CREATE TABLE solicitud_historial (
    id                SERIAL       PRIMARY KEY,
    id_solicitud      INTEGER      NOT NULL,
    id_usuario        INTEGER      NOT NULL,
    estatus_anterior  VARCHAR(20)  NULL,        -- NULL en el alta de la solicitud
    estatus_nuevo     VARCHAR(20)  NOT NULL,
    comentario        TEXT         NULL,
    fecha_movimiento  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_historial_solicitud
        FOREIGN KEY (id_solicitud) REFERENCES solicitudes_compras (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_historial_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_historial_solicitud ON solicitud_historial (id_solicitud, fecha_movimiento);
CREATE INDEX idx_historial_usuario   ON solicitud_historial (id_usuario);

-- =============================================================================
-- 6. FUNCIONES Y TRIGGERS DE APOYO
-- =============================================================================

-- 6.1 Generador de folio legible: SC-<año>-<consecutivo 6 dígitos>
CREATE OR REPLACE FUNCTION fn_generar_folio()
RETURNS VARCHAR AS $$
BEGIN
    RETURN 'SC-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD(NEXTVAL('seq_folio_solicitud')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- 6.2 Asigna folio automáticamente si el backend no lo envía.
CREATE OR REPLACE FUNCTION trg_set_folio()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.folio IS NULL OR NEW.folio = '' THEN
        NEW.folio := fn_generar_folio();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_solicitudes_folio
    BEFORE INSERT ON solicitudes_compras
    FOR EACH ROW EXECUTE FUNCTION trg_set_folio();

-- 6.3 Mantiene actualizado_en al vuelo.
CREATE OR REPLACE FUNCTION trg_touch_actualizado()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_solicitudes_touch
    BEFORE UPDATE ON solicitudes_compras
    FOR EACH ROW EXECUTE FUNCTION trg_touch_actualizado();

-- =============================================================================
-- 7. VISTA DE APOYO PARA EL DASHBOARD
--    Aplana encabezado + conteo de partidas para consultas rápidas.
-- =============================================================================

CREATE OR REPLACE VIEW vw_solicitudes_resumen AS
SELECT  s.id,
        s.folio,
        s.prioridad,
        s.estatus_actual,
        s.fecha_creacion,
        s.fecha_promesa_entrega,
        s.fecha_cierre,
        u.nombre           AS vendedor,
        su.nombre          AS sucursal,
        c.nombre           AS cliente,
        COUNT(d.id)        AS total_partidas,
        COALESCE(SUM(d.cantidad_solicitada * COALESCE(d.precio_estimado, 0)), 0) AS monto_estimado,
        -- Horas transcurridas hasta el cierre (o hasta hoy si sigue abierta).
        EXTRACT(EPOCH FROM (COALESCE(s.fecha_cierre, NOW()) - s.fecha_creacion)) / 3600 AS horas_atencion
FROM        solicitudes_compras s
JOIN        usuarios   u  ON u.id  = s.id_vendedor
JOIN        sucursales su ON su.id = s.id_sucursal
LEFT JOIN   clientes   c  ON c.id  = s.id_cliente
LEFT JOIN   solicitudes_detalle d ON d.id_solicitud = s.id
GROUP BY    s.id, u.nombre, su.nombre, c.nombre;
