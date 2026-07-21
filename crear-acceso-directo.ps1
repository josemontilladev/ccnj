# Crea el acceso directo "Membresía CFNJ" en el escritorio de esta PC,
# apuntando a la carpeta donde esté este archivo (funciona en cualquier equipo).

$carpeta = $PSScriptRoot

# Busca Microsoft Edge (viene con Windows) o Google Chrome
$navegadores = @(
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$navegador = $navegadores | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $navegador) {
    Write-Host "No se encontró Microsoft Edge ni Google Chrome en esta PC." -ForegroundColor Red
    exit 1
}

# Ruta del index.html en formato URL (con espacios codificados)
$url = 'file:///' + ($carpeta -replace '\\', '/') + '/index.html'
$url = $url -replace ' ', '%20'

$ws = New-Object -ComObject WScript.Shell
foreach ($destino in @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Membresía CFNJ.lnk'),
    (Join-Path $carpeta 'Membresía CFNJ.lnk')
)) {
    $s = $ws.CreateShortcut($destino)
    $s.TargetPath = $navegador
    $s.Arguments = "--app=`"$url`""
    $s.IconLocation = (Join-Path $carpeta 'favicon.ico')
    $s.WorkingDirectory = $carpeta
    $s.Description = 'Sistema de Membresía CFNJ'
    $s.Save()
}

Write-Host ""
Write-Host "Listo: acceso directo 'Membresía CFNJ' creado en el escritorio." -ForegroundColor Green
