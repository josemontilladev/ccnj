@echo off
title Empaquetar Membresia CFNJ (instalador de Windows)
echo ============================================================
echo   Genera el instalador de Windows (.exe) con Electron
echo   Requiere Node.js e internet la primera vez.
echo ============================================================
echo.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org y vuelve a ejecutar.
  pause
  exit /b 1
)

echo [1/3] Copiando archivos de la aplicacion...
if not exist "electron\app" mkdir "electron\app"
for %%f in (index.html app.js styles.css datos.js fotos.js assets.js planillas_extra.js logo.png favicon.png) do copy /y "%%f" "electron\app\" >nul
if not exist "electron\build" mkdir "electron\build"
copy /y "favicon.ico" "electron\build\icon.ico" >nul

echo [2/3] Instalando herramientas (solo la primera vez)...
cd electron
call npm install
if errorlevel 1 ( echo Fallo npm install & pause & exit /b 1 )

echo [3/3] Generando el instalador...
call npm run dist
if errorlevel 1 ( echo Fallo la generacion & pause & exit /b 1 )

echo.
echo LISTO. El instalador esta en la carpeta electron\dist
pause
