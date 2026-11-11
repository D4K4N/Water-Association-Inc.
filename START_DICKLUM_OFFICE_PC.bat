@echo off
title Dicklum Water Association - Office PC & Field Reader Server
cd /d "%~dp0"
echo ============================================================================
echo   DICKLUM WATER ASSOCIATION, INC. - OFFICE PC & FIELD READER SERVER
echo ============================================================================
echo.
echo   Starting local database & consumer folders server on port 3000...
echo   Opening http://localhost:3000 in your browser...
echo.
start "" "http://localhost:3000"
node server.js
pause
