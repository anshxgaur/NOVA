@echo off
title NOVA Startup Sequence
color 0B

echo =========================================
echo       INITIALIZING NOVA CORE SYSTEMS
echo =========================================
echo.

echo [1/3] Waking up Local AI Engine (Ollama)...
start /B ollama serve
timeout /t 2 /nobreak > nul

echo [2/3] Connecting Neural Backend...
start "NOVA Backend" /D "%~dp0MODEL-X" cmd /k "call venv\Scripts\activate && python app.py"
timeout /t 2 /nobreak > nul

echo [3/3] Launching User Interface...
start "NOVA Frontend" /D "%~dp0" cmd /k "npm run dev"

echo.
echo =========================================
echo       ALL SYSTEMS ONLINE
echo =========================================
echo Close this window at any time.
pause