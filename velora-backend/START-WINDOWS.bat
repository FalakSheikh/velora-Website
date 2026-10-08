@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this file again. & pause & exit /b 1)
if not exist .env copy .env.example .env >nul
echo Starting Velora. Open http://localhost:3000 in your browser. Press Ctrl+C to stop.
node start.js
pause
