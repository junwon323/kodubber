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
if not "%result%"=="0" goto done
echo Chrome에서 개발자 모드를 켜고 탐색기에서 선택된 extension 폴더를 확장 관리 화면으로 끌어다 놓으세요.
start "" explorer.exe /select,"%~dp0extension"
start "" chrome.exe "chrome://extensions/"
:done
pause
exit /b %result%
