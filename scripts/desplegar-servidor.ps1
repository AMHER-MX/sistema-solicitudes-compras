<#
.SYNOPSIS
    Despliega el Sistema de Solicitudes de Compras en el servidor de la empresa.

.DESCRIPTION
    Hace de corrido todo lo que se puede automatizar:

      1. Revisa que estén Node y Git, y con qué versión.
      2. Trae el código de GitHub (clona la primera vez, actualiza después).
      3. Prepara el archivo .env: pide solo lo que no puede adivinar y genera
         la llave JWT él mismo, sin que nadie tenga que verla ni teclearla.
      4. Instala las dependencias.
      5. Revisa cómo está la base y decide: instalar el esquema si está vacía,
         o solo migrar si ya tiene datos. NUNCA borra una base en uso.
      6. Corre las pruebas que no necesitan servidor.
      7. Compila la interfaz.
      8. Arranca la aplicación un momento y comprueba /api/health.
      9. Deja el servicio registrado para que sobreviva a un reinicio.

    Lo que NO hace, porque es configuración de red y a ciegas sería peligroso:
    la entrada en cloudflared y el registro DNS. Al terminar te dice exactamente
    qué falta.

    Se puede correr las veces que haga falta. En una instalación ya montada,
    actualiza el código y la base sin tocar el .env ni los datos.

.PARAMETER Ruta
    Dónde vive (o va a vivir) la aplicación en el servidor.

.PARAMETER Dominio
    El dominio público por el que se va a publicar. Se usa para CORS_ORIGIN.

.PARAMETER SoloRevisar
    No cambia nada: solo reporta cómo está todo. Úsalo la primera vez.

.PARAMETER SinServicio
    Omite el paso 9 (registrar el servicio de Windows).

.EXAMPLE
    .\desplegar-servidor.ps1 -SoloRevisar
    Revisión sin tocar nada.

.EXAMPLE
    .\desplegar-servidor.ps1
    Despliegue completo con los valores por omisión.

.NOTES
    Correr como Administrador si se quiere registrar el servicio.
    Probado contra Windows PowerShell 5.1 y PowerShell 7.
#>
[CmdletBinding()]
param(
    [string]$Ruta        = 'C:\apps\sgc-compras',
    [string]$Repositorio = 'https://github.com/AMHER-MX/sistema-solicitudes-compras.git',
    [string]$Rama        = 'main',
    [int]   $Puerto      = 4000,
    [string]$Dominio     = 'compras.catosaapps.lat',
    [string]$NombreServicio = 'SGC-Compras',
    [switch]$SoloRevisar,
    [switch]$SinServicio
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

<#
    Que git falle rápido en lugar de quedarse esperando.

    Contra un repositorio privado, git pide usuario y contraseña. Dentro de un
    script eso es lo peor que puede pasar: la consola se queda muda, sin cursor
    ni mensaje, y no hay forma de saber si está trabajando o colgado. Con estas
    dos variables git contesta con un error claro en vez de esperar para
    siempre, y el script puede explicar qué falta.
#>
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

# ─────────────────────────────────────────────────────────────────────────────
# Presentación
# ─────────────────────────────────────────────────────────────────────────────
$script:Paso = 0
$script:Avisos = New-Object System.Collections.ArrayList

function Escribir-Titulo($texto) {
    $script:Paso++
    Write-Host ''
    Write-Host ("  {0}. {1}" -f $script:Paso, $texto) -ForegroundColor Cyan
    Write-Host ('  ' + ('─' * 68)) -ForegroundColor DarkGray
}
function Escribir-Ok($texto)    { Write-Host "     OK   $texto" -ForegroundColor Green }
function Escribir-Dato($texto)  { Write-Host "          $texto" -ForegroundColor Gray }
function Escribir-Aviso($texto) {
    Write-Host "     !    $texto" -ForegroundColor Yellow
    [void]$script:Avisos.Add($texto)
}
function Detener($texto) {
    Write-Host ''
    Write-Host "     ALTO: $texto" -ForegroundColor Red
    Write-Host ''
    exit 1
}

function Confirmar($pregunta) {
    if ($SoloRevisar) { return $false }
    $r = Read-Host "          $pregunta [s/N]"
    return ($r -match '^[sSyY]')
}

Write-Host ''
Write-Host '  ══════════════════════════════════════════════════════════════════════'
Write-Host '   SGC Compras · despliegue en el servidor' -ForegroundColor White
Write-Host '  ══════════════════════════════════════════════════════════════════════'
Write-Host "   Carpeta : $Ruta"
Write-Host "   Dominio : $Dominio"
Write-Host "   Puerto  : $Puerto"
if ($SoloRevisar) {
    Write-Host '   Modo    : SOLO REVISAR (no se modifica nada)' -ForegroundColor Yellow
}

# Envuelto en try: fuera de Windows estas clases no existen, y así el script
# se puede revisar en cualquier parte en lugar de reventar en la primera línea.
$esAdministrador = $false
try {
    $esAdministrador = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { $esAdministrador = $false }

function Hay-Comando($nombre) {
    return [bool](Get-Command $nombre -ErrorAction SilentlyContinue)
}

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Requisitos'
# ─────────────────────────────────────────────────────────────────────────────
function Version-De($comando, $argumento) {
    $cmd = Get-Command $comando -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    try { return (& $comando $argumento 2>&1 | Select-Object -First 1) } catch { return $null }
}

$versionNode = Version-De 'node' '--version'
if (-not $versionNode) {
    Detener 'No se encontró Node.js. Instálalo desde https://nodejs.org (versión 20 o superior) y vuelve a correr esto.'
}
$mayor = 0
if ("$versionNode" -match 'v(\d+)\.') { $mayor = [int]$Matches[1] }
if ($mayor -lt 20) {
    Detener "Node $versionNode es demasiado viejo. Se necesita la versión 20 o superior."
}
Escribir-Ok "Node $versionNode"

if (-not (Version-De 'git' '--version')) {
    Detener 'No se encontró Git. Instálalo desde https://git-scm.com y vuelve a correr esto.'
}
Escribir-Ok ("Git " + ((Version-De 'git' '--version') -replace 'git version ',''))

if ($esAdministrador) {
    Escribir-Ok 'Corriendo como Administrador'
} else {
    Escribir-Aviso 'No estás como Administrador: el paso del servicio de Windows se va a saltar.'
}

# ¿Esta máquina puede autenticarse contra el repositorio? Se pregunta aquí,
# antes de necesitarlo, para no descubrirlo a la mitad del despliegue.
$hayAccesoAlRepo = $false
try {
    git ls-remote --heads $Repositorio $Rama 2>&1 | Out-Null
    $hayAccesoAlRepo = ($LASTEXITCODE -eq 0)
} catch { $hayAccesoAlRepo = $false }

if ($hayAccesoAlRepo) {
    Escribir-Ok 'GitHub responde y las credenciales sirven.'
} else {
    Escribir-Aviso 'Esta máquina no puede leer el repositorio (es privado y no hay credenciales guardadas).'
    Escribir-Dato 'Arréglalo con una de estas, y vuelve a correr esto:'
    Escribir-Dato '  · git clone <url> una vez a mano, para que Windows guarde la credencial, o'
    Escribir-Dato '  · un token de acceso personal de GitHub con permiso de solo lectura, o'
    Escribir-Dato '  · una llave SSH de despliegue y usar la URL git@github.com:...'
}

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Código'
# ─────────────────────────────────────────────────────────────────────────────
$hayRepo = Test-Path (Join-Path $Ruta '.git')

if (-not $hayRepo) {
    if (Test-Path $Ruta) {
        $contenido = @(Get-ChildItem -Force $Ruta -ErrorAction SilentlyContinue)
        if ($contenido.Count -gt 0) {
            Detener "La carpeta $Ruta ya existe, tiene archivos y no es un repositorio de Git. Muévela o elige otra ruta con -Ruta."
        }
    }
    Escribir-Dato "No hay instalación previa: se va a clonar el repositorio."
    if ($SoloRevisar) {
        Escribir-Aviso 'En modo revisión no se clona nada. Vuelve a correrlo sin -SoloRevisar.'
    } else {
        $padre = Split-Path -Parent $Ruta
        if (-not (Test-Path $padre)) { New-Item -ItemType Directory -Path $padre -Force | Out-Null }
        git clone --branch $Rama $Repositorio $Ruta
        if ($LASTEXITCODE -ne 0) {
            Detener ('Falló el clonado. Casi siempre es que esta máquina no tiene credenciales de GitHub: ' +
                     'clona una vez a mano para que Windows las guarde, o usa un token de acceso personal.')
        }
        Escribir-Ok "Repositorio clonado en $Ruta"
    }
} else {
    Push-Location $Ruta
    try {
        $sucio = git status --porcelain
        if ($sucio) {
            Escribir-Aviso 'Hay cambios locales sin guardar en el servidor. No se actualiza el código para no pisarlos.'
            Escribir-Dato 'Revísalos con: git status'
        } elseif ($SoloRevisar) {
            if (-not $hayAccesoAlRepo) {
                Escribir-Dato 'No se puede consultar GitHub desde aquí; no sé si el código está al día.'
            } else {
                # Si algo falla, no es motivo para detener una revisión: se dice
                # y se sigue. Lo único que se pierde es saber si hay commits nuevos.
                $pudo = $false
                try {
                    git fetch --quiet origin $Rama 2>&1 | Out-Null
                    $pudo = ($LASTEXITCODE -eq 0)
                } catch { $pudo = $false }

                if (-not $pudo) {
                    Escribir-Aviso 'No se pudo consultar GitHub. Sigo con lo que hay en disco.'
                } else {
                    $atras = git rev-list --count "HEAD..origin/$Rama" 2>$null
                    if ($atras -and [int]$atras -gt 0) {
                        Escribir-Dato "Hay $atras commit(s) nuevos en GitHub sin aplicar."
                    } else {
                        Escribir-Ok 'El código está al día.'
                    }
                }
            }
        } else {
            git pull --ff-only origin $Rama
            if ($LASTEXITCODE -ne 0) {
                Detener ('Falló el git pull. Si no dio más detalle, suele ser falta de credenciales de GitHub ' +
                         'en esta máquina. Corre "git pull" a mano aquí para ver el error completo.')
            }
            Escribir-Ok 'Código actualizado.'
        }
        Escribir-Dato ("Commit: " + (git log -1 --format='%h %s'))
    } finally { Pop-Location }
}

if (-not (Test-Path (Join-Path $Ruta 'backend\package.json'))) {
    if ($SoloRevisar) {
        Write-Host ''
        Escribir-Aviso 'Todavía no hay código. El resto de la revisión no aplica.'
        exit 0
    }
    Detener "No encuentro backend\package.json dentro de $Ruta."
}

$rutaBackend  = Join-Path $Ruta 'backend'
$rutaEnv      = Join-Path $rutaBackend '.env'
$rutaPlantilla= Join-Path $rutaBackend '.env.example'

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Configuración (.env)'
# ─────────────────────────────────────────────────────────────────────────────

<#
    Lee, agrega o reemplaza una clave del .env.
    Los valores SIEMPRE se escriben entre comillas: sin ellas, un '#' dentro de
    una contraseña se interpreta como inicio de comentario y el valor llega
    cortado. El síntoma es "Login failed for user", que no da ninguna pista.
#>
function Obtener-ValorEnv($archivo, $clave) {
    if (-not (Test-Path $archivo)) { return $null }
    foreach ($linea in (Get-Content $archivo)) {
        if ($linea -match "^\s*$([regex]::Escape($clave))\s*=\s*(.*)$") {
            return $Matches[1].Trim().Trim('"')
        }
    }
    return $null
}

function Establecer-ValorEnv($archivo, $clave, $valor) {
    $nueva = '{0}="{1}"' -f $clave, $valor
    if (-not (Test-Path $archivo)) {
        Set-Content -Path $archivo -Value $nueva -Encoding ASCII
        return
    }
    $lineas = @(Get-Content $archivo)
    $encontrada = $false
    for ($i = 0; $i -lt $lineas.Count; $i++) {
        if ($lineas[$i] -match "^\s*$([regex]::Escape($clave))\s*=") {
            $lineas[$i] = $nueva
            $encontrada = $true
            break
        }
    }
    if (-not $encontrada) { $lineas += $nueva }
    Set-Content -Path $archivo -Value $lineas -Encoding ASCII
}

function Pedir-Texto($etiqueta, $porOmision) {
    if ($porOmision) {
        $r = Read-Host "          $etiqueta [$porOmision]"
        if ([string]::IsNullOrWhiteSpace($r)) { return $porOmision }
        return $r
    }
    do { $r = Read-Host "          $etiqueta" } while ([string]::IsNullOrWhiteSpace($r))
    return $r
}

function Pedir-Secreto($etiqueta) {
    $seguro = Read-Host "          $etiqueta" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try   { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

<# Llave larga y aleatoria, solo letras y números.
   Sin símbolos a propósito: un '#' o un '$' dentro de un .env causa más
   problemas de los que resuelve, y la fuerza aquí viene de la longitud. #>
function Nueva-Llave($largo = 64) {
    $abc = [char[]]([char]'a'..[char]'z' + [char]'A'..[char]'Z' + [char]'0'..[char]'9')
    $sb = New-Object System.Text.StringBuilder
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buffer = New-Object 'byte[]' 4
        for ($i = 0; $i -lt $largo; $i++) {
            $rng.GetBytes($buffer)
            $n = [Math]::Abs([BitConverter]::ToInt32($buffer, 0)) % $abc.Length
            [void]$sb.Append($abc[$n])
        }
    } finally { $rng.Dispose() }
    return $sb.ToString()
}

if (-not (Test-Path $rutaEnv)) {
    if ($SoloRevisar) {
        Escribir-Aviso 'No existe backend\.env. Habría que crearlo.'
    } else {
        Write-Host ''
        Write-Host '          No hay .env todavía. Te pido los datos una sola vez.' -ForegroundColor White
        Write-Host '          (La contraseña no se muestra en pantalla ni queda en el historial.)' -ForegroundColor DarkGray
        Write-Host ''

        if (Test-Path $rutaPlantilla) {
            Copy-Item $rutaPlantilla $rutaEnv
        } else {
            New-Item -ItemType File -Path $rutaEnv -Force | Out-Null
        }

        Write-Host '          --- Base propia del sistema (SGC_COMPRAS) ---' -ForegroundColor DarkGray
        $dbHost = Pedir-Texto 'Servidor de SQL Server' 'localhost'
        $dbBase = Pedir-Texto 'Nombre de la base'      'SGC_COMPRAS'
        $dbUser = Pedir-Texto 'Usuario de SQL'         'sgc_app'
        $dbPass = Pedir-Secreto 'Contraseña de ese usuario'

        <#
            De dónde salen las existencias.

            Hay dos caminos y el sistema prefiere el primero que esté
            configurado. No es lo mismo elegir mal que dejarlo vacío: sin
            ninguno de los dos, la aplicación arranca igual pero muestra un
            catálogo SIMULADO. Existencias inventadas en una pantalla que se
            ve idéntica a la de verdad es el peor final posible, así que aquí
            se pregunta en lugar de suponer.
        #>
        Write-Host ''
        Write-Host '          --- ¿De dónde lee las existencias de Quiter? ---' -ForegroundColor DarkGray
        Write-Host '            1) Por la API interna de refacciones (lo que ya funciona hoy)' -ForegroundColor Gray
        Write-Host '            2) Directo al SQL Server de Quiter (necesita un usuario de solo lectura)' -ForegroundColor Gray
        $caminoErp = Pedir-Texto 'Elige 1 o 2' '1'

        if ($caminoErp -eq '2') {
            $erpHost = Pedir-Texto 'Servidor de Quiter'  $dbHost
            $erpBase = Pedir-Texto 'Base de datos de Quiter' ''
            $erpUser = Pedir-Texto 'Usuario de solo lectura' 'sgc_compras_ro'
            $erpPass = Pedir-Secreto 'Contraseña de ese usuario'

            Establecer-ValorEnv $rutaEnv 'ERPSQL_HOST'     $erpHost
            Establecer-ValorEnv $rutaEnv 'ERPSQL_PORT'     '1433'
            Establecer-ValorEnv $rutaEnv 'ERPSQL_DATABASE' $erpBase
            Establecer-ValorEnv $rutaEnv 'ERPSQL_USER'     $erpUser
            Establecer-ValorEnv $rutaEnv 'ERPSQL_PASSWORD' $erpPass
            Remove-Variable erpPass -ErrorAction SilentlyContinue
            Escribir-Ok 'Existencias: directo al SQL Server de Quiter.'
        } else {
            $apiUrl = Pedir-Texto 'URL de la API de refacciones' 'https://api.catosaapps.lat'
            Establecer-ValorEnv $rutaEnv 'QUITER_BASE_URL'  $apiUrl
            Establecer-ValorEnv $rutaEnv 'QUITER_TIMEOUT_MS' '5000'
            # Vacías a propósito: si tuvieran valor, el sistema preferiría el
            # camino de SQL sobre el que se acaba de elegir.
            Establecer-ValorEnv $rutaEnv 'ERPSQL_HOST'     ''
            Establecer-ValorEnv $rutaEnv 'ERPSQL_DATABASE' ''
            Escribir-Ok "Existencias: por la API ($apiUrl)."
        }

        Establecer-ValorEnv $rutaEnv 'NODE_ENV'    'production'
        Establecer-ValorEnv $rutaEnv 'PORT'        "$Puerto"
        Establecer-ValorEnv $rutaEnv 'CORS_ORIGIN' "https://$Dominio"

        Establecer-ValorEnv $rutaEnv 'DB_HOST'     $dbHost
        Establecer-ValorEnv $rutaEnv 'DB_PORT'     '1433'
        Establecer-ValorEnv $rutaEnv 'DB_DATABASE' $dbBase
        Establecer-ValorEnv $rutaEnv 'DB_USER'     $dbUser
        Establecer-ValorEnv $rutaEnv 'DB_PASSWORD' $dbPass
        Establecer-ValorEnv $rutaEnv 'DB_ENCRYPT'    'true'
        Establecer-ValorEnv $rutaEnv 'DB_TRUST_CERT' 'true'

        Establecer-ValorEnv $rutaEnv 'ERPSQL_ENCRYPT'    'true'
        Establecer-ValorEnv $rutaEnv 'ERPSQL_TRUST_CERT' 'true'
        Establecer-ValorEnv $rutaEnv 'ERPSQL_ALMACENES'  '101,102,103,104,201,202,203'
        Establecer-ValorEnv $rutaEnv 'ERP_ALMACEN_DEFAULT' '101'
        Establecer-ValorEnv $rutaEnv 'ERP_CACHE_TTL_SEG'   '30'

        # Las variables locales con contraseñas se limpian en cuanto se usaron.
        Remove-Variable dbPass -ErrorAction SilentlyContinue

        Escribir-Ok 'backend\.env creado.'
    }
}

if (Test-Path $rutaEnv) {
    # La llave JWT: si no hay una propia, se genera aquí. Nadie la ve ni la teclea.
    $llave = Obtener-ValorEnv $rutaEnv 'JWT_SECRET'
    $llaveEsInsegura = ([string]::IsNullOrWhiteSpace($llave)) -or
                       ($llave -like 'llave-insegura*') -or ($llave.Length -lt 32)

    if ($llaveEsInsegura) {
        if ($SoloRevisar) {
            Escribir-Aviso 'JWT_SECRET falta o es el valor por omisión. Con esa llave, cualquiera que lea el código puede fabricarse un token de Gerente.'
        } else {
            Establecer-ValorEnv $rutaEnv 'JWT_SECRET' (Nueva-Llave 64)
            Escribir-Ok 'JWT_SECRET generado (64 caracteres aleatorios). Nadie necesita conocerlo.'
            Escribir-Dato 'Esto cierra las sesiones que estuvieran abiertas: es lo esperado.'
        }
    } else {
        Escribir-Ok 'JWT_SECRET propio, ya configurado.'
    }

    # Producción y CORS: se corrigen siempre, son los que más se olvidan.
    $entorno = Obtener-ValorEnv $rutaEnv 'NODE_ENV'
    if ($entorno -ne 'production') {
        if ($SoloRevisar) { Escribir-Aviso "NODE_ENV está en '$entorno'; en el servidor debe ser 'production'." }
        else { Establecer-ValorEnv $rutaEnv 'NODE_ENV' 'production'; Escribir-Ok 'NODE_ENV=production' }
    } else { Escribir-Ok 'NODE_ENV=production' }

    $cors = Obtener-ValorEnv $rutaEnv 'CORS_ORIGIN'
    $corsEsperado = "https://$Dominio"
    if ($cors -ne $corsEsperado) {
        if ($SoloRevisar) { Escribir-Aviso "CORS_ORIGIN dice '$cors'; debería ser '$corsEsperado'." }
        else { Establecer-ValorEnv $rutaEnv 'CORS_ORIGIN' $corsEsperado; Escribir-Ok "CORS_ORIGIN=$corsEsperado" }
    } else { Escribir-Ok "CORS_ORIGIN=$corsEsperado" }
}

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Dependencias'
# ─────────────────────────────────────────────────────────────────────────────
Push-Location $rutaBackend
try {
    if ($SoloRevisar) {
        if (Test-Path (Join-Path $rutaBackend 'node_modules')) { Escribir-Ok 'node_modules presente.' }
        else { Escribir-Aviso 'Faltan las dependencias del backend.' }
    } else {
        # npm ci respeta el package-lock al pie de la letra: instala exactamente
        # las mismas versiones que se probaron, no "las más nuevas compatibles".
        if (Test-Path (Join-Path $rutaBackend 'package-lock.json')) { npm ci } else { npm install }
        if ($LASTEXITCODE -ne 0) { Detener 'Falló la instalación de dependencias del backend.' }
        Escribir-Ok 'Dependencias del backend instaladas.'
    }
} finally { Pop-Location }

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Base de datos'
# ─────────────────────────────────────────────────────────────────────────────
<#
    El diagnóstico corre con Node y necesita dos cosas que en una máquina
    recién preparada todavía no existen: el .env (para saber a dónde conectarse)
    y las dependencias (para tener el driver de SQL Server).

    En el despliegue de verdad ya están, porque los pasos 3 y 4 van antes. En
    modo revisión no, y eso NO es un error: es lo normal la primera vez. Por
    eso aquí se dice y se sigue, en lugar de detener la revisión —que existe
    justamente para ver el panorama completo antes de tocar nada.
#>
$estado = $null
$faltaEnv  = -not (Test-Path $rutaEnv)
$faltaDeps = -not (Test-Path (Join-Path $rutaBackend 'node_modules'))

if ($faltaEnv -or $faltaDeps) {
    $queFalta = @()
    if ($faltaEnv)  { $queFalta += 'el archivo .env' }
    if ($faltaDeps) { $queFalta += 'las dependencias' }
    $listado = $queFalta -join ' y '

    if ($SoloRevisar) {
        Escribir-Dato "Todavía no se puede consultar la base: falta $listado."
        Escribir-Dato 'Es lo normal en una instalación nueva. El despliegue lo resuelve en los pasos 3 y 4.'
    } else {
        Detener "No se puede consultar la base porque falta $listado."
    }
} else {
    Push-Location $rutaBackend
    try {
        # La salida de error se guarda: si Node truena, el mensaje es lo único
        # que dice por qué, y perderlo deja al operador sin nada que buscar.
        $errores = Join-Path ([System.IO.Path]::GetTempPath()) 'sgc-estado-db.err'
        $salida = (& node scripts/estadoDb.js 2>$errores | Select-Object -Last 1)
        if ($salida) {
            $estado = $salida | ConvertFrom-Json
        } else {
            Escribir-Aviso 'El diagnóstico de la base no devolvió nada.'
            if (Test-Path $errores) {
                foreach ($linea in (Get-Content $errores | Select-Object -First 4)) {
                    Escribir-Dato $linea
                }
            }
        }
    } catch {
        Escribir-Aviso "No se pudo diagnosticar la base: $($_.Exception.Message)"
    } finally { Pop-Location }
}

if ($estado) {
    Escribir-Dato ("Servidor: " + $estado.servidor + "   Base: " + $estado.base_datos)
}

if ($estado -and -not $estado.conecta) {
    Write-Host ''
    Write-Host "     No hay conexión con SQL Server: $($estado.error)" -ForegroundColor Red
    Write-Host '     Revisa DB_HOST, DB_USER y DB_PASSWORD en backend\.env,' -ForegroundColor Red
    Write-Host '     y que el servidor acepte conexiones TCP/IP en el puerto 1433.' -ForegroundColor Red
    if (-not $SoloRevisar) { exit 1 }
    Escribir-Aviso 'Sin base no se puede desplegar. Arregla eso antes de correrlo en serio.'
    $estado = $null
} elseif ($estado) {
    Escribir-Ok 'Conexión con SQL Server correcta.'
}

if ($estado) { switch ($estado.accion_sugerida) {

    'crear_base' {
        Escribir-Aviso "La base $($estado.base_datos) no existe todavía."
        if ($SoloRevisar) { break }
        if (Confirmar "¿Creo la base $($estado.base_datos)?") {
            Push-Location $rutaBackend
            try {
                # Se crea desde Node con las mismas credenciales del .env,
                # para no depender de que sqlcmd esté instalado.
                $creador = @"
import sql from 'mssql';
import { env } from './src/config/env.js';
const cfg = { server: env.db.host, port: env.db.port, database: 'master',
  user: env.db.user, password: env.db.password,
  options: { encrypt: env.db.encrypt, trustServerCertificate: env.db.trustServerCertificate } };
const pool = await new sql.ConnectionPool(cfg).connect();
await pool.request().batch('CREATE DATABASE [' + env.db.database.replace(/]/g, ']]') + ']');
await pool.close();
console.log('creada');
"@
                $tmp = Join-Path $rutaBackend 'crear-base.tmp.mjs'
                Set-Content -Path $tmp -Value $creador -Encoding UTF8
                node $tmp
                $codigo = $LASTEXITCODE
                Remove-Item $tmp -Force -ErrorAction SilentlyContinue
                if ($codigo -ne 0) { Detener 'No se pudo crear la base. ¿El usuario tiene permiso de CREATE DATABASE?' }
                Escribir-Ok "Base $($estado.base_datos) creada."
                $estado.accion_sugerida = 'instalar_esquema'
            } finally { Pop-Location }
        } else {
            Detener 'Sin la base no se puede continuar. Créala a mano y vuelve a correr esto.'
        }
    }
} }

if ($estado -and $estado.accion_sugerida -eq 'instalar_esquema') {
    Escribir-Dato 'La base está vacía: se instala el esquema desde cero.'
    if (-not $SoloRevisar) {
        Push-Location $rutaBackend
        try {
            npm run db:setup
            if ($LASTEXITCODE -ne 0) { Detener 'Falló la instalación del esquema.' }
            Escribir-Ok 'Esquema instalado con los datos de arranque.'
        } finally { Pop-Location }
    }
}
elseif ($estado -and $estado.accion_sugerida -eq 'migrar') {
    Escribir-Dato ("Base en uso: {0} usuario(s), {1} solicitud(es)." -f $estado.usuarios, $estado.solicitudes)
    Escribir-Dato 'Solo se aplican migraciones. No se borra nada.'
    if (-not $SoloRevisar) {
        Push-Location $rutaBackend
        try {
            npm run db:migrar
            if ($LASTEXITCODE -ne 0) { Detener 'Falló la migración.' }
            Escribir-Ok 'Base al día.'
        } finally { Pop-Location }
    }
}

if ($estado -and $estado.cuentas_demo_activas -gt 0) {
    Escribir-Aviso ("Hay {0} cuenta(s) de prueba @demo.mx activas. Su contraseña está escrita en el README: desactívalas desde la pantalla Usuarios antes de publicar." -f $estado.cuentas_demo_activas)
}

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Pruebas'
# ─────────────────────────────────────────────────────────────────────────────
if ($SoloRevisar) {
    Escribir-Dato 'Se omiten en modo revisión.'
} else {
    Push-Location $rutaBackend
    try {
        foreach ($prueba in @('test:erp', 'test:usuarios', 'test:sql')) {
            & npm run $prueba --silent | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Detener "Falló '$prueba'. Corre 'npm run $prueba' en $rutaBackend para ver el detalle."
            }
            Escribir-Ok "$prueba"
        }
    } finally { Pop-Location }
}

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Interfaz'
# ─────────────────────────────────────────────────────────────────────────────
if ($SoloRevisar) {
    if (Test-Path (Join-Path $Ruta 'frontend\dist\index.html')) { Escribir-Ok 'Interfaz compilada presente.' }
    else { Escribir-Aviso 'La interfaz no está compilada.' }
} else {
    Push-Location $rutaBackend
    try {
        npm run build:interfaz
        if ($LASTEXITCODE -ne 0) { Detener 'Falló la compilación de la interfaz.' }
        Escribir-Ok 'Interfaz compilada.'
    } finally { Pop-Location }
}

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Prueba de arranque'
# ─────────────────────────────────────────────────────────────────────────────
if ($SoloRevisar) {
    Escribir-Dato 'Se omite en modo revisión.'
} else {
    $nodeExe = (Get-Command node).Source
    $proceso = Start-Process -FilePath $nodeExe -ArgumentList 'src/server.js' `
                             -WorkingDirectory $rutaBackend -PassThru -WindowStyle Hidden
    try {
        $salud = $null
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Seconds 1
            try {
                $salud = Invoke-RestMethod -Uri "http://localhost:$Puerto/api/health" -TimeoutSec 3
                break
            } catch { $salud = $null }
        }

        if (-not $salud) {
            Detener "La aplicación no respondió en http://localhost:$Puerto/api/health. Corre 'npm start' en $rutaBackend para ver el error."
        }

        Escribir-Ok "Responde en http://localhost:$Puerto"
        if ($salud.bd.conectada) { Escribir-Ok 'Base de datos conectada.' }
        else { Escribir-Aviso 'La aplicación arrancó pero no ve la base.' }

        $origen = $salud.erp.origen
        Escribir-Dato "Origen de existencias: $origen"
        if ($origen -eq 'MOCK') {
            Escribir-Aviso 'El ERP está en MOCK: las existencias que mostraría son INVENTADAS.'
            Escribir-Dato 'Configura uno de los dos caminos en backend\.env y vuelve a correr esto:'
            Escribir-Dato '  · QUITER_BASE_URL  (la API de refacciones), o'
            Escribir-Dato '  · ERPSQL_HOST, ERPSQL_DATABASE, ERPSQL_USER y ERPSQL_PASSWORD (SQL directo)'
        }
    } finally {
        if ($proceso -and -not $proceso.HasExited) {
            Stop-Process -Id $proceso.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Escribir-Titulo 'Servicio de Windows'
# ─────────────────────────────────────────────────────────────────────────────
if ($SinServicio) {
    Escribir-Dato 'Omitido por -SinServicio.'
} elseif (-not (Hay-Comando 'Get-ScheduledTask')) {
    Escribir-Aviso 'Este sistema no tiene el Programador de tareas de Windows; el servicio hay que montarlo a mano.'
} elseif ($SoloRevisar) {
    $tarea = Get-ScheduledTask -TaskName $NombreServicio -ErrorAction SilentlyContinue
    if ($tarea) { Escribir-Ok "La tarea '$NombreServicio' ya está registrada." }
    else { Escribir-Aviso "No hay servicio ni tarea: la aplicación no arrancaría sola tras un reinicio." }
} elseif (-not $esAdministrador) {
    Escribir-Aviso 'Se necesita Administrador para registrar el servicio. Vuelve a correr esto en una consola elevada, o hazlo a mano.'
} else {
    $tarea = Get-ScheduledTask -TaskName $NombreServicio -ErrorAction SilentlyContinue
    if ($tarea) {
        Escribir-Ok "La tarea '$NombreServicio' ya existe; se deja como está."
        Escribir-Dato "Para que tome el código nuevo: Restart-ScheduledTask -TaskName $NombreServicio"
    } elseif (Confirmar "¿Registro la tarea '$NombreServicio' para que arranque sola al encender el servidor?") {
        $nodeExe = (Get-Command node).Source
        $accion = New-ScheduledTaskAction -Execute $nodeExe -Argument 'src\server.js' -WorkingDirectory $rutaBackend
        $disparador = New-ScheduledTaskTrigger -AtStartup
        $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                        -DontStopIfGoingOnBatteries -RestartCount 3 `
                        -RestartInterval (New-TimeSpan -Minutes 1) `
                        -ExecutionTimeLimit ([TimeSpan]::Zero)
        $entidad = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

        Register-ScheduledTask -TaskName $NombreServicio -Action $accion -Trigger $disparador `
                               -Settings $ajustes -Principal $entidad `
                               -Description 'SGC Compras: API e interfaz del sistema de solicitudes.' | Out-Null
        Start-ScheduledTask -TaskName $NombreServicio
        Escribir-Ok "Tarea '$NombreServicio' registrada y arrancada."
        Escribir-Dato "Detener:  Stop-ScheduledTask -TaskName $NombreServicio"
        Escribir-Dato "Arrancar: Start-ScheduledTask -TaskName $NombreServicio"
    } else {
        Escribir-Aviso 'Sin servicio: la aplicación no arrancará sola después de un reinicio.'
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# Cierre
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ══════════════════════════════════════════════════════════════════════'
if ($SoloRevisar) {
    Write-Host '   Revisión terminada. No se modificó nada.' -ForegroundColor Cyan
} else {
    Write-Host '   Despliegue terminado.' -ForegroundColor Green
}
Write-Host '  ══════════════════════════════════════════════════════════════════════'

if ($script:Avisos.Count -gt 0) {
    Write-Host ''
    Write-Host '   Pendientes que dejó la revisión:' -ForegroundColor Yellow
    foreach ($a in $script:Avisos) { Write-Host "     · $a" -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '   Falta lo que este script no puede hacer solo (configuración de red):' -ForegroundColor White
Write-Host ''
Write-Host '   1. Agregar la entrada en el archivo de cloudflared, junto a la que ya'
Write-Host '      publica api.catosaapps.lat:'
Write-Host ''
Write-Host '        ingress:'
Write-Host '          - hostname: api.catosaapps.lat'
Write-Host '            service: http://localhost:3000'
Write-Host ("          - hostname: {0}" -f $Dominio) -ForegroundColor Cyan
Write-Host ("            service: http://localhost:{0}" -f $Puerto) -ForegroundColor Cyan
Write-Host '          - service: http_status:404'
Write-Host ''
Write-Host '   2. Crear el registro DNS:'
Write-Host ''
Write-Host ("        cloudflared tunnel route dns <nombre-del-tunel> {0}" -f $Dominio) -ForegroundColor Cyan
Write-Host ''
Write-Host '   3. Reiniciar cloudflared para que tome la configuración nueva.'
Write-Host ''
Write-Host '   Y antes de darle el dominio al equipo: entra al sistema, crea tu cuenta'
Write-Host '   real de Gerente y desactiva las cuatro cuentas @demo.mx.' -ForegroundColor White
Write-Host ''
