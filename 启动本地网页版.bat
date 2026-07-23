@echo off
setlocal EnableExtensions
chcp 65001 >nul
title K线训练营 2.0 - 本地网页版

set "KLINE_WEB_DIR=%~dp0web"
set "KLINE_LOCAL_URL=http://localhost:3000"

if not exist "%KLINE_WEB_DIR%\package.json" (
  echo [错误] 找不到网页项目：%KLINE_WEB_DIR%
  echo 请确认本文件仍放在“K线训练营2.0”文件夹中。
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo 请先安装 Node.js 22.13 或更高版本，然后重新双击本文件。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 npm，请重新安装 Node.js。
  pause
  exit /b 1
)

cd /d "%KLINE_WEB_DIR%"

rem 如果训练营已经在 3000 端口运行，直接打开，不重复启动。
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%KLINE_LOCAL_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'K线训练营') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo K线训练营已经在运行，正在打开浏览器……
  start "" "%KLINE_LOCAL_URL%"
  exit /b 0
)

rem 避免误打开占用了 3000 端口的其他程序。
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo [错误] 端口 3000 已被其他程序占用。
  echo 请关闭占用端口的程序后再试。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 首次运行，正在安装所需组件，请稍候……
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] 组件安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在启动 K线训练营……
echo 浏览器会自动打开：%KLINE_LOCAL_URL%
echo 关闭本窗口或按 Ctrl+C 可以停止本地服务。
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process '%KLINE_LOCAL_URL%'"
call npm run dev

echo.
echo 本地服务已停止。
pause
exit /b 0
