@echo off
echo ========================================
echo Ram360 - Service Installer
echo ========================================
echo.

REM Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Administrator privileges required!
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

echo [1/4] Installing PM2 globally...
call npm install -g pm2@latest
call npm install -g pm2-windows-startup

echo.
echo [2/4] Starting application with PM2...
call pm2 start "%~dp0ecosystem.config.js"
call pm2 save

echo.
echo [3/4] Setting up Windows startup...
call pm2-startup install

echo.
echo [4/4] Verifying installation...
call pm2 list

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo Status: Running
echo Auto-start: Enabled on Windows boot
echo.
echo Useful Commands:
echo   pm2 status          - Check app status
echo   pm2 logs            - View logs
echo   pm2 restart all     - Restart app
echo   pm2 stop all        - Stop app
echo ========================================
pause
