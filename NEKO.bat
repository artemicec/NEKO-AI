@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установи версию LTS с https://nodejs.org и запусти этот файл снова.
  pause
  exit /b 1
)
node scripts\launcher.mjs neko %*
if errorlevel 1 pause
