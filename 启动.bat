@echo off
title Shanghai Qipao Archive - Local Server

REM Switch to PARENT directory (so "../Journal/file.pdf" paths work)
cd /d "%~dp0\.."

echo.
echo  ============================================
echo    Shanghai Qipao Archive - Local Server
echo  ============================================
echo.

REM Detect Python
where python >nul 2>&1
if %errorlevel% equ 0 goto found_python

where py >nul 2>&1
if %errorlevel% equ 0 goto found_py

echo  [X] Python NOT found!
echo.
echo  Please install Python 3.x from:
echo    https://www.python.org/downloads/
echo.
echo  IMPORTANT: Check "Add Python to PATH" during install.
echo.
pause
exit /b 1

:found_python
set PY_CMD=python
goto start_server

:found_py
set PY_CMD=py
goto start_server

:start_server
echo  [OK] Python detected: %PY_CMD%
echo.
echo  ----------------------------------------------
echo    URL  : http://localhost:8000/shiliao_website/
echo    Root : %cd%
echo  ----------------------------------------------
echo.
echo  Tips:
echo    1. Browser opens automatically in 2 seconds.
echo    2. Close THIS window to stop the server.
echo    3. PDFs in sibling folders are now accessible.
echo    4. Data is persistent via localhost.
echo.
echo  Press Ctrl+C to stop the server.
echo.

REM Open browser after 2 seconds (note the /shiliao_website/ path)
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:8000/shiliao_website/index.html"

REM Start HTTP server from PARENT dir (= the folder containing shiliao_website AND your journals)
%PY_CMD% -m http.server 8000

echo.
echo  Server stopped.
pause