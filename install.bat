@echo off
chcp 65001 >nul

:: 检查是否已经是管理员
net session >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    goto :IsAdmin
)

echo 请求管理员权限...
set current_dir=%cd%

:: 在管理员进程中完成所有操作，包括用户指引
powershell -Command "Start-Process cmd -ArgumentList '/k chcp 65001 >nul && echo 正在安装 nodelinks... && cd /d \"%current_dir%\" && npm install -g . && echo ✅ 安装完成！ && echo. && echo 运行欢迎界面... && nodelinks welcome && echo. && echo 使用命令 \"nodelinks help\" 获取更多信息。 && pause' -Verb RunAs"

exit /b

:IsAdmin
echo ✓ 已获得管理员权限
echo 正在安装 nodelinks...
npm install -g .

if %ERRORLEVEL% NEQ 0 (
    echo ❌ 安装失败！
    pause
    exit /b 1
)

echo ✅ 安装完成！
echo.
cd ..
echo 运行欢迎界面...
nodelinks welcome
echo.
echo 使用命令 "nodelinks help" 获取更多信息。
echo.
pause