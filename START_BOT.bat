@echo off
title Snap2Sheet WhatsApp Bot
color 0A

echo =======================================================
echo          Snap2Sheet WhatsApp Automation Bot
echo =======================================================
echo.
echo [1/2] Memeriksa Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terinstall di komputer ini!
    echo Silakan download dan install Node.js dari: https://nodejs.org/
    pause
    exit /b 1
)

echo [2/2] Memeriksa port kesehatan...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

call npx tsx scripts/launcher.ts

pause
