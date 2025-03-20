@echo off
title LivePlay Server
echo [%date% %time%] Starting LivePlay server...
echo.
echo Server will run on http://localhost:3000
echo Press Ctrl+C to stop the server
echo.

:: Vérifier si Node.js est installé
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js n'est pas installé sur votre système.
    echo Veuillez installer Node.js depuis https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Vérifier si les dépendances sont installées
if not exist "node_modules" (
    echo [INFO] Installation des dépendances...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Erreur lors de l'installation des dépendances.
        pause
        exit /b 1
    )
)

:: Démarrer le serveur
node server.js

echo.
echo Server stopped
pause
