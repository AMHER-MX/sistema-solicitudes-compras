-- =============================================================================
--  SGC - Migración 03: administración de usuarios
--  Motor: Microsoft SQL Server 2016+
--
--  QUÉ HACE
--    Agrega tres columnas a dbo.usuarios para poder dar de alta gente real
--    desde la pantalla de administración:
--      · debe_cambiar_password    -> obliga a cambiar la contraseña temporal
--      · creado_por               -> quién dio de alta la cuenta
--      · password_actualizado_en  -> cuándo se cambió la contraseña por última vez
--
--  QUÉ **NO** HACE
--    No borra nada, no vacía ninguna tabla y no toca las solicitudes que ya
--    están capturadas. A diferencia de 01_schema.sql (que empieza tirando las
--    tablas y por eso solo sirve para instalar de cero), este archivo está
--    hecho para correrse sobre una base que YA tiene datos.
--
--  SE PUEDE CORRER VARIAS VECES
--    Cada paso revisa primero si ya está aplicado. Correrlo dos veces no
--    causa error ni duplica nada.
--
--  CÓMO APLICARLO
--      cd backend && npm run db:migrar
--  o bien:
--      sqlcmd -S localhost -d SGC_COMPRAS -i database/03_migracion_usuarios.sql
-- =============================================================================

SET NOCOUNT ON;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. debe_cambiar_password
--
--    Cuando un Gerente crea una cuenta, el sistema genera una contraseña
--    temporal y marca esta bandera en 1. Mientras esté en 1, el usuario puede
--    entrar pero no puede hacer nada más que cambiar su contraseña.
--
--    Las cuentas que ya existen se quedan en 0: nadie que hoy puede trabajar
--    se queda trabado por esta migración.
-- ─────────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.usuarios', 'debe_cambiar_password') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios
        ADD debe_cambiar_password BIT NOT NULL
            CONSTRAINT DF_usuarios_debe_cambiar DEFAULT (0);
    PRINT '  + usuarios.debe_cambiar_password';
END
ELSE
    PRINT '  = usuarios.debe_cambiar_password (ya existía)';
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. creado_por
--
--    Referencia al usuario que dio de alta la cuenta. Es NULL para las cuentas
--    que ya existían y para las que carga el seed, porque en esos casos no hubo
--    nadie del otro lado de la pantalla.
--
--    OJO con el ON DELETE: se deja sin acción a propósito. Un usuario nunca se
--    borra en este sistema (se desactiva), así que no hace falta cascada — y
--    una cascada sobre la misma tabla ni siquiera la permite SQL Server.
-- ─────────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.usuarios', 'creado_por') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios ADD creado_por INT NULL;
    PRINT '  + usuarios.creado_por';
END
ELSE
    PRINT '  = usuarios.creado_por (ya existía)';
GO

-- La llave foránea va en su propio lote: la columna tiene que existir ya.
IF COL_LENGTH('dbo.usuarios', 'creado_por') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_usuarios_creado_por')
BEGIN
    ALTER TABLE dbo.usuarios
        ADD CONSTRAINT FK_usuarios_creado_por FOREIGN KEY (creado_por)
            REFERENCES dbo.usuarios (id);
    PRINT '  + FK_usuarios_creado_por';
END
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. password_actualizado_en
--
--    Sirve para responder "¿cuándo cambió su contraseña esta persona?" sin
--    tener que guardar la contraseña ni el historial de contraseñas.
--    NULL = nunca la ha cambiado desde que se creó la cuenta.
-- ─────────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.usuarios', 'password_actualizado_en') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios ADD password_actualizado_en DATETIME2(3) NULL;
    PRINT '  + usuarios.password_actualizado_en';
END
ELSE
    PRINT '  = usuarios.password_actualizado_en (ya existía)';
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Índice para la pantalla de administración
--    La lista se ordena por rol y nombre; este índice evita el ordenamiento.
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'idx_usuarios_rol_nombre'
                 AND object_id = OBJECT_ID('dbo.usuarios'))
BEGIN
    CREATE INDEX idx_usuarios_rol_nombre ON dbo.usuarios (rol, nombre);
    PRINT '  + idx_usuarios_rol_nombre';
END
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verificación final
--    Si algo de lo anterior no quedó, aquí truena en lugar de dejar la base
--    a medias sin que nadie se entere.
-- ─────────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.usuarios', 'debe_cambiar_password')   IS NULL
   OR COL_LENGTH('dbo.usuarios', 'creado_por')              IS NULL
   OR COL_LENGTH('dbo.usuarios', 'password_actualizado_en') IS NULL
BEGIN
    THROW 51000, 'La migración 03 no se aplicó completa: faltan columnas en dbo.usuarios.', 1;
END

PRINT 'Migración 03 (administración de usuarios) aplicada.';
GO
