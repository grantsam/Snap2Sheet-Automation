@echo off
title Snap2Sheet Dashboard
color 0B

echo.
echo   =======================================================
echo          Snap2Sheet WhatsApp Automation Dashboard
echo   =======================================================
echo.
echo   Memeriksa Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js belum terinstall!
    echo   Download dari: https://nodejs.org/
    pause
    exit /b 1
)

echo   Membuka Dashboard di browser...
echo.
echo   Dashboard akan terbuka otomatis di http://localhost:3500
echo   Tekan Ctrl+C untuk menutup.
echo.

call npx tsx scripts/dashboard.ts

pause
