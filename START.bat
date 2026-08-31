@echo off
setlocal enabledelayedexpansion
title PrivacyAgent - SIH 26171 Launcher

echo ========================================
echo PRIVACYAGENT - SIH 26171
echo ========================================

echo [1/5] Checking Python...
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Python 3 was not detected on your system PATH.
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo [2/5] Preparing environment...
cd /d "%~dp0"

if not exist ".venv" (
    echo Creating virtual environment .venv...
    python -m venv .venv
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

echo Installing / verifying required dependencies...
call .venv\Scripts\python.exe -m pip install --quiet -r local-server\requirements.txt

echo [3/5] Starting local privacy server...
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo Local privacy server is already running on port 8000.
) else (
    start "PrivacyAgent Local Server" /min .venv\Scripts\python.exe local-server\start_server.py
)

echo [4/5] Checking server health...
set HEALTH_OK=0
for /l %%i in (1,1,15) do (
    curl -s http://127.0.0.1:8000/health | findstr "privacyagent-local-vision" >nul
    if !errorlevel! equ 0 (
        set HEALTH_OK=1
        goto HEALTH_SUCCESS
    )
    timeout /t 1 /nobreak >nul
)

:HEALTH_SUCCESS
if %HEALTH_OK% equ 0 (
    echo [WARNING] Server health check timed out. Attempting to open demo anyway...
)

echo [5/5] Opening demo...
start "" "http://127.0.0.1:8000/demo"

echo ========================================
echo PrivacyAgent is ready.
echo Local server:
echo http://127.0.0.1:8000
echo Demo Page:
echo http://127.0.0.1:8000/demo
echo ========================================
echo.
pause
