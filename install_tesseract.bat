@echo off
setlocal enabledelayedexpansion
title Install Tesseract OCR for PrivacyAgent

echo ========================================
echo  Tesseract OCR Installer for PrivacyAgent
echo ========================================
echo.

:: Check if already installed
if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
    echo [OK] Tesseract is already installed.
    "C:\Program Files\Tesseract-OCR\tesseract.exe" --version
    pause
    exit /b 0
)

:: Check for admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] This script requires Administrator privileges.
    echo     Right-click this file and select "Run as administrator".
    echo.
    pause
    exit /b 1
)

echo [1/3] Downloading Tesseract OCR v5.4.0 installer...
set "INSTALLER=%TEMP%\tesseract-installer.exe"

if exist "%INSTALLER%" (
    echo       Using cached installer.
) else (
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe' -OutFile '%INSTALLER%' -UseBasicParsing"
    if !errorlevel! neq 0 (
        echo [ERROR] Download failed. Please check your internet connection.
        pause
        exit /b 1
    )
)

echo [2/3] Installing Tesseract OCR silently...
"%INSTALLER%" /S

:: Wait for installation to complete
timeout /t 10 /nobreak >nul

echo [3/3] Verifying installation...
if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
    echo.
    echo [SUCCESS] Tesseract OCR installed successfully!
    "C:\Program Files\Tesseract-OCR\tesseract.exe" --version
    echo.
    echo Please restart the PrivacyAgent server for full OCR support.
) else (
    echo [WARNING] Installation may still be in progress.
    echo           Please wait a moment and check if C:\Program Files\Tesseract-OCR\tesseract.exe exists.
)

echo.
pause
