@echo off
title PrivacyAgent - Stop Server

echo ========================================
echo PRIVACYAGENT STOP SCRIPT
echo ========================================

echo Searching for PrivacyAgent server on port 8000...
set FOUND_PID=

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do set FOUND_PID=%%a

if not "%FOUND_PID%"=="" (
    echo Terminating PrivacyAgent server process PID: %FOUND_PID% ...
    taskkill /F /PID %FOUND_PID%
    echo [SUCCESS] PrivacyAgent server on port 8000 stopped safely.
) else (
    echo [INFO] No active PrivacyAgent server process found listening on port 8000.
)

echo ========================================
