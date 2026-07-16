@echo off
setlocal

cd /d "%~dp0"
title AI Hook Lab - Dashboard

echo.
echo ========================================
echo  AI Hook Lab - Backend Dashboard
echo ========================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies. This may take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist ".env.local" (
  echo .env.local was not found.
  if exist ".env.local.example" (
    copy ".env.local.example" ".env.local" >nul
    echo Created .env.local from .env.local.example.
  )
  echo.
  echo Please fill in DEEPSEEK_API_KEY in .env.local before generating hooks.
  start "" notepad ".env.local"
  echo.
  pause
)

echo Opening http://localhost:3001/dashboard ...
start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3001/dashboard'"

echo.
echo If a Next dev server is already running for this folder, stop it first.
echo You can also open http://localhost:3000/dashboard on the existing frontend server.
echo.
echo Starting dashboard on port 3001. Press Ctrl+C to stop the server.
echo.
call npm run dev -- -p 3001

echo.
pause
