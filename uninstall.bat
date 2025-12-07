@echo off
chcp 65001 >nul

:: 检查是否已经是管理员
net session >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    goto :IsAdmin
)

echo 请求管理员权限以卸载 nodelinks...
set "current_dir=%cd%"

:: 使用 PowerShell 启动管理员权限的 cmd，并执行卸载
powershell -Command "Start-Process cmd -ArgumentList '/k cd /d \"%current_dir%\" && echo 正在卸载 nodelinks... && npm uninstall -g nodelinks && echo. && echo ✅ 已卸载完成！ && echo 注意：如果仍有残留，请手动删除快捷方式或检查 PATH。 && pause && exit /b 1' -Verb RunAs"

exit /b

:IsAdmin
echo ✓ 已获得管理员权限
echo 正在卸载 nodelinks...

:: 执行卸载
npm uninstall -g nodelinks

if %ERRORLEVEL% NEQ 0 (
    echo ❌ 卸载失败！可能已卸载或未正确安装。
    echo      请检查是否拼写正确，或尝试重启终端。
) else (
    echo.
    echo ✅ nodelinks 已成功卸载！
)

echo.
echo 卸载完成，按任意键退出...
pause >nul
exit /b