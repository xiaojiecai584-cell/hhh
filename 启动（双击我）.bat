@echo off
chcp 65001 >nul
title Lindoway 上位机（Web 端）
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有找到 Node.js。请先安装 Node.js 20 或更高版本：
  echo   https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo.
  echo   没有找到 dist\index.html。
  echo   请先在本目录执行：npm ci   然后   npm run build
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动本地服务，浏览器会自动打开...
echo   关闭这个窗口即可停止服务。
echo.
node serve-dist.mjs
pause
