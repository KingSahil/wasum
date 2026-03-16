@echo off
title WA Summariser
color 0A

set "ROOT=%~dp0.."

echo ==========================================
echo   WA Chat Summariser - Starting...
echo ==========================================
echo.

:: Build frontend so server serves latest frontend/dist
echo [0/2] Building frontend...
pushd "%ROOT%"
call npm run build >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Frontend build failed. Run "npm run build" manually to inspect errors.
    popd
    pause
    exit /b 1
)

:: Kill any existing node/chrome and free port 3000
echo [1/2] Freeing port 3000 and cleaning up...
taskkill /IM node.exe /F >nul 2>&1
taskkill /IM chrome.exe /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
:: Remove stale Puppeteer lock files
del /f /q "%ROOT%\.wwebjs_auth\session\SingletonLock" >nul 2>&1
del /f /q "%ROOT%\.wwebjs_auth\session\SingletonSocket" >nul 2>&1
timeout /t 1 /nobreak >nul

:: Start backend
echo [2/2] Starting backend server...
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'backend/server.js' -WorkingDirectory '%ROOT%' -NoNewWindow"
popd

echo.
echo ==========================================
echo   Running at http://localhost:3000
echo ==========================================
pause
