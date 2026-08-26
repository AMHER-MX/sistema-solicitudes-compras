-- =============================================================================
--  SGC - Migración 03: administración de usuarios
--  Motor: PostgreSQL 14+
--
--  QUÉ HACE
--    Agrega a la tabla usuarios las tres columnas que necesita la pantalla de
--    administración de cuentas:
--      · debe_cambiar_password    -> obliga a cambiar la contraseña temporal
--      · creado_por               -> quién dio de alta la cuenta
--      · password_actualizado_en  -> cuándo se cambió la contraseña
--
--  QUÉ **NO** HACE
--    No borra nada y no toca las solicitudes capturadas. A diferencia de
--    01_schema.sql (que empieza tirando las tablas y por eso solo sirve para
--    instalar de cero), este archivo está hecho para correrse sobre una base
--    que YA tiene datos.
--
--  SE PUEDE CORRER VARIAS VECES
--    Cada paso revisa primero si ya está aplicado. En una instalación nueva no
--    hace nada, porque 01_schema.sql ya trae las columnas.
--
--  CÓMO APLICARLO
--      cd backend && npm run db:migrar
-- =============================================================================

-- IF NOT EXISTS en ADD COLUMN existe desde PostgreSQL 9.6: no hace falta
-- envolver esto en comprobaciones manuales.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS creado_por INTEGER;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_actualizado_en TIMESTAMPTZ;

-- La llave foránea sí necesita comprobación: ADD CONSTRAINT no admite
-- IF NOT EXISTS y correr la migración dos veces fallaría.
--
-- Sin ON DELETE a propósito: un usuario nunca se borra en este sistema (se
-- desactiva), así que no hace falta cascada.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_usuarios_creado_por'
    ) THEN
        ALTER TABLE usuarios
            ADD CONSTRAINT fk_usuarios_creado_por
            FOREIGN KEY (creado_por) REFERENCES usuarios (id);
        RAISE NOTICE '  + fk_usuarios_creado_por';
    END IF;
END $$;

-- Índice para la pantalla de administración, que ordena por rol y nombre.
CREATE INDEX IF NOT EXISTS idx_usuarios_rol_nombre ON usuarios (rol, nombre);

-- Verificación final: si algo no quedó, truena aquí en lugar de dejar la base
-- a medias sin que nadie se entere.
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'usuarios'
          AND column_name IN ('debe_cambiar_password', 'creado_por', 'password_actualizado_en')) < 3
    THEN
        RAISE EXCEPTION 'La migración 03 no se aplicó completa: faltan columnas en usuarios.';
    END IF;
    RAISE NOTICE 'Migración 03 (administración de usuarios) aplicada.';
END $$;
