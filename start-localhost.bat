@echo off
title Dicklum Water Association - Local Server (Port 3000)
cd /d "%~dp0"
echo Starting Dicklum Water Association Local Server...
echo Open http://localhost:3000/ in your browser.
start "" "http://localhost:3000/"
node server.js
pause
