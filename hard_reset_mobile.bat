@echo off
set NODE_OPTIONS=--max-old-space-size=8192
cd /d f:\venv-vitallens\Include\mate_AI\mate_AI\vitallens-app\mobile\vitallens-mobile

echo Cleaning Expo and npm caches aggressively...
rmdir /s /q .expo
rmdir /s /q node_modules\.cache

echo Starting Expo specifically for Android...
npx expo start -c -a
pause