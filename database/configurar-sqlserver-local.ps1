<#
    Configura SQL Server Express para el sistema de Compras.

    QUÉ HACE, en orden:
      1. Enciende el protocolo TCP/IP y lo fija en el puerto 1433.
         (En Express viene apagado de fábrica; sin esto la aplicación no
          puede conectarse, porque el driver de Node habla por TCP.)
      2. Habilita el modo mixto de autenticación, para poder usar un usuario
         de base de datos en vez de la cuenta de Windows.
      3. Reinicia el servicio de SQL Server para aplicar lo anterior.
      4. Crea la base de datos SGC_COMPRAS.
      5. Crea el usuario 'sgc_app' con una contraseña ALEATORIA y le da
         permiso ÚNICAMENTE sobre esa base. No toca ninguna otra.
      6. Escribe backend\.env con esos datos y una llave JWT nueva.
      7. Comprueba que la conexión funcione de verdad.

    La contraseña la genera el script y la escribe directo en el .env.
    Nadie la teclea y no aparece en pantalla.

    CÓMO SE USA:
      1. Clic derecho en el menú Inicio -> "Terminal (Administrador)"
      2. cd "<carpeta del proyecto>"
      3. powershell -ExecutionPolicy Bypass -File database\configurar-sqlserver-local.ps1
#>

[CmdletBinding()]
param(
    [string]$Instancia = 'SQLEXPRESS',
    [string]$BaseDatos = 'SGC_COMPRAS',
    [string]$Usuario   = 'sgc_app',
    [int]   $Puerto    = 1433
)

$ErrorActionPreference = 'Stop'

function Paso($texto)  { Write-Host "`n>> $texto" -ForegroundColor Cyan }
function Bien($texto)  { Write-Host "   OK  $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "   !   $texto" -ForegroundColor Yellow }

# ── 0. Comprobaciones previas ───────────────────────────────────────────────
$esAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $esAdmin) {
    Write-Host "`nESTE SCRIPT NECESITA PERMISOS DE ADMINISTRADOR." -ForegroundColor Red
    Write-Host "Cierra esta ventana y abre: menú Inicio -> clic derecho -> 'Terminal (Administrador)'."
    exit 1
}

# El script habla con SQL Server usando System.Data.SqlClient, que viene con
# .NET Framework — es decir, con Windows PowerShell 5.1, el clásico.
# PowerShell 7 no lo trae, así que ahí hay que usar el otro.
if (-not ('System.Data.SqlClient.SqlConnection' -as [type])) {
    try { Add-Type -AssemblyName System.Data } catch { }
}
if (-not ('System.Data.SqlClient.SqlConnection' -as [type])) {
    Write-Host "`nEsta ventana de PowerShell no puede hablar con SQL Server." -ForegroundColor Red
    Write-Host "Ábrela así: menú Inicio -> escribe 'Windows PowerShell' -> clic derecho ->"
    Write-Host "'Ejecutar como administrador'. (No uses PowerShell 7 para este script.)"
    exit 1
}

$raiz = Split-Path -Parent $PSScriptRoot
$rutaEnv        = Join-Path $raiz 'backend\.env'
$rutaEnvEjemplo = Join-Path $raiz 'backend\.env.example'

if (-not (Test-Path $rutaEnvEjemplo)) {
    Write-Host "`nNo encontré $rutaEnvEjemplo" -ForegroundColor Red
    Write-Host "Corre el script desde la carpeta del proyecto (la que tiene backend\ y database\)."
    exit 1
}

# Localiza el identificador interno de la instancia (ej. MSSQL17.SQLEXPRESS).
Paso "Buscando la instancia $Instancia"
$llaveInstancias = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
if (-not (Test-Path $llaveInstancias)) {
    Write-Host "   No encontré ninguna instalación de SQL Server." -ForegroundColor Red
    exit 1
}
$idInstancia = (Get-ItemProperty $llaveInstancias).$Instancia
if (-not $idInstancia) {
    $disponibles = (Get-Item $llaveInstancias).Property -join ', '
    Write-Host "   No existe la instancia '$Instancia'. Encontradas: $disponibles" -ForegroundColor Red
    exit 1
}
Bien "$Instancia -> $idInstancia"

$baseLlave = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$idInstancia\MSSQLServer"
$servicio  = "MSSQL`$$Instancia"

# ── 1. Protocolo TCP/IP en el puerto fijo ───────────────────────────────────
Paso "Encendiendo TCP/IP en el puerto $Puerto"
$llaveTcp   = "$baseLlave\SuperSocketNetLib\Tcp"
$llaveIPAll = "$llaveTcp\IPAll"

Set-ItemProperty -Path $llaveTcp   -Name 'Enabled'          -Value 1        -Type DWord
Set-ItemProperty -Path $llaveIPAll -Name 'TcpPort'          -Value "$Puerto" -Type String
# Vaciar los puertos dinámicos es lo que hace que el puerto fijo mande.
Set-ItemProperty -Path $llaveIPAll -Name 'TcpDynamicPorts'  -Value ''       -Type String
Bien "TCP/IP habilitado y fijado en $Puerto"

# ── 2. Modo mixto de autenticación ──────────────────────────────────────────
Paso "Habilitando autenticación por usuario y contraseña"
# LoginMode: 1 = solo Windows, 2 = Windows + SQL Server
Set-ItemProperty -Path $baseLlave -Name 'LoginMode' -Value 2 -Type DWord
Bien "Modo mixto habilitado"

# ── 3. Reiniciar el servicio ────────────────────────────────────────────────
Paso "Reiniciando el servicio de SQL Server"
Restart-Service -Name $servicio -Force
$svc = Get-Service -Name $servicio
if ($svc.Status -ne 'Running') {
    Write-Host "   El servicio no arrancó (estado: $($svc.Status))." -ForegroundColor Red
    exit 1
}
Bien "Servicio $servicio corriendo"
Start-Sleep -Seconds 3

# ── 4-5. Base de datos y usuario de la aplicación ───────────────────────────
# Se conecta con la cuenta de Windows (que es administradora de SQL) para
# poder crear el usuario que después usará la aplicación.
function Invoke-Sql($consulta, $cadenaConexion) {
    $conexion = New-Object System.Data.SqlClient.SqlConnection $cadenaConexion
    try {
        $conexion.Open()
        $comando = $conexion.CreateCommand()
        $comando.CommandText = $consulta
        $comando.CommandTimeout = 60
        [void]$comando.ExecuteNonQuery()
    } finally {
        $conexion.Close()
    }
}

$conexionAdmin = "Server=localhost\$Instancia;Database=master;Integrated Security=True;TrustServerCertificate=True"

Paso "Creando la base de datos $BaseDatos"
Invoke-Sql "IF DB_ID('$BaseDatos') IS NULL CREATE DATABASE [$BaseDatos];" $conexionAdmin
Bien "$BaseDatos lista"

Paso "Creando el usuario $Usuario"
# Contraseña aleatoria. No se muestra: va directo al .env.
#
# SOLO letras y números, a propósito: en un archivo .env el caracter '#'
# inicia un comentario, así que una contraseña que lo contenga se lee
# cortada y el login falla con un mensaje que no explica nada.
# Con CHECK_POLICY = OFF no hace falta meter símbolos para cumplir la política.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = ([Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', '').Substring(0, 32) + 'Aa1'

# El usuario solo es dueño de SU base. No se le da ningún rol de servidor.
$sqlUsuario = @"
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '$Usuario')
    CREATE LOGIN [$Usuario] WITH PASSWORD = '$password',
        DEFAULT_DATABASE = [$BaseDatos], CHECK_POLICY = OFF;
ELSE
    ALTER LOGIN [$Usuario] WITH PASSWORD = '$password';

USE [$BaseDatos];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$Usuario')
    CREATE USER [$Usuario] FOR LOGIN [$Usuario];
ALTER ROLE db_owner ADD MEMBER [$Usuario];
"@
Invoke-Sql $sqlUsuario $conexionAdmin
Bien "$Usuario creado, con permiso solo sobre $BaseDatos"

# ── 6. Archivo .env ─────────────────────────────────────────────────────────
Paso "Escribiendo backend\.env"

if (Test-Path $rutaEnv) {
    $respaldo = "$rutaEnv.respaldo"
    Copy-Item $rutaEnv $respaldo -Force
    Aviso "Ya existía un .env; lo respaldé como .env.respaldo"
}

# Llave JWT aleatoria, para no dejar la de ejemplo.
$bytesJwt = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytesJwt)
$jwt = ($bytesJwt | ForEach-Object { $_.ToString('x2') }) -join ''

$contenido = Get-Content $rutaEnvEjemplo -Raw -Encoding UTF8

function Reemplazar($texto, $clave, $valor) {
    $patron = "(?m)^$clave=.*$"
    if ($texto -match $patron) { return $texto -replace $patron, "$clave=$valor" }
    return $texto + "`n$clave=$valor"
}

$contenido = Reemplazar $contenido 'DB_HOST'         'localhost'
$contenido = Reemplazar $contenido 'DB_PORT'         "$Puerto"
$contenido = Reemplazar $contenido 'DB_DATABASE'     $BaseDatos
$contenido = Reemplazar $contenido 'DB_USER'         $Usuario
# Entre comillas: protege el valor de cualquier caracter especial.
$contenido = Reemplazar $contenido 'DB_PASSWORD'     ('"' + $password + '"')
# En un SQL Server local con certificado autofirmado, el cifrado estorba.
$contenido = Reemplazar $contenido 'DB_ENCRYPT'      'false'
$contenido = Reemplazar $contenido 'DB_TRUST_CERT'   'true'
$contenido = Reemplazar $contenido 'JWT_SECRET'      ('"' + $jwt + '"')
$contenido = Reemplazar $contenido 'QUITER_BASE_URL' 'https://api.catosaapps.lat'

# Sin BOM: Node lo lee mejor.
[System.IO.File]::WriteAllText($rutaEnv, $contenido, (New-Object System.Text.UTF8Encoding $false))
Bien "backend\.env escrito (la contraseña quedó ahí dentro)"

# ── 7. Prueba real de conexión ──────────────────────────────────────────────
Paso "Probando la conexión como haría la aplicación"
$conexionApp = "Server=localhost,$Puerto;Database=$BaseDatos;User Id=$Usuario;Password=$password;TrustServerCertificate=True"
try {
    Invoke-Sql "SELECT 1;" $conexionApp
    Bien "Conexión por TCP correcta"
} catch {
    Write-Host "   Falló la conexión: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Revisa que el Firewall de Windows no esté bloqueando el puerto $Puerto." -ForegroundColor Yellow
    exit 1
}

Write-Host "`n===================================================" -ForegroundColor Green
Write-Host " LISTO. SQL Server quedó configurado." -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host @"

Ahora, en una terminal NORMAL (sin administrador):

    cd backend
    npm run db:setup
    npm run dev

"@
