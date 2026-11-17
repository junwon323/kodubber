@echo off
setlocal
chcp 65001 >nul
set "arch=%PROCESSOR_ARCHITECTURE%"
if defined PROCESSOR_ARCHITEW6432 set "arch=%PROCESSOR_ARCHITEW6432%"
if /i "%arch%"=="AMD64" goto install
if /i "%arch%"=="ARM64" goto install
echo Windows x64 or ARM64 is required.
pause
exit /b 1
:install
"%~dp0bin\host-windows-%arch%.exe" install
set "result=%errorlevel%"
pause
exit /b %result%
