@echo off
setlocal enabledelayedexpansion
title Flux APK Server - Stopping
echo [%date% %time%] Stopping Flux APK server...
echo.

:: Trouver et arrêter le processus utilisant le port 8080
set "found=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080.*LISTENING"') do (
    echo Found process using port 8080 with PID: %%a
    taskkill /F /PID %%a >nul 2>nul
    if !errorlevel! equ 0 (
        set "found=1"
        echo Successfully stopped process with PID: %%a
    )
)

:: Vérifier aussi les processus node exécutant server.js
for /f "tokens=2" %%a in ('wmic process where "commandline like '%%server.js%%' and name='node.exe'" get processid ^| findstr /r "[0-9]"') do (
    echo Found Node.js server process with PID: %%a
    taskkill /F /PID %%a >nul 2>nul
    if !errorlevel! equ 0 (
        set "found=1"
        echo Successfully stopped Node.js process with PID: %%a
    )
)

if "%found%"=="0" (
    echo No running server instances found
) else (
    echo All server processes have been stopped
)

echo.
timeout /t 2 >nul
exit /b 0
