@echo off
chcp 65001 >nul
setlocal
title My3DLobby by BPG - instalacao no Windows
cd /d "%~dp0\.."
set REPO=%CD%
set APPDIR=%LOCALAPPDATA%\My3DLobby
set VENV=%APPDIR%\venv

echo === My3DLobby by BPG - instalacao no Windows ===
echo Pasta do projeto: %REPO%

where py >nul 2>nul && (set PY=py -3) || (where python >nul 2>nul && (set PY=python) || (
  echo Python 3 nao encontrado. Instale em https://www.python.org/downloads/ marcando "Add python.exe to PATH".
  pause & exit /b 1
))
%PY% --version

if not exist "%VENV%\Scripts\python.exe" (
  echo Criando ambiente em %VENV% ...
  %PY% -m venv "%VENV%" || (echo Falha ao criar o ambiente. & pause & exit /b 1)
)
echo Instalando pywebview ...
"%VENV%\Scripts\python.exe" -m pip install --quiet --upgrade pip
"%VENV%\Scripts\python.exe" -m pip install --quiet "pywebview>=5.0" || (echo Falha ao instalar o pywebview. & pause & exit /b 1)

echo.
echo O Hermes roda no Mac. Este notebook vai abrir o escritorio do Mac pela rede.
set /p MACURL=Endereco do Mac (ex.: http://192.168.0.10:4455/) - deixe vazio para rodar o Hermes neste PC:
if not "%MACURL%"=="" (
  > "%REPO%\remote.txt" echo %MACURL%
  echo Endereco salvo em remote.txt
) else (
  if exist "%REPO%\remote.txt" del "%REPO%\remote.txt"
  if not exist "%USERPROFILE%\.my3dlobby.toml" copy "%REPO%\my3dlobby.example.toml" "%USERPROFILE%\.my3dlobby.toml" >nul
)

rem atalho na Area de Trabalho (sem janela preta: pythonw)
set SHORTCUT=%USERPROFILE%\Desktop\My3DLobby.lnk
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%');" ^
  "$s.TargetPath='%VENV%\Scripts\pythonw.exe';" ^
  "$s.Arguments='\"%REPO%\app\my3dlobby_app.py\"';" ^
  "$s.WorkingDirectory='%REPO%';" ^
  "$s.IconLocation='%REPO%\app\icon.ico';" ^
  "$s.Description='My3DLobby by BPG';" ^
  "$s.Save()"

echo.
echo Pronto! Atalho criado na Area de Trabalho: My3DLobby
echo (Requer o Microsoft Edge WebView2, que ja vem no Windows 10/11.)
set /p GO=Abrir agora? (S/n):
if /i not "%GO%"=="n" start "" "%VENV%\Scripts\pythonw.exe" "%REPO%\app\my3dlobby_app.py"
endlocal
