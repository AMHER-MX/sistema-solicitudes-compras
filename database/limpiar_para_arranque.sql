-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PASO 1 · Solo mira. No borra nada.                                ║
-- ╚════════════════════════════════════════════════════════════════════╝
SELECT current_database()                             AS base,
       (SELECT COUNT(*) FROM solicitudes_compras)     AS folios,
       (SELECT COUNT(*) FROM solicitudes_detalle)     AS partidas,
       (SELECT COUNT(*) FROM solicitud_historial)     AS bitacora,
       (SELECT COUNT(*) FROM clientes)                AS clientes_NO_SE_TOCAN,
       (SELECT COUNT(*) FROM usuarios)                AS usuarios_NO_SE_TOCAN,
       (SELECT STRING_AGG(f, ' · ' ORDER BY f) FROM (
          SELECT MAX(s.folio) AS f
          FROM   solicitudes_compras s
          JOIN   empresas e ON e.id = s.id_empresa
          GROUP  BY e.clave) x)                       AS ultimo_folio;


-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PASO 2 · Esto SÍ borra. Córrelo completo, de un solo jalón.       ║
-- ╚════════════════════════════════════════════════════════════════════╝
--
-- Va todo dentro de un bloque: si algo no cuadra, se deshace solo y no
-- se borra nada. No hay forma de que se quede a medias.
DO $$
DECLARE
    clientes_antes   INTEGER;
    usuarios_antes   INTEGER;
    sucursales_antes INTEGER;
    empresas_antes   INTEGER;
    borrados         INTEGER;
BEGIN
    -- Cuántos hay de lo que NO se debe tocar, para revisarlo al final.
    SELECT COUNT(*) INTO clientes_antes   FROM clientes;
    SELECT COUNT(*) INTO usuarios_antes   FROM usuarios;
    SELECT COUNT(*) INTO sucursales_antes FROM sucursales;
    SELECT COUNT(*) INTO empresas_antes   FROM empresas;

    -- De hija a madre, por las llaves foráneas.
    DELETE FROM solicitud_historial;
    DELETE FROM solicitudes_detalle;
    DELETE FROM solicitudes_compras;
    GET DIAGNOSTICS borrados = ROW_COUNT;

    -- El contador de folios vuelve a cero: el siguiente será 000001.
    DELETE FROM folio_consecutivo;

    -- Y los ids internos también, para que no queden en 847.
    EXECUTE 'ALTER TABLE solicitud_historial  ALTER COLUMN id RESTART WITH 1';
    EXECUTE 'ALTER TABLE solicitudes_detalle  ALTER COLUMN id RESTART WITH 1';
    EXECUTE 'ALTER TABLE solicitudes_compras  ALTER COLUMN id RESTART WITH 1';

    -- La revisión antes de dar por buena la limpieza. Si algo tocó lo que no
    -- debía, aquí truena y se deshace TODO, incluidos los borrados de arriba.
    IF (SELECT COUNT(*) FROM clientes)   <> clientes_antes
    OR (SELECT COUNT(*) FROM usuarios)   <> usuarios_antes
    OR (SELECT COUNT(*) FROM sucursales) <> sucursales_antes
    OR (SELECT COUNT(*) FROM empresas)   <> empresas_antes THEN
        RAISE EXCEPTION 'ABORTADO: cambió algo que no se debía tocar. No se borró nada.';
    END IF;

    RAISE NOTICE 'Listo: % folio(s) borrado(s). Clientes, usuarios, sucursales y empresas intactos.', borrados;
END $$;


-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PASO 3 · Confirmar cómo quedó.                                    ║
-- ╚════════════════════════════════════════════════════════════════════╝
SELECT (SELECT COUNT(*) FROM solicitudes_compras) AS folios_debe_ser_0,
       (SELECT COUNT(*) FROM solicitudes_detalle) AS partidas_debe_ser_0,
       (SELECT COUNT(*) FROM solicitud_historial) AS bitacora_debe_ser_0,
       (SELECT COUNT(*) FROM folio_consecutivo)   AS contador_debe_ser_0,
       (SELECT COUNT(*) FROM clientes)            AS clientes_intactos,
       (SELECT COUNT(*) FROM usuarios)            AS usuarios_intactos;
