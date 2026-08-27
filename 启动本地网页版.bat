@echo off
setlocal EnableExtensions

rem Compatibility launcher. The native EXE owns the actual services.
set "KLINE_WEB_PORT=3101"
set "KLINE_LOCAL_URL=http://localhost:%KLINE_WEB_PORT%"
set "KLINE_DATA_URL=http://127.0.0.1:3100/health"
set "KLINE_LAN_IP="
set "KLINE_MOBILE_URL="
set "KLINE_REMOTE_HOST=kline42.dynv6.net"
set "KLINE_REMOTE_URL=http://%KLINE_REMOTE_HOST%:%KLINE_WEB_PORT%"

rem Phone (LAN) uses the panel detected KLINE_MOBILE_URL and the same trusted Wi-Fi.
rem Remote (IPv6): %KLINE_REMOTE_URL%
rem This launcher does not open a public firewall port automatically.

set "KLINE_PANEL_EXE=%~dp0KLineTrainingCamp.ControlPanel.exe"
if not exist "%KLINE_PANEL_EXE%" (
  echo [ERROR] Native control panel not found: %KLINE_PANEL_EXE%
  echo Please run launcher\build-native-control-panel.ps1 to build it first.
  pause
  exit /b 1
)

start "" "%KLINE_PANEL_EXE%" %*
exit /b %errorlevel%
