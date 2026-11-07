@echo off
rem Clarte launcher. Fetches a pinned uv into .tools\ once, then runs tools\clarte.py with it.
setlocal
set "ROOT=%~dp0"
set "UV_VERSION=0.13.7"
rem SHA256 of uv-x86_64-pc-windows-msvc.zip, from its .sha256 file on github.com/astral-sh/uv/releases.
set "SUM=0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021"
set "DIR=%ROOT%.tools\uv\%UV_VERSION%"
set "UV=%DIR%\uv.exe"
if exist "%UV%" goto run
echo clarte: downloading uv %UV_VERSION% for x86_64-pc-windows-msvc 1>&2
if not exist "%DIR%" mkdir "%DIR%"
curl.exe -fsSL "https://github.com/astral-sh/uv/releases/download/%UV_VERSION%/uv-x86_64-pc-windows-msvc.zip" -o "%DIR%\uv.zip" || exit /b 1
set "GOT="
for /f "skip=1 tokens=1" %%H in ('certutil -hashfile "%DIR%\uv.zip" SHA256') do if not defined GOT set "GOT=%%H"
if /i not "%GOT%"=="%SUM%" (
  del "%DIR%\uv.zip"
  echo clarte: uv download failed its SHA256 check 1>&2
  exit /b 1
)
tar.exe -xf "%DIR%\uv.zip" -C "%DIR%" || exit /b 1
del "%DIR%\uv.zip"
:run
set "CLARTE_UV=%UV%"
set "UV_CACHE_DIR=%ROOT%.tools\uv-cache"
set "UV_PYTHON_INSTALL_DIR=%ROOT%.tools\python"
"%UV%" run --no-project --python 3.14 "%ROOT%tools\clarte.py" %*
exit /b %ERRORLEVEL%
