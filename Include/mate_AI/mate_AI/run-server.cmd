@echo off
setlocal
cd /d "%~dp0"
echo Starting Mate AI server...
if not exist "node_modules" (
  echo Installing dependencies first...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    exit /b 1
  )
)
echo Auto-restart mode enabled. Server will restart on file changes.
call npm run dev
