#!/usr/bin/env node
// nodelinks.js

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 获取当前 nodelinks.js 所在目录（用于读写配置和文件）
const SCRIPT_DIR = path.dirname(fs.realpathSync(__filename));
// 设置配置文件路径：同级目录下的 settings.json
const SETTINGS_FILE = path.join(SCRIPT_DIR, 'settings.json');

// 尝试从 package.json 读取版本号
let VERSION = '1.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf-8'));
  VERSION = pkg.version || '1.0.0';
} catch (err) {
  // 如果读不到版本号，使用默认值
}

// 规范化路径：将相对路径转为绝对路径，并移除末尾的 node_modules
function normalizePath(input) {
  let resolved = path.resolve(input);
  if (path.basename(resolved) === 'node_modules') {
    resolved = path.dirname(resolved); // 确保指向父目录
  }
  return resolved;
}

// 初始化配置：用户首次运行时引导设置目标路径
async function initialize() {
  const { createInterface } = require('readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('⚙️  settings.json not found. Running initialization...\n');
  return new Promise((resolve) => {
    rl.question('请输入目标文件夹路径（将在此目录用于存储module模块，^def改为默认路径）: ', (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        console.error('❌ 路径不能为空！');
        process.exit(1);
      }
      let finalPath;

      if (trimmed === '^def') {
        console.log("使用脚本运行时为目标项目目录。")
        finalPath = process.cwd();
      }
      else {
        finalPath = normalizePath(trimmed);
      }
      const settings = { folderPath: finalPath };

      try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
        console.log(`\n✅ 配置已保存到 ${SETTINGS_FILE}`);
        console.log(`   目标项目目录: ${finalPath}`);
      } catch (err) {
        console.error('❌ 写入失败:', err.message);
        process.exit(1);
      }

      rl.close();
      resolve(settings);
    });
  });
}

// 更新 settings.json 文件
function writeSettings(folderPath) {
  const finalPath = normalizePath(folderPath);
  const settings = { folderPath: finalPath };
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`✅ 配置已更新: ${finalPath}`);
  } catch (err) {
    console.error('❌ 写入失败:', err.message);
    process.exit(1);
  }
}

// 加载配置，若无则自动初始化
async function loadConfig() {
  if (fs.existsSync(SETTINGS_FILE)) {
    const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    try {
      return JSON.parse(content);
    } catch (err) {
      console.error('❌ settings.json 格式错误，请检查是否为合法 JSON。');
      throw err;
    }
  } else {
    return await initialize(); // 不存在则触发初始化
  }
}

// 删除 settings.json
function removeSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    fs.unlinkSync(SETTINGS_FILE);
    console.log('🗑️  已删除 settings.json');
  } else {
    console.log('ℹ️  settings.json 不存在，无需删除。');
  }
}

// 显示版本号
function showVersion() {
  console.log(`📦 nodelinks v${VERSION}`);
}

// 安装完成后欢迎信息（用于 install.bat）
function showResult() {
  console.log(`📦 nodelinks v${VERSION}`);
  console.log("nodeLinks已安装完毕，请使用 'nodelinks help' 查看帮助信息。");
}

// 显示当前配置
function showConfig() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    console.log('ℹ️  未找到 settings.json，请先运行初始化。');
    return;
  }

  const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
  try {
    const config = JSON.parse(content);
    console.log('📁 当前配置:');
    console.log(`  folderPath: ${config.folderPath}`);
  } catch (err) {
    console.error('❌ 配置文件损坏:', err.message);
  }
}

// 执行 npm 命令（如 install/remove）
function runNpm(args, targetDir) {
  console.log(`🔧 正在执行: npm ${args.join(' ')} (in ${targetDir})`);

  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      console.log(`📂 创建目录: ${targetDir}`);
    } catch (err) {
      console.error('❌ 无法创建目录:', err.message);
      process.exit(1);
    }
  }

  const child = spawn('npm', args, {
    cwd: targetDir,
    stdio: 'inherit',
    shell: true,
    windowsVerbatimArguments: false
  });

  child.on('close', (code) => {
    if (code !== 0 && code !== 1) {
      console.error(`❌ npm 命令失败，退出码: ${code}`);
      process.exit(code);
    }
  });
}

// 使用 npm list --json 获取一级已安装模块
function npmList(targetDir) {
  console.log('🔍 正在获取已安装的一级模块...');

  return new Promise((resolve) => {
    const child = spawn('npm', ['list', '--json', '--depth=0'], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ npm list 命令执行失败');
        if (errorOutput) {
          console.error('错误信息:', errorOutput);
        }
        return resolve();
      }

      try {
        // 清理输出，只取有效的 JSON 部分
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.log('📦 当前无已安装模块或输出格式异常');
          return resolve();
        }

        const result = JSON.parse(jsonMatch[0]);
        
        if (!result.dependencies || Object.keys(result.dependencies).length === 0) {
          console.log('📦 当前无一级已安装模块');
          return resolve();
        }

        // 过滤出真正的包名（排除无效项）
        const validPackages = Object.keys(result.dependencies).filter(pkgName => {
          // 排除看起来像文件/目录的无效包名
          return !pkgName.includes('/') && 
                 !pkgName.startsWith('.') && 
                 pkgName !== 'node_modules' &&
                 !pkgName.endsWith('.json') &&
                 !pkgName.endsWith('.log');
        }).sort();

        if (validPackages.length === 0) {
          console.log('📦 未找到有效的已安装模块');
          return resolve();
        }

        console.log('📦 已安装模块列表（顶级包）:');
        validPackages.forEach((name, i) => {
          const version = result.dependencies[name].version;
          console.log(`  ${i + 1}. ${name}@${version}`);
        });

      } catch (err) {
        console.error('❌ 解析 npm list 输出失败:', err.message);
        console.log('原始输出预览:', output.substring(0, 200) + '...');
      }
      
      resolve();
    });
  });
}

// 判断是否是 Windows junction
function hasJunctionFlag(stat) {
  try {
    fs.readlinkSync(path.join(process.cwd(), 'node_modules'));
    return false;
  } catch (err) {
    return err.code === 'EINVAL'; // Windows 特有错误码
  }
}

// 删除当前目录的 node_modules junction 链接
function deleteJunction() {
  const linkDir = path.join(process.cwd(), 'node_modules');
  
  console.log(`🔍 检查路径: ${linkDir}`);
  console.log(`🗑️  路径是否存在: ${fs.existsSync(linkDir)}`);

  try {
    // 使用 lstat 而不是 exists 来检测符号链接
    const stat = fs.lstatSync(linkDir);
    console.log(`📁 检测到目录，类型:`, {
      isDirectory: stat.isDirectory(),
      isSymbolicLink: stat.isSymbolicLink(),
      isFile: stat.isFile()
    });

    console.log(`🗑️  正在删除: ${linkDir}`);
    
    // 尝试多种删除方法
    if (stat.isSymbolicLink()) {
      // 方法1: 删除符号链接
      fs.unlinkSync(linkDir);
      console.log('✅ 符号链接删除成功');
    } else if (stat.isDirectory()) {
      // 方法2: 删除目录
      fs.rmSync(linkDir, { recursive: true, force: true });
      console.log('✅ 目录删除成功');
    } else {
      // 方法3: 删除文件
      fs.unlinkSync(linkDir);
      console.log('✅ 文件删除成功');
    }
    
    // 验证删除结果
    if (!fs.existsSync(linkDir)) {
      console.log('✅ 删除验证成功');
    } else {
      console.log('⚠️  删除后路径仍然存在，尝试强制删除');
      // 最终尝试: 使用命令行
      const { execSync } = require('child_process');
      try {
        execSync(`rmdir /s /q "${linkDir}"`, { stdio: 'ignore' });
        console.log('✅ 命令行强制删除成功');
      } catch (cmdErr) {
        console.error('❌ 所有删除方法都失败');
      }
    }
    
  } catch (err) {
    console.error(`❌ 删除失败:`, err.message);
    console.log('💡 尝试使用命令行删除...');
    
    // 使用命令行强制删除
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        // Windows
        execSync(`rmdir /s /q "${linkDir}"`, { stdio: 'ignore' });
      } else {
        // Linux/Mac
        execSync(`rm -rf "${linkDir}"`, { stdio: 'ignore' });
      }
      console.log('✅ 命令行删除成功');
    } catch (cmdErr) {
      console.error('❌ 命令行删除也失败，请手动删除:');
      console.error(`手动删除命令: rmdir /s /q "${linkDir}"`);
    }
  }
}

// 创建 junction 链接到共享 node_modules
function createJunction(config) {
  const targetNodeModules = path.join(config.folderPath, 'node_modules');
  const linkDir = path.join(process.cwd(), 'node_modules');

  if (!fs.existsSync(targetNodeModules)) {
    console.error(`❌ 目标 node_modules 不存在: ${targetNodeModules}`);
    console.error('请先运行 "nodelinks install xxx" 或确保该目录已安装依赖。');
    process.exit(1);
  }

  // 如果目标路径已存在，强制删除
  if (fs.existsSync(linkDir)) {
    try {
      console.log(`🗑️  删除现有目录: ${linkDir}`);
      
      // 使用更强大的删除方法
      if (fs.lstatSync(linkDir).isSymbolicLink()) {
        // 如果是符号链接，直接删除
        fs.unlinkSync(linkDir);
      } else {
        // 如果是目录，递归删除
        fs.rmSync(linkDir, { recursive: true, force: true, maxRetries: 3 });
      }
      console.log('✓ 现有目录已删除');
    } catch (err) {
      console.error(`❌ 无法删除现有目录: ${err.message}`);
      console.error('💡 请手动删除 node_modules 文件夹或关闭所有编辑器后重试');
      process.exit(1);
    }
  }

  console.log(`🔗 创建链接: ${linkDir} → ${targetNodeModules}`);

  // 使用更安全的方式创建链接
  try {
    // 方法1: 使用 Node.js 的 fs.symlink（推荐）
    fs.symlinkSync(targetNodeModules, linkDir, 'junction');
    console.log(`✅ 符号链接创建成功！`);
  } catch (err) {
    // 方法1失败，尝试方法2: 使用 mklink 命令
    console.log('尝试使用 mklink 命令创建链接...');
    const child = spawn('cmd', ['/c', 'mklink', '/J', linkDir, targetNodeModules], {
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ 符号链接创建成功！`);
      } else {
        console.error(`❌ 创建链接失败，错误码: ${code}`);
        console.error('可能的原因:');
        console.error('1. 权限不足 - 请以管理员身份运行终端');
        console.error('2. 文件被占用 - 关闭所有编辑器后重试');
        console.error('3. 防病毒软件阻止 - 临时禁用防病毒软件');
        process.exit(code);
      }
    });
  }
}

// 显示帮助菜单
function showHelp() {
  console.log(`
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
    nodelinks create               # 创建 node_modules junction
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
`);
}

// 异步提问函数（用于交互式输入）
function question(prompt) {
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(prompt, ans => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });
}

// 主程序入口
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  console.log("Running command: nodelinks " + args.join(" "));

  // ------------------------------
  // 快捷命令处理：-i, -rm, -ri, -l, -rms, -v, -h
  // ------------------------------
  if (cmd?.startsWith('-')) {
    const config = await loadConfig();
    const targetDir = config.folderPath;
    const packageNames = args.slice(1);

    switch (cmd) {
      case '-i':
        if (packageNames.length === 0) {
          console.error('❌ 缺少模块名: nodelinks -i <pkg> [pkg...]');
          process.exit(1);
        }
        console.log(`🔧 执行命令: npm install ${packageNames.join(' ')}`);
        runNpm(['install', ...packageNames], targetDir);
        return;

      case '-rm':
        if (packageNames.length === 0) {
          console.error('❌ 缺少模块名: nodelinks -rm <pkg> [pkg...]');
          process.exit(1);
        }
        console.log(`🔧 执行命令: npm remove ${packageNames.join(' ')}`);
        runNpm(['remove', ...packageNames], targetDir);
        return;

      case '-ri':
        if (packageNames.length === 0) {
          console.error('❌ 缺少模块名: nodelinks -ri <pkg> [pkg...]');
          process.exit(1);
        }
        console.log(`🔧 执行命令: npm reinstall ${packageNames.join(' ')}`);
        runNpm(['remove', ...packageNames], targetDir);
        setTimeout(() => {
          runNpm(['install', ...packageNames], targetDir);
        }, 500);
        return;

      case '-l':
        await npmList(targetDir);
        return;

      case '-rms':
        removeSettings();
        return;

      case '-v':
        showVersion();
        return;

      case '-h':
        showHelp();
        return;

      default:
        console.error('❌ 未知快捷命令。使用 nodelinks help 查看帮助。');
        process.exit(1);
    }
  }

  // ------------------------------
  // 主命令分发
  // ------------------------------

  if (!cmd || ['help', '--help'].includes(cmd)) {
    showHelp();
    return;
  }

  if (cmd === 'version' || cmd === '-v') {
    showVersion();
    return;
  }

  if (cmd === 'welcome') {
    showResult();
    return;
  }

  if (cmd === 'show') {
    showConfig();
    return;
  }

  if (cmd === 'removeSettings' || cmd === 'rms') {
    removeSettings();
    return;
  }

  // ------------------------------
  // 包管理命令：install, remove, reinstall, list
  // ------------------------------
  if (['install', 'remove', 'reinstall', 'list'].includes(cmd)) {
    const config = await loadConfig();
    const targetDir = config.folderPath;
    const packageNames = args.slice(1);

    if (cmd === 'install') {
      if (packageNames.length === 0) {
        console.error('❌ 缺少模块名: nodelinks install <pkg> [pkg...]');
        process.exit(1);
      }
      console.log(`🔧 安装模块: ${packageNames.join(' ')}`);
      runNpm(['install', ...packageNames], targetDir);
    } else if (cmd === 'remove') {
      if (packageNames.length === 0) {
        console.error('❌ 缺少模块名: nodelinks remove <pkg> [pkg...]');
        process.exit(1);
      }
      console.log(`🔧 卸载模块: ${packageNames.join(' ')}`);
      runNpm(['remove', ...packageNames], targetDir);
    } else if (cmd === 'reinstall') {
      if (packageNames.length === 0) {
        console.error('❌ 缺少模块名: nodelinks reinstall <pkg> [pkg...]');
        process.exit(1);
      }
      console.log(`🔧 重装模块: ${packageNames.join(' ')}`);
      runNpm(['remove', ...packageNames], targetDir);
      setTimeout(() => {
        runNpm(['install', ...packageNames], targetDir);
      }, 500);
    } else if (cmd === 'list') {
      await npmList(targetDir);
    }
    return;
  }

  // ------------------------------
  // 重置项目目录（只保留核心文件）
  // ------------------------------
  if (cmd === 'reset') {
    const projectDir = SCRIPT_DIR;
    const keepFiles = [
      'package.json',
      'nodelinks.js',
      'install.bat',
      'uninstall.bat',
      'readme.md'
    ];

    console.log('🔄 正在重置 nodelinks 项目环境...');
    console.log(`📁 保留文件: ${keepFiles.join(', ')}`);
    console.log();

    // 询问用户确认
    const answer = await question('⚠️  确认要删除其他所有文件吗？(y/yes/n/no): ');
    if (!['y', 'yes'].includes(answer)) {
      console.log('👋 已取消重置操作');
      return;
    }

    try {
      const files = fs.readdirSync(projectDir);
      let removedCount = 0;

      for (const file of files) {
        if (keepFiles.includes(file)) continue;

        const fullPath = path.join(projectDir, file);
        try {
          const stat = fs.lstatSync(fullPath);
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`🗑️  删除目录: ${file}`);
          } else {
            fs.unlinkSync(fullPath);
            console.log(`🗑️  删除文件: ${file}`);
          }
          removedCount++;
        } catch (err) {
          console.error(`❌ 无法删除 ${file}: ${err.message}`);
        }
      }

      if (removedCount === 0) {
        console.log('✅ 当前目录已干净，无需清理。');
      } else {
        console.log(`✅ 清理完成！共移除 ${removedCount} 项`);
      }
      console.log(`💡 提示：可重新运行 install.bat 安装或初始化`);
    } catch (err) {
      console.error('❌ 清理过程中发生错误:', err.message);
      process.exit(1);
    }

    return;
  }

  if (cmd === 'reinit') {
    const newPath = args[1];
    if (newPath) {
      writeSettings(newPath);
    } else {
      if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
      await initialize();
    }
    return;
  }

  if (cmd === 'create') {
    const config = await loadConfig();
    createJunction(config);
    return;
  }

  if (cmd === 'del') {
    deleteJunction();
    return;
  }

  // 默认行为：显示欢迎信息和参数
  const config = await loadConfig();
  console.log('\n🎉 Welcome to nodelinks!');
  console.log('Default Path (from settings):', config.folderPath);
  console.log('You provided the following arguments:');
  if (args.length === 0) {
    console.log('  (none)');
  } else {
    args.forEach((arg, i) => console.log(`  ${i + 1}: ${arg}`));
  }
}

// 启动主流程
main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});