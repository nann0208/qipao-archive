@echo off
title Shanghai Qipao Archive - AI Service
cd /d "%~dp0ai_service"

if not exist ".venv\Scripts\python.exe" (
  echo [首次启动] 正在建立 AI 服务所需环境...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)

if not exist ".env" (
  echo.
  echo [需要配置] 请将 .env.example 复制为 .env，填写 ARK_API_KEY 与 ARK_MODEL 后重新启动。
  pause
  exit /b 1
)

echo.
echo AI 服务已启动：http://127.0.0.1:8765
echo 请保持此窗口开启，再打开本地史料库使用「AI 识别与分析」。
echo.
python server.py

