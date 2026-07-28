@echo off
setlocal EnableExtensions
title KLine Training Camp 2.0 - Local Web

set "KLINE_WEB_DIR=%~dp0web"
set "KLINE_LOCAL_URL=http://localhost:3000"
set "KLINE_DATA_URL=http://127.0.0.1:3100/health"
set "KLINE_DATA_SERVICE_VERSION=2"
set "KLINE_DATA_STARTED=0"
set "KLINE_LAN_IP="
set "KLINE_MOBILE_URL="

for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -Command "$config = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1; if ($config.IPv4Address.IPAddress) { $config.IPv4Address.IPAddress }"`) do set "KLINE_LAN_IP=%%I"
if defined KLINE_LAN_IP set "KLINE_MOBILE_URL=http://%KLINE_LAN_IP%:3000"

if exist "%KLINE_WEB_DIR%\package.json" goto project_found
echo [ERROR] Web project not found: %KLINE_WEB_DIR%
echo Keep this BAT file in the KLine Training Camp project folder.
goto fatal

:project_found
where node.exe >nul 2>nul
if not errorlevel 1 goto node_found
echo [ERROR] Node.js was not found.
echo Install Node.js 22.13 or newer from https://nodejs.org/
goto fatal

:node_found
where npm.cmd >nul 2>nul
if not errorlevel 1 goto npm_found
echo [ERROR] npm was not found. Reinstall Node.js and try again.
goto fatal

:npm_found
cd /d "%KLINE_WEB_DIR%"
if not exist "node_modules\" goto install_dependencies
node -e "import('unzipper')" >nul 2>nul
if not errorlevel 1 goto dependencies_ready

:install_dependencies
echo Installing required components. Please wait...
call npm.cmd install
if not errorlevel 1 goto dependencies_ready
echo [ERROR] Dependency installation failed. Check the network and retry.
goto fatal

:dependencies_ready
if not exist ".local-data\" mkdir ".local-data"

rem Check the companion service used for resumable TDX downloads.
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%KLINE_DATA_URL%' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200 -and $r.Content -match 'kline-local-data' -and $r.Content -match 'serviceVersion.*%KLINE_DATA_SERVICE_VERSION%') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto data_ready

rem A service may already be starting on port 3100. Give it time before treating it as a conflict.
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 goto start_data_service

echo Local data port 3100 is active. Waiting for the service to become ready...
powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(20); do { try { $r = Invoke-WebRequest -Uri '%KLINE_DATA_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'kline-local-data' -and $r.Content -match 'serviceVersion.*%KLINE_DATA_SERVICE_VERSION%') { exit 0 } } catch {}; Start-Sleep -Milliseconds 700 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>nul
if not errorlevel 1 goto data_ready
goto restart_stale_data_service

:restart_stale_data_service
rem A previous project version may have left its helper running. Restart only
rem when the saved PID still belongs to this project's local data service.
powershell.exe -NoProfile -Command "$pidFile = '%KLINE_WEB_DIR%\.local-data\service.pid'; if (!(Test-Path -LiteralPath $pidFile)) { exit 1 }; $servicePid = [int](Get-Content -LiteralPath $pidFile -Raw); $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $servicePid); if (!$process -or $process.CommandLine -notmatch 'local-data/server\.mjs') { exit 1 }; Stop-Process -Id $servicePid -Force; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue; $deadline = (Get-Date).AddSeconds(10); do { if (!(Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)) { exit 0 }; Start-Sleep -Milliseconds 300 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>nul
if not errorlevel 1 goto start_data_service
goto data_port_conflict

:start_data_service
echo Starting local market data service...
powershell.exe -NoProfile -Command "$p = Start-Process -FilePath 'node.exe' -ArgumentList 'local-data/server.mjs' -WorkingDirectory '%KLINE_WEB_DIR%' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '%KLINE_WEB_DIR%\.local-data\service.pid' -Value $p.Id -Encoding ascii"
if errorlevel 1 goto data_start_error
set "KLINE_DATA_STARTED=1"

powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(30); do { try { $r = Invoke-WebRequest -Uri '%KLINE_DATA_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'kline-local-data' -and $r.Content -match 'serviceVersion.*%KLINE_DATA_SERVICE_VERSION%') { exit 0 } } catch {}; Start-Sleep -Milliseconds 700 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>nul
if not errorlevel 1 goto data_ready

:data_start_error
echo [ERROR] Local data service did not become ready.
echo Restart this BAT once. If it still fails, check whether security software blocked node.exe.
goto cleanup_and_fatal

:data_port_conflict
echo [ERROR] Port 3100 is used by another program, but it is not this project's data service.
powershell.exe -NoProfile -Command "$owner = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($owner) { $p = Get-Process -Id $owner -ErrorAction SilentlyContinue; if ($p) { Write-Host ('Process: ' + $p.ProcessName + ' (PID ' + $owner + ')') } }"
echo Close the program shown above and retry.
goto fatal

:data_ready
rem If this application is already running, open the browser and keep this
rem information window visible. An older process may still be bound to
rem loopback only, in which case it must be restarted once for phone access.
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%KLINE_LOCAL_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'K') { exit 0 } } catch {}; exit 1" >nul 2>nul
if errorlevel 1 goto check_web_port

powershell.exe -NoProfile -Command "$listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue); $lanListeners = @($listeners.Where({ $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' })); if ($lanListeners.Count -gt 0) { exit 0 }; exit 1" >nul 2>nul
if errorlevel 1 goto existing_local_only_web

echo KLine Training Camp is already running in another window.
echo Web:  %KLINE_LOCAL_URL%
if defined KLINE_MOBILE_URL echo Phone: %KLINE_MOBILE_URL%
echo.
echo Closing this information window will not stop the existing service.
start "" "%KLINE_LOCAL_URL%"
pause
exit /b 0

:existing_local_only_web
echo [NOTICE] An older local-only KLine Training Camp instance is still running.
echo It must be restarted once before a phone can connect.
echo.
powershell.exe -NoProfile -Command "$owner = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($owner) { $p = Get-Process -Id $owner -ErrorAction SilentlyContinue; if ($p) { Write-Host ('Current process: ' + $p.ProcessName + ' (PID ' + $owner + ')') } }"
echo Close the original KLine Training Camp BAT window or press Ctrl+C there.
echo Then double-click this BAT again. The new service will show:
if defined KLINE_MOBILE_URL echo Phone: %KLINE_MOBILE_URL%
goto fatal

:check_web_port
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 goto start_web
echo [ERROR] Port 3000 is already used by another program.
goto cleanup_and_fatal

:start_web
echo Starting KLine Training Camp...
echo Web:  %KLINE_LOCAL_URL%
if defined KLINE_MOBILE_URL echo Phone: %KLINE_MOBILE_URL%
echo Data: http://127.0.0.1:3100
if defined KLINE_MOBILE_URL echo Phone and PC must use the same trusted Wi-Fi. Allow Node.js through Windows Firewall if prompted.
echo Close this window or press Ctrl+C to stop the local web service.
echo.
rem Wait for two consecutive successful responses. The worker may briefly reload
rem after the first cold-start response, so a fixed delay can open the browser
rem while Vinext/Miniflare is still reconnecting internally.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "$deadline = (Get-Date).AddSeconds(90); $ready = 0; do { try { $r = Invoke-WebRequest -Uri '%KLINE_LOCAL_URL%' -UseBasicParsing -TimeoutSec 4; if ($r.StatusCode -eq 200) { $ready += 1 } else { $ready = 0 } } catch { $ready = 0 }; if ($ready -ge 2) { Start-Process '%KLINE_LOCAL_URL%'; exit 0 }; Start-Sleep -Milliseconds 900 } while ((Get-Date) -lt $deadline); Start-Process '%KLINE_LOCAL_URL%'"
call npm.cmd run dev
goto cleanup_and_exit

:cleanup_and_fatal
if not "%KLINE_DATA_STARTED%"=="1" goto fatal
powershell.exe -NoProfile -Command "$pidFile = '%KLINE_WEB_DIR%\.local-data\service.pid'; if (Test-Path -LiteralPath $pidFile) { $servicePid = [int](Get-Content -LiteralPath $pidFile -Raw); Stop-Process -Id $servicePid -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }"
goto fatal

:cleanup_and_exit
if not "%KLINE_DATA_STARTED%"=="1" goto stopped
powershell.exe -NoProfile -Command "$pidFile = '%KLINE_WEB_DIR%\.local-data\service.pid'; if (Test-Path -LiteralPath $pidFile) { $servicePid = [int](Get-Content -LiteralPath $pidFile -Raw); Stop-Process -Id $servicePid -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }"

:stopped
echo.
echo Local services stopped.
pause
exit /b 0

:fatal
pause
exit /b 1
