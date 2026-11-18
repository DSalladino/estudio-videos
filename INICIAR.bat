@echo off
cd /d "%~dp0"
title Estudio de Videos
echo.

if not exist "node_modules" (
  echo Primeira execucao: instalando as dependencias...
  echo.
  call npm install
  echo.
)

echo Abrindo o painel no navegador...
start "" http://127.0.0.1:4321
node src\server.mjs

echo.
echo O painel foi fechado. Aperte uma tecla para sair.
pause >nul
