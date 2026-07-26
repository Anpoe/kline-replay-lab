@echo off
setlocal EnableExtensions
title KLine Training Camp 2.0 - Local Web

set "KLINE_WEB_DIR=%~dp0web"
set "KLINE_LOCAL_URL=http://localhost:3000"
set "KLINE_DATA_URL=http://127.0.0.1:3100/health"
set "KLINE_DATA_STARTED=0"

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
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%KLINE_DATA_URL%' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200 -and $r.Content -match 'kline-local-data') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto data_ready

rem A service may already be starting on port 3100. Give it time before treating it as a conflict.
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 goto start_data_service

echo Local data port 3100 is active. Waiting for the service to become ready...
powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(20); do { try { $r = Invoke-WebRequest -Uri '%KLINE_DATA_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'kline-local-data') { exit 0 } } catch {}; Start-Sleep -Milliseconds 700 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>nul
if not errorlevel 1 goto data_ready
goto data_port_conflict

:start_data_service
echo Starting local market data service...
powershell.exe -NoProfile -Command "$p = Start-Process -FilePath 'node.exe' -ArgumentList 'local-data/server.mjs' -WorkingDirectory '%KLINE_WEB_DIR%' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '%KLINE_WEB_DIR%\.local-data\service.pid' -Value $p.Id -Encoding ascii"
if errorlevel 1 goto data_start_error
set "KLINE_DATA_STARTED=1"

powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(30); do { try { $r = Invoke-WebRequest -Uri '%KLINE_DATA_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'kline-local-data') { exit 0 } } catch {}; Start-Sleep -Milliseconds 700 } while ((Get-Date) -lt $deadline); exit 1" >nul 2>nul
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
rem If this application is already running, only open the browser.
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%KLINE_LOCAL_URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'K') { exit 0 } } catch {}; exit 1" >nul 2>nul
if errorlevel 1 goto check_web_port
echo KLine Training Camp is already running. Opening the browser...
start "" "%KLINE_LOCAL_URL%"
exit /b 0

:check_web_port
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 goto start_web
echo [ERROR] Port 3000 is already used by another program.
goto cleanup_and_fatal

:start_web
echo Starting KLine Training Camp...
echo Web:  %KLINE_LOCAL_URL%
echo Data: http://127.0.0.1:3100
echo Close this window or press Ctrl+C to stop the local web service.
echo.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process '%KLINE_LOCAL_URL%'"
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
