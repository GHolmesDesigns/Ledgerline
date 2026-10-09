@echo off
rem Desktop shortcut target: start Ledgerline if it is not running, then open it in the browser.
rem The window closes on success and stays open, with the reason, if something went wrong.
setlocal
cd /d "%~dp0..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or later, then try again.
  goto :failed
)
if not exist "node_modules" (
  echo Dependencies are not installed. Run "npm install" in %CD% first.
  goto :failed
)
node "tools\desktop-launcher\launch.mjs" %*
if errorlevel 1 goto :failed
exit /b 0
:failed
echo.
pause
exit /b 1
