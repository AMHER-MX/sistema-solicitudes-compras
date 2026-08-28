-- =============================================================================
--  SGC - Migración 06: lo que pidieron los compradores
--  Motor: PostgreSQL 14+
--
--  Cinco cambios, todos nacidos de cómo trabajan de verdad:
--
--  1. RANGO DE ENTREGA
--     Un proveedor no promete "el 30 de agosto", promete "entre el 30 y el 2".
--     `fecha_promesa_entrega` pasa a ser el inicio del rango y se agrega
--     `fecha_promesa_hasta`. Dejar sólo el inicio sigue siendo válido: es una
--     fecha exacta, que es como se venía usando.
--
--  2. ESTATUS DE COMPRAS
--     Una segunda columna, NO un reemplazo de `estatus_actual`. Son dos cosas
--     distintas y confundirlas costaría caro:
--
--       estatus_actual   dónde va el documento     (lo ve el vendedor/cliente)
--       estatus_compras  cómo va el trabajo interno (lo lleva el comprador)
--
--     Si se hubieran fundido en una sola columna, el vendedor tendría que
--     entender el vocabulario de Compras para saber si su cotización ya se
--     puede mandar, y Compras perdería el rastro de En Tránsito y Recibido —
--     que es justo lo que le avisa al vendedor cuándo llega la pieza.
--
--  3. VERSIÓN (recotización)
--     El folio NO cambia al recotizar: eso ya estaba decidido y sigue así. Lo
--     que cambia es el número de versión, para que "la cotización SC-2026-000012"
--     no signifique dos cosas distintas según quién tenga qué papel en la mano.
--
--  4. PRECIO PUESTO POR EL COMPRADOR
--     `precio_origen` dice de dónde salió el precio de cada partida: del
--     catálogo de Quiter o de la mano del comprador. Sin eso, el aviso de
--     "subió de precio en Quiter" empezaría a saltar sobre precios que el
--     comprador negoció a propósito, y en dos semanas nadie le haría caso a
--     ningún aviso.
--
--  5. PARTIDAS QUE NO EXISTEN EN QUITER
--     `origen` marca la partida que el vendedor tecleó a mano porque el cliente
--     pidió un número de parte que el inventario no conoce. Esas nunca tienen
--     existencia ni precio de lista, y por eso mandan la cotización a Compras
--     aunque todo lo demás esté disponible.
--
--  SE PUEDE CORRER VARIAS VECES. No toca ni un dato existente.
--
--  CÓMO APLICARLO
--      cd backend && npm run db:migrar
-- =============================================================================

-- ─── 1. Rango de entrega ─────────────────────────────────────────────────────
ALTER TABLE solicitudes_compras
    ADD COLUMN IF NOT EXISTS fecha_promesa_hasta DATE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitudes_rango_promesa') THEN
        ALTER TABLE solicitudes_compras ADD CONSTRAINT ck_solicitudes_rango_promesa CHECK (
            fecha_promesa_hasta IS NULL
         OR fecha_promesa_entrega IS NULL
         OR fecha_promesa_hasta >= fecha_promesa_entrega
        );
        RAISE NOTICE '  + ck_solicitudes_rango_promesa';
    END IF;
END $$;

-- ─── 2. Estatus de compras ───────────────────────────────────────────────────
ALTER TABLE solicitudes_compras
    ADD COLUMN IF NOT EXISTS estatus_compras VARCHAR(20);

ALTER TABLE solicitudes_compras
    ADD COLUMN IF NOT EXISTS estatus_compras_en TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitudes_estatus_compras') THEN
        ALTER TABLE solicitudes_compras ADD CONSTRAINT ck_solicitudes_estatus_compras CHECK (
            estatus_compras IS NULL
         OR estatus_compras IN ('En Cotizacion', 'Cotizacion Parcial', 'Completada', 'Cancelada')
        );
        RAISE NOTICE '  + ck_solicitudes_estatus_compras';
    END IF;
END $$;

-- Lo que ya está con Compras arranca en 'En Cotizacion': es donde realmente
-- está. Dejarlo en NULL haría que esos folios se vieran como si nadie los
-- estuviera trabajando.
UPDATE solicitudes_compras
   SET estatus_compras    = 'En Cotizacion',
       estatus_compras_en = NOW()
 WHERE estatus_actual  = 'Con Compras'
   AND estatus_compras IS NULL;

-- ─── 3. Versión ──────────────────────────────────────────────────────────────
ALTER TABLE solicitudes_compras
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitudes_version') THEN
        ALTER TABLE solicitudes_compras
            ADD CONSTRAINT ck_solicitudes_version CHECK (version >= 1);
        RAISE NOTICE '  + ck_solicitudes_version';
    END IF;
END $$;

-- ─── 4 y 5. Partidas: de dónde salió, y de dónde salió su precio ─────────────
ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'QUITER';

ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS precio_origen VARCHAR(10) NOT NULL DEFAULT 'QUITER';

ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS precio_puesto_por INTEGER REFERENCES usuarios (id);

ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS precio_puesto_en TIMESTAMPTZ;

-- Nota del comprador sobre la partida: con quién la consiguió, qué condición.
ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS nota_compras VARCHAR(255);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_detalle_origen') THEN
        ALTER TABLE solicitudes_detalle
            ADD CONSTRAINT ck_detalle_origen CHECK (origen IN ('QUITER', 'LIBRE'));
        RAISE NOTICE '  + ck_detalle_origen';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_detalle_precio_origen') THEN
        ALTER TABLE solicitudes_detalle
            ADD CONSTRAINT ck_detalle_precio_origen CHECK (precio_origen IN ('QUITER', 'COMPRADOR'));
        RAISE NOTICE '  + ck_detalle_precio_origen';
    END IF;
END $$;

-- Índice para la mesa de trabajo, que filtra por lo que le falta a Compras.
CREATE INDEX IF NOT EXISTS idx_solicitudes_estatus_compras
    ON solicitudes_compras (estatus_compras)
    WHERE estatus_compras IS NOT NULL;

-- ─── Comprobación ────────────────────────────────────────────────────────────
DO $$
DECLARE
    faltan INTEGER;
BEGIN
    SELECT 8 - COUNT(*) INTO faltan
    FROM   information_schema.columns
    WHERE  (table_name = 'solicitudes_compras'
            AND column_name IN ('fecha_promesa_hasta','estatus_compras','estatus_compras_en','version'))
       OR  (table_name = 'solicitudes_detalle'
            AND column_name IN ('origen','precio_origen','precio_puesto_por','precio_puesto_en'));

    IF faltan > 0 THEN
        RAISE EXCEPTION 'Migración 06 incompleta: faltan % columna(s).', faltan;
    END IF;
    RAISE NOTICE 'Migración 06 (cambios de compradores) aplicada.';
END $$;
