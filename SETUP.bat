@echo off
title Snap2Sheet — Setup Wizard
color 0B

echo =======================================================
echo          Snap2Sheet Setup Wizard
echo =======================================================
echo.
echo Memeriksa Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terinstall di komputer ini!
    echo Silakan download dan install Node.js dari: https://nodejs.org/
    pause
    exit /b 1
)

call npx tsx scripts/setup-wizard.ts

pause
