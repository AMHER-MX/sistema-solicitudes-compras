<#
    Pruebas de desplegar-servidor.ps1.

        pwsh -File scripts\probar-desplegar.ps1
        powershell -File scripts\probar-desplegar.ps1

    Extrae las funciones del script real y las ejercita por separado, sin
    ejecutar el despliegue. Cubre lo que se puede romper en silencio: el
    manejo del .env (donde ya nos mordio una vez un '#' en una contrasena) y
    el generador de la llave JWT.
#>
$ruta = Join-Path $PSScriptRoot 'desplegar-servidor.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ruta, [ref]$null, [ref]$null)
$queremos = @('Obtener-ValorEnv','Establecer-ValorEnv','Nueva-Llave','Hay-Comando')
foreach ($f in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]}, $true)) {
    if ($queremos -contains $f.Name) { Invoke-Expression $f.Extent.Text }
}

$fallos = 0
function Check($nombre, $ok, $extra='') {
    if ($ok) { Write-Host "  OK  $nombre" -ForegroundColor Green }
    else { Write-Host "  XX  $nombre $extra" -ForegroundColor Red; $script:fallos++ }
}

Write-Host "`n== .env: escribir y leer ==" -ForegroundColor Cyan
$tmp = [System.IO.Path]::GetTempFileName()
Remove-Item $tmp -Force

Establecer-ValorEnv $tmp 'DB_HOST' 'sqlprod01'
Check 'Crea el archivo si no existe' (Test-Path $tmp)
Check 'Lee lo que escribio' ((Obtener-ValorEnv $tmp 'DB_HOST') -eq 'sqlprod01')
Check 'Escribe el valor entre comillas' ((Get-Content $tmp) -join "`n").Contains('DB_HOST="sqlprod01"')

# El bug que ya nos mordio una vez: un '#' en la contrasena.
Establecer-ValorEnv $tmp 'DB_PASSWORD' 'Abc123#xyz$q'
Check 'Sobrevive un # en la contrasena' ((Obtener-ValorEnv $tmp 'DB_PASSWORD') -eq 'Abc123#xyz$q')

Establecer-ValorEnv $tmp 'DB_HOST' 'sqlprod02'
Check 'Reemplaza en vez de duplicar' ((Obtener-ValorEnv $tmp 'DB_HOST') -eq 'sqlprod02')
$repes = @(Get-Content $tmp | Where-Object { $_ -match '^DB_HOST=' })
Check 'Queda una sola linea DB_HOST' ($repes.Count -eq 1) "(hay $($repes.Count))"

Check 'Una clave inexistente devuelve nulo' ($null -eq (Obtener-ValorEnv $tmp 'NO_EXISTE'))
Check 'No confunde claves con prefijo comun' ($null -eq (Obtener-ValorEnv $tmp 'DB_HOS'))

# Que no se coma las lineas que ya estaban
Add-Content $tmp '# un comentario'
Establecer-ValorEnv $tmp 'PORT' '4000'
Check 'Conserva los comentarios' (((Get-Content $tmp) -join "`n").Contains('# un comentario'))
Check 'Y agrega la clave nueva' ((Obtener-ValorEnv $tmp 'PORT') -eq '4000')
Remove-Item $tmp -Force

Write-Host "`n== Llave JWT ==" -ForegroundColor Cyan
$llaves = 1..200 | ForEach-Object { Nueva-Llave 64 }
Check 'Mide 64 caracteres' (($llaves | Where-Object { $_.Length -ne 64 }).Count -eq 0)
Check 'Solo letras y numeros' (($llaves | Where-Object { $_ -notmatch '^[A-Za-z0-9]+$' }).Count -eq 0)
Check 'Nunca se repite' (($llaves | Select-Object -Unique).Count -eq 200)
$usados = ($llaves -join '').ToCharArray() | Select-Object -Unique
Check 'Usa todo el alfabeto' ($usados.Count -ge 60) "($($usados.Count) distintos)"
Check 'Sin comillas ni # (romperian el .env)' (($llaves | Where-Object { $_ -match '["#$]' }).Count -eq 0)

Write-Host "`n== Hay-Comando ==" -ForegroundColor Cyan
Check 'Encuentra uno que existe' (Hay-Comando 'Get-Command')
Check 'Y devuelve falso con uno inventado' (-not (Hay-Comando 'Comando-Que-No-Existe-1234'))

Write-Host ""
if ($fallos -eq 0) { Write-Host "TODAS LAS PRUEBAS DEL SCRIPT PASARON" -ForegroundColor Green; exit 0 }
else { Write-Host "$fallos PRUEBA(S) FALLARON" -ForegroundColor Red; exit 1 }
