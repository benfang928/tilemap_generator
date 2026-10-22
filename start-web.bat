@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found. Install Node.js and try again.
    pause
    exit /b 1
)

set "URL=http://127.0.0.1:5173"
start "MapGenerator Web Server" cmd /k "cd /d ""%~dp0"" && node server\dev-server.mjs"

set /a attempts=0
:wait_for_server
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 goto open_browser

set /a attempts+=1
if %attempts% geq 30 goto startup_failed
timeout /t 1 /nobreak >nul
goto wait_for_server

:open_browser
start "" "%URL%"
exit /b 0

:startup_failed
echo The web server did not respond at %URL%.
echo Check the server window for errors.
pause
exit /b 1
