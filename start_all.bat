@echo off
echo Starting all services...

start "Mate AI Server" cmd /k "f:\venv-vitallens\start_mate_ai.bat"
start "VitalLens Backend" cmd /k "f:\venv-vitallens\start_backend.bat"
start "VitalLens Mobile" cmd /k "f:\venv-vitallens\start_mobile.bat"

echo All services are launching in separate windows!
pause
