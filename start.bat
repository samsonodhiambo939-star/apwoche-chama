@echo off
title Apwoche System
cd /d "C:\Users\aaaaa\Desktop\chama_system"
cls
echo ========================================
echo   APWOCHE INVESTMENT GROUP
echo ========================================
echo.

:: Kill old processes
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Start Node Server
echo [1/2] Starting server...
start "Apwoche-Server" /MIN node server.js
timeout /t 3 /nobreak >nul

:: Start Cloudflare Tunnel
echo [2/2] Starting Cloudflare Tunnel...
start "Apwoche-Tunnel" /MIN "C:\Users\aaaaa\AppData\Local\Temp\cloudflared.exe" tunnel --url http://localhost:3000 --no-tls-verify --logfile "%TEMP%\cf_url.txt" --loglevel info
timeout /t 12 /nobreak >nul

:: Get the URL
cls
echo ========================================
echo   SYSTEM IS RUNNING
echo ========================================
echo.
echo   Local:      http://localhost:3000
echo   WiFi:       http://192.168.0.105:3000
echo.
echo   REMOTE URL (from phone anywhere):
for /f "tokens=*" %%a in ('findstr /c:"https://" "%TEMP%\cf_url.txt" ^| findstr /c:".trycloudflare.com"') do set "line=%%a"
echo   %line:^|=%
echo.
echo ========================================
echo   Keep this window open to keep the system running
echo   Close it to stop everything
echo ========================================
echo.

:: Keep alive
:loop
timeout /t 30 /nobreak >nul
tasklist /fi "imagename eq node.exe" 2>nul | find /i "node.exe" >nul
if errorlevel 1 (
    echo [WARNING] Server stopped! Restarting...
    start "Apwoche-Server" /MIN node server.js
)
tasklist /fi "imagename eq cloudflared.exe" 2>nul | find /i "cloudflared.exe" >nul
if errorlevel 1 (
    echo [WARNING] Tunnel stopped! Restarting...
    start "Apwoche-Tunnel" /MIN "C:\Users\aaaaa\AppData\Local\Temp\cloudflared.exe" tunnel --url http://localhost:3000 --no-tls-verify --logfile "%TEMP%\cf_url.txt" --loglevel info
)
goto loop
