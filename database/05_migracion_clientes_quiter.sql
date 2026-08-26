-- =============================================================================
--  SGC - Migración 05: clientes reales de Quiter
--  Motor: PostgreSQL 14+
--
--  QUÉ HACE
--    Prepara la tabla `clientes` para recibir el padrón real del ERP en lugar
--    de los tres nombres inventados del seed:
--      · ciudad / estado    -> para distinguir homónimos, que en un padrón de
--                              cientos de clientes los hay
--      · origen             -> de dónde salió cada renglón (QUITER o DEMO)
--      · sincronizado_en    -> cuándo se confirmó por última vez contra el ERP
--
--  QUÉ **NO** HACE
--    NO borra los clientes ficticios, y NO los desactiva aquí.
--
--    No los borra porque hay cotizaciones y pedidos que apuntan a ellos: borrar
--    el cliente dejaría un folio histórico sin poder decir a quién se le vendió.
--
--    Y no los desactiva aquí porque esta migración corre también en una
--    instalación nueva, ANTES de que exista un solo cliente real. Apagarlos en
--    este momento dejaría el sistema sin ningún cliente a quién cotizar. Se
--    apagan solos en `clientes.service.js`, y solo después de que una
--    sincronización haya traído clientes de verdad.
--
--  SE PUEDE CORRER VARIAS VECES
--
--  CÓMO APLICARLO
--      cd backend && npm run db:migrar
-- =============================================================================

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ciudad         VARCHAR(120);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS estado         VARCHAR(120);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS origen         VARCHAR(10) NOT NULL DEFAULT 'DEMO';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sincronizado_en TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_clientes_origen') THEN
        ALTER TABLE clientes
            ADD CONSTRAINT ck_clientes_origen CHECK (origen IN ('QUITER', 'DEMO'));
        RAISE NOTICE '  + ck_clientes_origen';
    END IF;
END $$;

-- La sincronización identifica a cada cliente por su código del ERP, así que
-- necesita poder hacer ON CONFLICT sobre esa columna. El UNIQUE ya viene del
-- esquema; esto solo lo garantiza en bases que se hayan creado sin él.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'clientes' AND indexdef ILIKE '%UNIQUE%codigo_erp%'
    ) THEN
        CREATE UNIQUE INDEX ux_clientes_codigo_erp ON clientes (codigo_erp);
        RAISE NOTICE '  + ux_clientes_codigo_erp';
    END IF;
END $$;

-- El buscador escribe con acentos o sin ellos, y en minúsculas. Este índice
-- sirve al ILIKE sobre el nombre, que es por donde se busca el 99% de las veces.
CREATE INDEX IF NOT EXISTS idx_clientes_nombre_lower ON clientes (LOWER(nombre));
CREATE INDEX IF NOT EXISTS idx_clientes_activos ON clientes (activo, nombre);

DO $$
DECLARE
    faltantes INTEGER;
BEGIN
    SELECT COUNT(*) INTO faltantes
    FROM   information_schema.columns
    WHERE  table_name = 'clientes'
      AND  column_name IN ('ciudad','estado','origen','sincronizado_en');
    IF faltantes < 4 THEN
        RAISE EXCEPTION 'Migración 05 incompleta: faltan columnas en clientes.';
    END IF;
    RAISE NOTICE 'Migración 05 (clientes de Quiter) aplicada.';
END $$;
