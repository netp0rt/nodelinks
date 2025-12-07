# 🛠 nodelinks - 共享 node_modules 管理工具

🎯 nodelinks CLI 工具 — 统一管理 node_modules

📌 用法:
  nodelinks [command]

📚 命令列表:

  📦 包管理命令（统一安装位置）
    nodelinks install <pkg...>     # 安装模块
    nodelinks remove <pkg...>       # 卸载模块  
    nodelinks reinstall <pkg...>   # 重装模块
    nodelinks list                 # 查看已安装模块

  ⚙️  配置管理
    nodelinks show                 # 查看当前配置
    nodelinks removeSettings       # 删除 settings.json
    nodelinks reinit [path]        # 重新初始化/设置新路径

  🖇️  符号链接管理
    nodelinks create               # 在当前目录下链接init的 node_modules 地址
    nodelinks del                  # 删除当前 node_modules 链接

  🔧 系统命令
    nodelinks help                 # 显示帮助
    nodelinks version              # 显示版本
    nodelinks welcome              # 显示欢迎信息
    nodelinks reset                # 重置项目目录（仅保留核心文件）

  ⌨️  快捷方式
    nodelinks -i <pkg...>    = install 多个包
    nodelinks -rm <pkg...>   = remove 多个包
    nodelinks -ri <pkg...>   = reinstall 多个包
    nodelinks -l             = list
    nodelinks -rms          = removeSettings
    nodelinks -v             = version
    nodelinks -h             = help

💡 示例:
  nodelinks install express uuid lodash
  nodelinks -i express uuid lodash
  nodelinks remove uuid lodash
  nodelinks -rm uuid lodash
  nodelinks create
  nodelinks del
  nodelinks reset
`
