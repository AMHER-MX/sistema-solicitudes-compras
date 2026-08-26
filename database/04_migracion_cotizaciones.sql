-- =============================================================================
--  SGC - Migración 04: Cotizaciones y Pedidos
--  Motor: PostgreSQL 14+
--
--  QUÉ HACE
--    Parte el flujo en dos documentos que comparten UN SOLO folio:
--
--      Cotización  -> lo que ve el cliente. Nace aquí todo.
--      Pedido      -> la cotización que el cliente aprobó.
--
--    Un documento NO se copia al convertirse: es el mismo renglón, con el
--    mismo id y el mismo folio, que cambia de `tipo`. Eso es exactamente lo
--    que se pidió ("que cada cotización lleve un folio y sea el mismo si pasa
--    a pedido"), y de paso hace que la bitácora quede completa: el historial
--    de la cotización y el del pedido son el mismo hilo.
--
--  EL CHOQUE DE NOMBRES QUE RESUELVE
--    El estatus 'En Cotizacion' NUNCA significó "cotización al cliente":
--    significaba "Compras está pidiendo precio al proveedor". Con el nuevo
--    documento llamado Cotización, dejar los dos era garantía de confusión,
--    así que el viejo pasa a llamarse 'Con Proveedor', que es lo que es.
--
--  QUÉ **NO** HACE
--    No borra nada. Las solicitudes que ya existen se quedan como Pedidos —
--    son trabajo real en curso, no cotizaciones sin responder— y conservan su
--    folio, su historial y su estatus.
--
--  SE PUEDE CORRER VARIAS VECES
--    Cada paso revisa antes si ya está aplicado.
--
--  CÓMO APLICARLO
--      cd backend && npm run db:migrar
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TIPO DE DOCUMENTO
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFAULT 'Pedido' a propósito: al aplicar la migración, todo lo que ya existe
-- queda como Pedido. El default se cambia a 'Cotizacion' al final del archivo,
-- ya que los renglones viejos están clasificados, para que lo NUEVO nazca como
-- cotización.
ALTER TABLE solicitudes_compras
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(12) NOT NULL DEFAULT 'Pedido';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FECHAS PROPIAS DE LA COTIZACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
--   enviada_en    -> cuándo se mandó al cliente. Aquí arranca el reloj.
--   vence_en      -> hasta cuándo la respetamos. Se sella al enviar.
--   convertida_en -> cuándo el cliente la aprobó y se volvió Pedido.
--
-- El reloj arranca al ENVIAR, no al capturar: una cotización que sigue en
-- borrador, o esperando a que Compras consiga precio de un faltante, no tiene
-- por qué irse venciendo mientras el cliente ni siquiera la ha visto.
ALTER TABLE solicitudes_compras ADD COLUMN IF NOT EXISTS enviada_en    TIMESTAMPTZ;
ALTER TABLE solicitudes_compras ADD COLUMN IF NOT EXISTS vence_en      TIMESTAMPTZ;
ALTER TABLE solicitudes_compras ADD COLUMN IF NOT EXISTS convertida_en TIMESTAMPTZ;

-- Días de vigencia de ESTA cotización. Configurable por documento porque a un
-- cliente grande se le puede dar más plazo, pero con 30 de omisión.
ALTER TABLE solicitudes_compras
    ADD COLUMN IF NOT EXISTS dias_vigencia INTEGER NOT NULL DEFAULT 30;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PRECIOS: EL CONGELADO Y EL VIVO
-- ─────────────────────────────────────────────────────────────────────────────
-- Son dos cosas distintas y por eso son dos columnas distintas:
--
--   precio_cotizado      El precio que se le prometió al cliente. Se congela
--                        en el momento de enviar la cotización y NO se vuelve
--                        a tocar. Es lo que trae el cliente en la mano.
--
--   precio_lista_actual  Lo que Quiter dice HOY. Lo refresca solo el vigía.
--                        Nunca sustituye al cotizado: solo permite avisar
--                        "esto subió, decide si lo respetas o recotizas".
--
-- Meter los dos en la misma columna sería el error clásico: el papel del
-- cliente y la pantalla dejarían de coincidir sin que nadie se entere.
ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS precio_cotizado NUMERIC(12,2);
ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS precio_lista_actual NUMERIC(12,2);
ALTER TABLE solicitudes_detalle
    ADD COLUMN IF NOT EXISTS precio_actualizado_en TIMESTAMPTZ;

-- Las partidas que ya existían nunca pasaron por una cotización enviada, así
-- que su precio_estimado ES el precio con el que se trabajaron.
UPDATE solicitudes_detalle
SET    precio_cotizado = precio_estimado
WHERE  precio_cotizado IS NULL
  AND  precio_estimado IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RENOMBRAR EL ESTATUS VIEJO
-- ─────────────────────────────────────────────────────────────────────────────
-- Orden importante: primero hay que soltar la restricción vieja, porque
-- 'Con Proveedor' todavía no es un valor permitido y el UPDATE fallaría.
ALTER TABLE solicitudes_compras DROP CONSTRAINT IF EXISTS ck_solicitudes_estatus;

UPDATE solicitudes_compras
SET    estatus_actual = 'Con Proveedor'
WHERE  estatus_actual = 'En Cotizacion';

-- El historial también, o la bitácora de una solicitud vieja hablaría de un
-- estatus que ya no existe en ninguna pantalla.
UPDATE solicitud_historial
SET    estatus_nuevo = 'Con Proveedor'
WHERE  estatus_nuevo = 'En Cotizacion';

UPDATE solicitud_historial
SET    estatus_anterior = 'Con Proveedor'
WHERE  estatus_anterior = 'En Cotizacion';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RESTRICCIONES NUEVAS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE solicitudes_compras
    ADD CONSTRAINT ck_solicitudes_estatus CHECK (estatus_actual IN (
        -- Flujo de la cotización (lo que ve el cliente)
        'Borrador', 'Con Compras', 'Enviada', 'Vencida',
        -- Flujo del pedido (lo que ya se está surtiendo)
        'Pendiente', 'Con Proveedor', 'Autorizada', 'En Transito', 'Recibido',
        -- Terminales de ambos
        'Cancelada', 'Rechazada'
    ));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitudes_tipo') THEN
        ALTER TABLE solicitudes_compras
            ADD CONSTRAINT ck_solicitudes_tipo CHECK (tipo IN ('Cotizacion', 'Pedido'));
        RAISE NOTICE '  + ck_solicitudes_tipo';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitudes_vigencia') THEN
        ALTER TABLE solicitudes_compras
            ADD CONSTRAINT ck_solicitudes_vigencia
            CHECK (dias_vigencia BETWEEN 1 AND 365);
        RAISE NOTICE '  + ck_solicitudes_vigencia';
    END IF;
END $$;

-- Un estatus de cotización en un Pedido (o al revés) sería un documento que
-- ninguna pantalla sabe dibujar. La base lo impide de raíz.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_solicitudes_tipo_estatus') THEN
        ALTER TABLE solicitudes_compras
            ADD CONSTRAINT ck_solicitudes_tipo_estatus CHECK (
                (tipo = 'Cotizacion'
                 AND estatus_actual IN ('Borrador','Con Compras','Enviada','Vencida','Cancelada'))
             OR (tipo = 'Pedido'
                 AND estatus_actual IN ('Pendiente','Con Proveedor','Autorizada',
                                        'En Transito','Recibido','Cancelada','Rechazada'))
            );
        RAISE NOTICE '  + ck_solicitudes_tipo_estatus';
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ÍNDICES
-- ─────────────────────────────────────────────────────────────────────────────
-- Las dos pantallas nuevas filtran por tipo antes que por nada más.
CREATE INDEX IF NOT EXISTS idx_sol_tipo         ON solicitudes_compras (tipo);
CREATE INDEX IF NOT EXISTS idx_sol_tipo_estatus ON solicitudes_compras (tipo, estatus_actual);

-- El vigía busca justo esto varias veces al día: cotizaciones enviadas cuyo
-- plazo ya pasó. Parcial para que el índice solo cargue lo que puede vencer.
CREATE INDEX IF NOT EXISTS idx_sol_por_vencer
    ON solicitudes_compras (vence_en)
    WHERE estatus_actual = 'Enviada';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. DE AQUÍ EN ADELANTE, TODO NACE COMO COTIZACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
-- Se cambia hasta el final, cuando los renglones viejos ya quedaron marcados
-- como Pedido.
ALTER TABLE solicitudes_compras ALTER COLUMN tipo SET DEFAULT 'Cotizacion';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
-- Si algo quedó a medias, que truene aquí y no en la cara del vendedor.
DO $$
DECLARE
    faltantes INTEGER;
    huerfanos INTEGER;
BEGIN
    SELECT COUNT(*) INTO faltantes
    FROM   information_schema.columns
    WHERE  table_name = 'solicitudes_compras'
      AND  column_name IN ('tipo','enviada_en','vence_en','convertida_en','dias_vigencia');
    IF faltantes < 5 THEN
        RAISE EXCEPTION 'Migración 04 incompleta: faltan columnas en solicitudes_compras.';
    END IF;

    SELECT COUNT(*) INTO faltantes
    FROM   information_schema.columns
    WHERE  table_name = 'solicitudes_detalle'
      AND  column_name IN ('precio_cotizado','precio_lista_actual','precio_actualizado_en');
    IF faltantes < 3 THEN
        RAISE EXCEPTION 'Migración 04 incompleta: faltan columnas de precio en solicitudes_detalle.';
    END IF;

    SELECT COUNT(*) INTO huerfanos
    FROM   solicitudes_compras WHERE estatus_actual = 'En Cotizacion';
    IF huerfanos > 0 THEN
        RAISE EXCEPTION 'Migración 04 incompleta: quedaron % solicitudes en el estatus viejo.', huerfanos;
    END IF;

    RAISE NOTICE 'Migración 04 (cotizaciones y pedidos) aplicada.';
END $$;
