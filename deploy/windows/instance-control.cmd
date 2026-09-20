@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0instance-control.ps1" %*
set "CONTROL_EXIT=%ERRORLEVEL%"
if not "%CONTROL_EXIT%"=="0" pause
exit /b %CONTROL_EXIT%
