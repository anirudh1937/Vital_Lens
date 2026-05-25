@echo off
cd /d f:\venv-vitallens\Include\mate_AI\mate_AI\vitallens-app\backend
echo Starting VitalLens Backend on Port 8000...
uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
