-- =============================================================================
--  SGC - Migración 07: dos empresas (CATOSA y CADUSA)
--  Motor: PostgreSQL 14+
--
--  QUÉ RESUELVE
--    CADUSA es la empresa hermana. Comparte el mismo Quiter y los mismos
--    compradores de refacciones, pero NO es la misma empresa: sus cotizaciones,
--    sus pedidos y sus números no deben mezclarse con los de CATOSA.
--
--    Lo que sí se comparte es la EXISTENCIA. Un vendedor de CATOSA que no tiene
--    una pieza necesita saber si está en Durango, aunque Durango sea de CADUSA.
--    Esa es la razón de ser de todo esto.
--
--  LA SEPARACIÓN YA ESTABA EN LOS DATOS
--    Las claves de almacén que entrega Quiter la traen escrita:
--
--      1xx -> CATOSA   (101 Torreón, 102 Gómez Palacio, 103 Monclova,
--                       104 Piedras Negras)
--      2xx -> CADUSA   (201 Durango, 202 Poniente, 203 Zacatecas)
--
--    Esta migración solo le pone nombre a algo que el ERP ya distinguía. NO se
--    inventa ninguna asignación: una sucursal cuya clave no empiece con 1 ni
--    con 2 se queda SIN empresa y la migración lo grita, para que una persona
--    decida en lugar de que el sistema adivine.
--
--  DECISIÓN QUE TOMA ESTA MIGRACIÓN Y CONVIENE SABER
--    El Gerente activo más antiguo queda con alcance de GRUPO (ve las dos
--    empresas). Sin eso nadie podría crear el primer usuario de CADUSA: un
--    Gerente de empresa solo administra la suya, y se formaría un callejón sin
--    salida. Se imprime quién fue; se puede cambiar desde la pantalla Usuarios.
--
--  SE PUEDE CORRER VARIAS VECES. No borra ni reasigna nada existente.
--
--  CÓMO APLICARLO
--      cd backend && npm run db:migrar
-- =============================================================================

-- ─── 1. Las empresas ─────────────────────────────────────────────────────────
-- Tabla y no una columna con CHECK: dar de alta una tercera empresa debe ser
-- insertar un renglón, no pedir una migración nueva.
CREATE TABLE IF NOT EXISTS empresas (
    id         INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clave      VARCHAR(20)  NOT NULL UNIQUE,
    nombre     VARCHAR(120) NOT NULL,
    -- Prefijo de clave de almacén que le corresponde en Quiter ('1', '2', ...).
    -- Es lo que permite clasificar una sucursal nueva sin intervención humana.
    prefijo_almacen VARCHAR(4),
    activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO empresas (clave, nombre, prefijo_almacen) VALUES
    ('CATOSA', 'Camionera Catosa',     '1'),
    ('CADUSA', 'Camionera de Durango', '2')
ON CONFLICT (clave) DO NOTHING;

-- ─── 2. Sucursales ───────────────────────────────────────────────────────────
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS id_empresa INTEGER REFERENCES empresas (id);

-- Se clasifica por el prefijo de la clave, que es el dato que ya venía de
-- Quiter. Solo se tocan las que todavía no tienen empresa.
UPDATE sucursales s
   SET id_empresa = e.id
  FROM empresas e
 WHERE s.id_empresa IS NULL
   AND e.prefijo_almacen IS NOT NULL
   AND s.clave LIKE e.prefijo_almacen || '%';

DO $$
DECLARE
    huerfanas TEXT;
BEGIN
    SELECT STRING_AGG(clave || ' (' || nombre || ')', ', ')
      INTO huerfanas
      FROM sucursales
     WHERE id_empresa IS NULL;

    IF huerfanas IS NOT NULL THEN
        RAISE WARNING 'SUCURSALES SIN EMPRESA: %', huerfanas;
        RAISE WARNING 'Su clave no empieza con 1 ni con 2. Asígnalas a mano;';
        RAISE WARNING 'mientras tanto nadie puede levantar documentos en ellas.';
    END IF;
END $$;

-- ─── 3. Usuarios ─────────────────────────────────────────────────────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS id_empresa INTEGER REFERENCES empresas (id);

-- 'EMPRESA' ve solo lo suyo. 'GRUPO' ve las dos.
--
-- Se modela como alcance y no como un rol nuevo a propósito: el rol dice QUÉ
-- puede hacer una persona (capturar, comprar, administrar) y el alcance dice
-- SOBRE QUÉ. Mezclarlos obligaría a duplicar cada rol por empresa.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS alcance VARCHAR(10) NOT NULL DEFAULT 'EMPRESA';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_usuarios_alcance') THEN
        ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_alcance
            CHECK (alcance IN ('EMPRESA', 'GRUPO'));
        RAISE NOTICE '  + ck_usuarios_alcance';
    END IF;
END $$;

-- Todo lo que ya existía es de CATOSA: es la única que ha usado el sistema.
UPDATE usuarios
   SET id_empresa = (SELECT id FROM empresas WHERE clave = 'CATOSA')
 WHERE id_empresa IS NULL;

-- El primer Gerente queda con alcance de grupo, o nadie podría dar de alta a
-- la gente de CADUSA. Ver la nota del encabezado.
DO $$
DECLARE
    elegido RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE alcance = 'GRUPO' AND activo) THEN
        SELECT id, nombre, email INTO elegido
          FROM usuarios
         WHERE rol = 'Gerente' AND activo
         ORDER BY id
         LIMIT 1;

        IF elegido.id IS NOT NULL THEN
            UPDATE usuarios SET alcance = 'GRUPO' WHERE id = elegido.id;
            RAISE NOTICE 'Alcance de GRUPO otorgado a % (%). Ve las dos empresas', elegido.nombre, elegido.email;
            RAISE NOTICE 'y puede dar de alta usuarios de CADUSA. Cambiable en Usuarios.';
        ELSE
            RAISE WARNING 'No hay ningún Gerente activo al cual darle alcance de grupo.';
        END IF;
    END IF;
END $$;

-- ─── 4. Documentos ───────────────────────────────────────────────────────────
-- La empresa se guarda en el propio documento, aunque se pueda deducir de la
-- sucursal. Dos razones: filtrar por empresa es la consulta más frecuente del
-- sistema y así no cuesta un JOIN; y un folio tiene que seguir diciendo de qué
-- empresa fue aunque algún día una sucursal cambie de manos.
ALTER TABLE solicitudes_compras ADD COLUMN IF NOT EXISTS id_empresa INTEGER REFERENCES empresas (id);

UPDATE solicitudes_compras sc
   SET id_empresa = s.id_empresa
  FROM sucursales s
 WHERE sc.id_sucursal = s.id
   AND sc.id_empresa IS NULL;

CREATE INDEX IF NOT EXISTS idx_solicitudes_empresa
    ON solicitudes_compras (id_empresa, fecha_creacion DESC);

-- ─── 5. Clientes ─────────────────────────────────────────────────────────────
-- Se deja la columna preparada pero VACÍA, y a propósito.
--
-- El padrón que entrega Quiter (`/api/clientes`) no trae ningún campo que diga
-- de qué empresa es cada cliente: son Codigo, Cliente, NombreCompleto, Dias,
-- Venta_Mes, PromedioMensual, Direccion, Colonia, Ciudad, Estado, CP, Pais y
-- EsCartera. Deducirlo por ciudad sería inventar: un vendedor de CADUSA le
-- vende a un cliente de Torreón sin ningún problema.
--
-- Mientras el ERP no lo diga, el padrón se comparte y el buscador los muestra
-- a todos. La columna existe para que el día que Quiter sí lo informe, separar
-- clientes sea llenarla y nada más.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS id_empresa INTEGER REFERENCES empresas (id);

-- ─── 6. Folios por empresa y por año ─────────────────────────────────────────
-- El folio pasa de 'SC-2026-000001' a 'SC-CATOSA-2026-000001'.
--
-- POR QUÉ UN CONTADOR Y NO UNA SECUENCIA
--   El DEFAULT de una columna no puede mirar otra columna del mismo renglón,
--   así que el folio ya no se puede armar ahí: necesita saber la empresa. Se
--   arma en un trigger, que además corrige algo que la secuencia hacía mal: no
--   reiniciaba en enero. Con el contador, 2027 empieza en 000001 otra vez.
CREATE TABLE IF NOT EXISTS folio_consecutivo (
    id_empresa INTEGER NOT NULL REFERENCES empresas (id),
    anio       INTEGER NOT NULL,
    ultimo     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id_empresa, anio)
);

CREATE OR REPLACE FUNCTION asignar_folio() RETURNS TRIGGER AS $$
DECLARE
    clave_empresa TEXT;
    anio_actual   INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
    consecutivo   INTEGER;
BEGIN
    -- Un folio ya puesto a mano se respeta (lo usan las pruebas y una eventual
    -- importación de histórico).
    IF NEW.folio IS NOT NULL AND NEW.folio <> '' THEN
        RETURN NEW;
    END IF;

    IF NEW.id_empresa IS NULL THEN
        RAISE EXCEPTION 'No se puede asignar folio: el documento no tiene empresa. '
                        'Revisa que su sucursal tenga empresa asignada.';
    END IF;

    SELECT clave INTO clave_empresa FROM empresas WHERE id = NEW.id_empresa;

    -- El INSERT ... ON CONFLICT DO UPDATE toma el candado del renglón, así que
    -- dos vendedores capturando al mismo tiempo no pueden sacar el mismo
    -- número: el segundo espera al primero.
    INSERT INTO folio_consecutivo (id_empresa, anio, ultimo)
         VALUES (NEW.id_empresa, anio_actual, 1)
    ON CONFLICT (id_empresa, anio)
      DO UPDATE SET ultimo = folio_consecutivo.ultimo + 1
      RETURNING ultimo INTO consecutivo;

    NEW.folio := 'SC-' || clave_empresa || '-' || anio_actual || '-'
               || LPAD(consecutivo::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El DEFAULT viejo armaba el folio sin empresa; se quita para que el trigger
-- sea el único que los genera y no haya dos reglas compitiendo.
ALTER TABLE solicitudes_compras ALTER COLUMN folio DROP DEFAULT;
ALTER TABLE solicitudes_compras ALTER COLUMN folio DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_asignar_folio ON solicitudes_compras;
CREATE TRIGGER trg_asignar_folio
    BEFORE INSERT ON solicitudes_compras
    FOR EACH ROW EXECUTE FUNCTION asignar_folio();

-- Los folios que ya existen NO se tocan: un papel impreso con 'SC-2026-000004'
-- tiene que seguir encontrándose por ese número.

-- ─── Comprobación ────────────────────────────────────────────────────────────
DO $$
DECLARE
    n_empresas  INTEGER;
    sin_empresa INTEGER;
BEGIN
    SELECT COUNT(*) INTO n_empresas FROM empresas;
    IF n_empresas < 2 THEN
        RAISE EXCEPTION 'Migración 07: se esperaban al menos 2 empresas, hay %.', n_empresas;
    END IF;

    SELECT COUNT(*) INTO sin_empresa FROM usuarios WHERE id_empresa IS NULL;
    IF sin_empresa > 0 THEN
        RAISE EXCEPTION 'Migración 07: quedaron % usuario(s) sin empresa.', sin_empresa;
    END IF;

    RAISE NOTICE 'Migración 07 (CATOSA / CADUSA) aplicada.';
END $$;
