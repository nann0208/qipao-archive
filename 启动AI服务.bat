@echo off
setlocal
title Shanghai Qipao Archive - AI Service
cd /d "%~dp0ai_service"

powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2; if ($r.ok) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto already_running

if exist ".venv\Scripts\python.exe" goto env_ready

echo [First run] Creating the Python environment...
where python >nul 2>nul
if errorlevel 1 goto python_missing
python -m venv .venv
if errorlevel 1 goto startup_failed
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto startup_failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto startup_failed

:env_ready
REM QuickEdit selection freezes every process attached to this console, including uploads.
REM Keep the service responsive if the console is clicked accidentally.
".venv\Scripts\python.exe" -c "import ctypes; k=ctypes.windll.kernel32; k.GetStdHandle.restype=ctypes.c_void_p; k.GetConsoleMode.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_uint)]; k.SetConsoleMode.argtypes=[ctypes.c_void_p,ctypes.c_uint]; h=k.GetStdHandle(-10); mode=ctypes.c_uint(); ok=k.GetConsoleMode(h,ctypes.byref(mode)); k.SetConsoleMode(h,(mode.value|0x80)&~0x40) if ok else None" >nul 2>nul
".venv\Scripts\python.exe" -c "import opencc, pymupdf" >nul 2>nul
if errorlevel 1 (
  echo [Update] Installing OCR and text conversion components...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto startup_failed
)
echo.
echo Local media and AI service starting at http://127.0.0.1:8765
echo Keep this window open while uploading or playing video.
echo AI analysis needs ai_service\.env; video upload does not.
echo.
".venv\Scripts\python.exe" server.py
if errorlevel 1 goto startup_failed
goto end

:python_missing
echo.
echo [ERROR] Python was not found. Install Python and enable Add Python to PATH.
goto hold_window

:startup_failed
echo.
echo [ERROR] AI service failed. Review the error message above.
goto hold_window

:already_running
echo.
echo AI service is already running at http://127.0.0.1:8765
echo You can return to the archive page and use AI analysis now.
ping 127.0.0.1 -n 6 >nul
goto end

:hold_window
pause

:end
endlocal
