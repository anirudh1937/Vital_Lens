@echo off
set NODE_OPTIONS=--max-old-space-size=4096
cd /d f:\venv-vitallens\Include\mate_AI\mate_AI\vitallens-app\mobile\vitallens-mobile
echo Clearing Metro Bundler Cache and starting with increased memory...
npx expo start --clear
pause
