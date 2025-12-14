# 🛠 nodelinks - 共享 node_modules 管理工具

一个轻量级 CLI 工具，用于统一管理多个项目的 `node_modules`，支持软链、批量安装、快速重置。

## 🎯 功能亮点

- ✅ 全局统一安装 npm 包
- ✅ 在当前项目创建 `node_modules` junction 链接
- ✅ 支持快捷命令：`-i`, `-rm`, `-l`
- ✅ 一键重置项目目录
- ✅ 中文友好提示

## 📦 安装

```bash
cd F:\codes\nodeLink
npm install -g .
```
或`双击运行 install.bat（自动提权安装）`

🧰 常用命令
# 显示帮助
nodelinks help

# 安装模块
nodelinks -i express lodash

# 卸载模块
nodelinks -rm lodash

# 查看已安装
nodelinks -l

# 创建软链（在任意项目中）
nodelinks create

# 删除软链
nodelinks del

💬 卸载
双击运行 uninstall.bat，或手动执行：
```bash
npm uninstall -g nodelinks
```