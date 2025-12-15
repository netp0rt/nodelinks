#!/usr/bin/env node
const fs = require('fs/promises');
const fss = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const https = require('https');

// 基础路径配置
const SCRIPT_DIR = __dirname;
const SETTINGS_FILE = path.join(SCRIPT_DIR, 'settings.json');
const REPOS_FILE = path.join(SCRIPT_DIR, 'repos.json');

let VERSION = '1.0.2';
try {
  const pkg = JSON.parse(fss.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf-8'));
  VERSION = pkg.version || VERSION;
} catch {}

/**
 * 初始化必要文件
 */
function initRequiredFiles() {
  if (!fss.existsSync(REPOS_FILE)) {
    const defaultRepos = [
      { name: '淘宝npm镜像', value: 'registry.npmmirror.com', alias: ['npmmirror', 'taobao'] },
      { name: 'npm官方源', value: 'registry.npmjs.org', alias: ['npmjs', 'official'] },
      { name: '腾讯npm镜像', value: 'mirrors.cloud.tencent.com/npm/', alias: ['tencent'] },
      { name: '华为云镜像', value: 'mirrors.huaweicloud.com/repository/npm/', alias: ['huawei'] },
      { name: '自定义地址', value: '', alias: ['custom'] }
    ];
    fss.writeFileSync(REPOS_FILE, JSON.stringify(defaultRepos, null, 2), 'utf-8');
    console.log(`📄 已初始化 ${REPOS_FILE}，默认镜像源列表已创建`);
  }

  if (!fss.existsSync(SETTINGS_FILE)) {
    console.log(`⚠️ 未检测到 ${SETTINGS_FILE}，将进入交互式初始化流程`);
  }
}

initRequiredFiles();

let REPOS = JSON.parse(fss.readFileSync(REPOS_FILE, 'utf-8'));
const REPO_MAP = {};
REPOS.forEach(repo => {
  repo.alias.forEach(alias => {
    REPO_MAP[alias.toLowerCase()] = repo.value;
  });
});

function normalizePath(input) {
  let p = path.resolve(input);
  if (path.basename(p) === 'node_modules') p = path.dirname(p);
  return p;
}

function normalizeRepo(input) {
  if (!input) return REPOS[0].value;
  const repo = REPO_MAP[input.toLowerCase()] || input;
  return repo.startsWith('http') ? repo : repo;
}

async function readJSONFile(path) {
  try {
    const jsonBuf = await fs.readFile(path)
    const jsonStr = jsonBuf.toString()
    return JSON.parse(jsonStr)
  } catch(err) {
    console.error("读取时发生错误："+err)
  }
}

/**
 * 智能判断输入类型并返回目标地址
 */
function smartParseRepoInput(input) {
  if (!input || input.toLowerCase() === 'all') {
    return 'all'; // 测试所有源
  }

  // 检查是否为数字索引
  const index = parseInt(input) - 1;
  if (!isNaN(index) && index >= 0 && index < REPOS.length) {
    return REPOS[index].value || 'custom'; // 返回对应源或标记为自定义
  }

  // 检查是否为别名
  const aliasMatch = REPO_MAP[input.toLowerCase()];
  if (aliasMatch) {
    return aliasMatch;
  }

  // 检查是否为预设源的值
  const repoMatch = REPOS.find(repo => repo.value === input);
  if (repoMatch) {
    return input;
  }

  // 检查是否为URL格式
  if (input.startsWith('http://') || input.startsWith('https://') || 
      input.includes('.') || input.includes(':')) {
    return input; // 直接返回URL
  }

  // 无法识别，返回原输入
  return input;
}

/**
 * 检测是否为危险路径（全局 node_modules 或 nodelinks 自身安装路径）
 */
async function isDangerousPath(p) {
  let normalized = path.resolve(p).toLowerCase();
  if (!normalized.endsWith('node_modules') || !normalized.endsWith('node_modules/')) {
    normalized = path.join(normalized, 'node_modules/')
  }
  return await containsNodelinksInstall(normalized)
}

/**
 * 检测路径是否包含 nodelinks 安装（仅针对非开发环境）
 */
async function containsNodelinksInstall(p) {
  const normalized = path.resolve(p);
  
  try {
    const files = await fs.readdir(normalized, { withFileTypes: true });
    const nodelinksSymlinks = files.filter(file => 
      file.isSymbolicLink() && file.name === 'nodelinks'
    );
    
    console.log('找到的 nodelinks 符号链接:', nodelinksSymlinks.map(f => f.name));
    return nodelinksSymlinks.length > 0;
  } catch (error) {
    console.error(`检查目录失败 ${p}:`, error.message);
    return false;
  }
}

async function loadConfig() {
  initRequiredFiles();

  if (!fss.existsSync(SETTINGS_FILE)) {
    return await initialize();
  }

  try {
    const config = JSON.parse(fss.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (!config.mirrorTimeout) config.mirrorTimeout = 5000;
    if (!config.repo) config.repo = REPOS[0].value;
    if (!config.folderPath) config.folderPath = SCRIPT_DIR;

    if (await isDangerousPath(config.folderPath)) {
      console.error('❌ 检测到危险配置：folderPath 指向了 nodelinks 安装目录！');
      console.error('   这会导致 nodelinks 自身被 npm 删除，造成程序损坏。');
      console.error('   已自动删除配置文件，将重新初始化。');
      fss.unlinkSync(SETTINGS_FILE);
      return await initialize();
    }

    await writeFullSettings(config);
    return config;
  } catch (e) {
    console.error('❌ settings.json 格式错误，将重新初始化:', e.message);
    return await initialize();
  }
}

async function writeFullSettings(config) {
  if (await isDangerousPath(config.folderPath)) {
    console.error('❌ 拒绝保存：配置路径指向 nodelinks 安装目录！');
    process.exit(1);
  }

  const normalizedConfig = {
    folderPath: normalizePath(config.folderPath),
    repo: normalizeRepo(config.repo),
    mirrorTimeout: typeof config.mirrorTimeout === 'number' ? config.mirrorTimeout : 5000
  };
  fss.writeFileSync(SETTINGS_FILE, JSON.stringify(normalizedConfig, null, 2), 'utf-8');
}

/**
 * 新增命令：-trp / testRepo 测试镜像源延迟（支持智能判断）
 */
async function testRepoCommand(repoInput) {
  // 如果没有输入或输入all，测试所有源
  if (!repoInput || repoInput.toLowerCase() === 'all') {
    console.log('🌐 正在测试所有镜像源网络延迟...\n');
    await testAllReposDelay(false);
    return;
  }

  // 智能判断输入类型
  const target = smartParseRepoInput(repoInput);
  
  if (target === 'all') {
    console.log('🌐 正在测试所有镜像源网络延迟...\n');
    await testAllReposDelay(false);
    return;
  }

  if (target === 'custom') {
    console.log('🔧 自定义地址需要具体URL，请直接输入完整地址');
    console.log('   示例: nodelinks -trp https://registry.example.com');
    return;
  }

  console.log(`🌐 正在测试网址：${target}\n`);

  const timeout = (await readJSONFile(SETTINGS_FILE)).mirrorTimeout
  const result = await testSingleRepoDelay(target, timeout);

  console.log(`=== ${result.target} ===`);
  if (result.error) {
    console.log(`❌ 测试失败：${result.error}`);
  } else {
    console.log(`✅ 延迟: ${result.total}ms`);
    
    // 延迟评级
    let rating = '';
    if (result.total < 100) rating = '⚡ 极快';
    else if (result.total < 300) rating = '🚀 快速';
    else if (result.total < 800) rating = '👍 良好';
    else if (result.total < 1500) rating = '⚠️ 一般';
    else rating = '🐌 较慢';
    
    console.log(`🏆 评级: ${rating}`);
  }
  console.log('');
}

/**
 * 测试单个镜像源延迟（简化版：只测 HTTPS 请求，支持自动跟随重定向）
 */
async function testSingleRepoDelay(hostname, timeout = 8000) {
  const result = { 
    target: hostname, 
    total: null, 
    statusCode: null,   // 最终响应状态码
    error: null 
  };

  const start = Date.now();

  try {
    let url = hostname.startsWith('http') ? hostname : `https://${hostname}`;

    // 确保路径至少有 /
    if (!url.endsWith('/')) url += '/';

    await new Promise((resolve, reject) => {
      const req = https.request(url, { 
        method: 'HEAD',  // HEAD 更快，只取头部
        timeout,
        headers: { 'User-Agent': 'Node.js NPM Mirror Test' },
        rejectUnauthorized: false,
        maxRedirects: 20,  // 关键：自动跟随重定向，最多20次
        followRedirect: true  // 虽然 maxRedirects 已包含，但显式写上
      }, res => {
        result.statusCode = res.statusCode;
        res.destroy();  // 不读 body
        resolve();
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时，请求时间超过'+timeout+'ms'));
      });

      req.end();  // 发送请求
    });

    result.total = Date.now() - start;

  } catch (err) {
    result.error = err.message || '网络错误';
  }

  return result;
}

/**
 * 公共延迟测试函数（简化输出，只显示总延迟）
 */
async function testAllReposDelay(isReinit = false) {
  const settingsData = await readJSONFile(SETTINGS_FILE)
  const timeout = settingsData.mirrorTimeout;
  const testTargets = REPOS.filter(repo => repo.value && repo.value !== '').map(repo => repo.value);

  if (!isReinit) {
    console.log('🌐 正在测试镜像源可用性与延迟（支持重定向）...\n');
  }

  const results = await Promise.all(testTargets.map(target => testSingleRepoDelay(target, timeout)));

  let valid = [];

  if (!isReinit) {
    results.forEach(res => {
      console.log(`=== ${res.target} ===`);
      if (res.error) {
        console.log(`❌ 测试失败：${res.error}`);
      } else {
        console.log(`✅ 可用 | 最终状态码: ${res.statusCode} | 总延迟: ${res.total}ms`);
        valid.push(res);
      }
      console.log('');
    });

    // 显示最优推荐（延迟最低的可用源）
    if (valid.length > 0) {
      const best = valid.reduce((a, b) => a.total < b.total ? a : b);
      console.log(`🏆 推荐使用: ${best.target} (延迟: ${best.total}ms)`);
    } else {
      console.log('⚠️ 所有预设源均不可用，请尝试自定义地址');
    }
  } else {
    // 初始化时也计算 valid，用于推荐
    valid = results.filter(res => !res.error && res.total !== null);
  }

  return { results, bestRepo: valid.length > 0 ? valid.reduce((a, b) => a.total < b.total ? a : b).target : REPOS[0].value };
}

/**
 * -crp 命令：测试延迟 → 排序 → 分页显示 → 手动选择（支持智能输入）
 */
async function crpCommand(repoInput) {
  // 支持智能输入，如果指定了源则直接测试该源
  if (repoInput && repoInput.toLowerCase() !== 'all') {
    const target = smartParseRepoInput(repoInput);
    
    if (target !== 'all' && target !== 'custom') {
      console.log(`🔍 正在测试指定源：${target}\n`);
      const result = await testSingleRepoDelay(target);
      
      console.log(`=== ${result.target} ===`);
      if (result.error) {
        console.log(`❌ 访问时发生错误： ${result.error}`);
      } else {
        console.log(`✅ 延迟: ${result.total}ms`);
        
        const confirm = await new Promise(resolve => {
          const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
          rl.question('❓ 是否将镜像源设置为该源？(y/n): ', answer => {
            rl.close();
            resolve(answer.trim().toLowerCase());
          });
        });
        
        if (confirm === 'y') {
          const config = await loadConfig();
          config.repo = target;
          writeFullSettings(config);
          console.log(`✅ 镜像源已成功设置为：${target}`);
        }
      }
      return;
    }
  }

  // 默认行为：测试所有源并交互选择
  const { results } = await testAllReposDelay(false);

  const repoWithDelay = REPOS.filter(repo => repo.value && repo.value !== '').map((repo, i) => ({
    repo,
    delay: results[i]
  }));

  const sorted = repoWithDelay.sort((a, b) => {
    if (!a.delay.error && !b.delay.error) return a.delay.total - b.delay.total;
    if (!a.delay.error) return -1;
    if (!b.delay.error) return 1;
    return 0;
  });

  const customRepo = REPOS.find(r => r.value === '');
  if (customRepo) {
    sorted.push({ repo: customRepo, delay: { error: '自定义地址' } });
  }

  const PAGE_SIZE = 10;
  let page = 0;
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  while (true) {
    console.log('\x1Bc'); // 清屏
    console.log(`📋 镜像源列表（按延迟排序，第 ${page + 1}/${totalPages} 页，共 ${sorted.length} 项）:\n`);

    const start = page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, sorted.length);
    const pageItems = sorted.slice(start, end);

    pageItems.forEach((item, idx) => {
      const globalIdx = start + idx + 1;
      const { repo, delay } = item;
      let status = '';
      if (delay.error && delay.error !== '自定义地址') {
        status = '❌ 测试失败';
      } else if (delay.error === '自定义地址') {
        status = '🔧 自定义地址';
      } else {
        status = `✅ ${delay.total}ms`;
      }
      console.log(`  ${globalIdx.toString().padEnd(2)}. ${repo.name.padEnd(20)} (${repo.value || '自定义'}) ${status}`);
    });

    console.log('\n操作提示：');
    if (totalPages > 1) console.log(`   输入 n 下一页，p 上一页`);
    console.log(`   直接输入数字选择镜像源（1-${sorted.length}），输入q退出`);

    const input = await ask('\n请输入操作：');
    
    if (totalPages > 1) {
      if (input.toLowerCase() === 'n' && page < totalPages - 1) { page++; continue; }
      if (input.toLowerCase() === 'p' && page > 0) { page--; continue; }
    }
    if (input.toLowerCase() === 'q') {
      rl.close();
      return;
    }

    const choice = parseInt(input);
    if (isNaN(choice) || choice < 1 || choice > sorted.length) {
      console.log('⚠️ 输入无效，请重新输入');
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    const selected = sorted[choice - 1];
    let finalRepo = selected.repo.value;

    if (selected.repo.value === '') {
      const customUrl = await ask('请输入自定义npm镜像源地址（回车取消）：');
      if (!customUrl.trim()) {
        console.log('👋 已取消自定义');
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      finalRepo = customUrl.trim();
    }

    console.log(`\n💡 选中镜像源：${selected.repo.name} (${finalRepo})`);

    const confirm = await ask('❓ 是否将镜像源设置为该源？(y/n): ');
    if (confirm.trim().toLowerCase() === 'y') {
      const config = await loadConfig();
      config.repo = finalRepo;
      writeFullSettings(config);
      console.log(`✅ 镜像源已成功设置为：${finalRepo}`);
    } else {
      console.log('👋 已取消设置');
    }

    rl.close();
    return;
  }
}

/**
 * 交互式初始化
 */
async function initialize() {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  console.log('⚙️ 进入配置初始化流程...\n');

  const currentDir = process.cwd();
  const safeDefaultPath = path.join(currentDir, 'node_modules', '.nodelinks_deps');
  
  let folderPath = '';
  
  // 1. 输入并确认统一依赖路径
  while (true) {
    const pathInput = await new Promise(r => rl.question(`请输入统一依赖路径（默认：${safeDefaultPath}，输入 q 退出）: `, input => r(input.trim())));
    
    if (pathInput.toLowerCase() === 'q') {
      console.log('👋 已取消初始化');
      rl.close();
      process.exit(0);
    }
    
    const inputPath = pathInput || safeDefaultPath;
    folderPath = normalizePath(inputPath);
    
    if (await isDangerousPath(folderPath)) {
      console.log('❌ 错误：路径指向了 nodelinks 的全局安装目录！');
      console.log(`\n当前路径：${folderPath}`);
      console.log('请重新输入安全的路径，或输入 q 退出。\n');
      continue;
    }
    
    const confirm = await new Promise(r => rl.question(`\n❓ 确认使用路径 ${folderPath}？(y/n): `, answer => r(answer.trim().toLowerCase())));
    if (confirm === 'y') {
      break;
    } else {
      console.log('\n重新输入路径...\n');
    }
  }
  
  // 2. 创建依赖目录
  if (!fss.existsSync(folderPath)) {
    fss.mkdirSync(folderPath, { recursive: true });
  }

  // 3. 先写入一个临时的默认配置（关键修复！避免后续读取失败）
  const tempConfig = {
    folderPath: folderPath,
    repo: REPOS[0].value,  // 先用默认淘宝源占位
    mirrorTimeout: 5000
  };
  fss.writeFileSync(SETTINGS_FILE, JSON.stringify(tempConfig, null, 2), 'utf-8');

  // 4. 现在安全地测试镜像源（因为 settings.json 已存在）
  console.log('\n🔍 正在测试镜像源网络延迟，请稍候...');
  const { results, bestRepo } = await testAllReposDelay(true);

  // 5. 显示源列表并选择
  console.log('\n请选择npm镜像源（输入数字索引）：');
  REPOS.forEach((repo, index) => {
    if (repo.value === '') {
      console.log(`  ${index + 1}. ${repo.name} (自定义)`);
    } else {
      const delayResult = results.find(res => res.target === repo.value);
      const delayStr = delayResult && !delayResult.error ? `[延迟：${delayResult.total}ms]` : '[测试失败]';
      console.log(`  ${index + 1}. ${repo.name} (${repo.value}) ${delayStr}`);
    }
  });

  const defaultIndex = REPOS.findIndex(r => r.value === bestRepo) + 1 || 1;
  const indexInput = await new Promise(r => rl.question(`请输入索引（默认推荐：${defaultIndex}）: `, input => r(input.trim() || defaultIndex.toString())));

  let selectedRepo = bestRepo;
  const index = parseInt(indexInput) - 1;
  if (index >= 0 && index < REPOS.length - 1) {
    selectedRepo = REPOS[index].value;
  } else if (index === REPOS.length - 1) {
    selectedRepo = await new Promise(r => rl.question('请输入自定义镜像源地址（建议带 https://）: ', input => r(input.trim())));
    if (!selectedRepo) selectedRepo = bestRepo;
  }

  // 6. 最终写入完整配置
  const finalConfig = {
    folderPath,
    repo: normalizeRepo(selectedRepo),
    mirrorTimeout: 5000
  };
  await writeFullSettings(finalConfig);  // 使用 await，确保写入完成

  console.log('\n✅ 配置初始化完成！');
  console.log(`   统一依赖路径：${folderPath}`);
  console.log(`   npm镜像源：${finalConfig.repo}`);

  rl.close();
  return finalConfig;
}

/* npm 操作函数 */
function autoInitDepsFolder(config) {
  const depsDir = config.folderPath;
  const nodeMods = path.join(depsDir, 'node_modules');
  const pkgJson = path.join(depsDir, 'package.json');

  if (fss.existsSync(nodeMods)) return true;

  if (!fss.existsSync(depsDir)) {
    fss.mkdirSync(depsDir, { recursive: true });
  }

  if (!fss.existsSync(pkgJson)) {
    const result = spawnSync('npm', ['init', '-y', '--registry', `https://${config.repo}`], { cwd: depsDir, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
      console.error('❌ package.json 创建失败');
      process.exit(1);
    }
  }

  return true;
}

async function runNpmWithSafetyCheck(args, config) {
  if (await containsNodelinksInstall(config.folderPath)) {
    console.error('❌ 严重错误：目标目录包含 nodelinks 全局安装！');
    console.error('   请修改配置的 folderPath 为其他目录。');
    process.exit(1);
  }
  
  autoInitDepsFolder(config);

  const cwd = config.folderPath;
  const repoUrl = config.repo.startsWith('http') ? config.repo : `https://${config.repo}`;
  const npmArgs = [...args];
  if (['install', 'uninstall', 'ci'].includes(npmArgs[0])) {
    npmArgs.push('--registry', repoUrl);
  }

  console.log(`🔧 执行: npm ${npmArgs.join(' ')} （统一目录: ${cwd}）`);

  const child = spawn('npm', npmArgs, { cwd, stdio: 'inherit', shell: true });

  child.on('close', code => {
    if (code === 0) {
      console.log('✅ npm 操作完成');
    } else {
      console.error(`❌ npm 操作失败，退出码: ${code}`);
    }
  });
  
  return child;
}

function npmList(cwd) {
  const child = spawn('npm', ['list', '--json', '--depth=0'], { cwd, stdio: ['ignore', 'pipe', 'inherit'], shell: true });
  let out = '';
  child.stdout.on('data', chunk => out += chunk);
  child.on('close', () => {
    try {
      const data = JSON.parse(out);
      const deps = Object.keys(data.dependencies || {}).sort();
      if (deps.length === 0) {
        console.log('📦 当前无顶级依赖');
        return;
      }
      console.log('📦 已安装顶级模块：');
      deps.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));
    } catch {
      console.log('📦 无法解析依赖列表');
    }
  });
}

async function createJunction() {
  const runPath = process.cwd();
  
  try {
    // 读取设置文件
    const settings = await readJSONFile(SETTINGS_FILE);
    
    if (!settings || !settings.folderPath) {
      throw new Error('设置文件中未找到 folderPath 配置');
    }
    
    let sourcePath = settings.folderPath;
    
    // 检测并处理 node_modules 路径
    if (!sourcePath.endsWith('node_modules')) {
      sourcePath = path.join(sourcePath, 'node_modules');
    }
    
    // 检查源路径是否存在
    try {
      await fs.access(sourcePath);
    } catch (error) {
      throw new Error(`源路径不存在: ${sourcePath}`);
    }
    
    // 目标链接路径
    const targetLinkPath = path.join(runPath, 'node_modules');
    
    // 检查目标路径是否已存在
    try {
      const stats = await fs.lstat(targetLinkPath);
      
      if (stats.isSymbolicLink()) {
        console.log('✅ 符号链接已存在，跳过创建');
        return targetLinkPath;
      } else {
        throw new Error(`目标路径已存在但不是符号链接: ${targetLinkPath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // 文件不存在，继续创建
    }
    
    // 创建符号链接（Windows 使用 junction）
    const isWindows = process.platform === 'win32';
    const linkType = isWindows ? 'junction' : 'dir';
    
    await fs.symlink(sourcePath, targetLinkPath, linkType);
    
    console.log(`✅ 符号链接创建成功:`);
    console.log(`   源路径: ${sourcePath}`);
    console.log(`   目标链接: ${targetLinkPath}`);
    console.log(`   链接类型: ${linkType}`);
    
    return targetLinkPath;
    
  } catch (error) {
    console.error('❌ 创建符号链接失败:', error.message);
    throw error;
  }
}

async function delJunction() {
  const runPath = process.cwd();
  
  try {
    // 目标链接路径
    const targetLinkPath = path.join(runPath, 'node_modules');
    
    // 检查目标路径是否存在
    try {
      const stats = await fs.lstat(targetLinkPath);
      
      if (stats.isSymbolicLink()) {
        // 删除符号链接
        await fs.unlink(targetLinkPath);
        console.log(`✅ 符号链接删除成功: ${targetLinkPath}`);
        return targetLinkPath;
      } else {
        throw new Error(`目标路径存在但不是符号链接，无法删除: ${targetLinkPath}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('ℹ️ 符号链接不存在，无需删除');
        return null;
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    console.error('❌ 删除符号链接失败:', error.message);
    throw error;
  }
}

function setRepo(repoInput) {
  if (!repoInput) {
    console.error('❌ 缺少镜像源参数');
    console.log("💡 输入 nodelinks setRepo -h 查看详细帮助")
    process.exit(1);
  }
  const config = JSON.parse(fss.readFileSync(SETTINGS_FILE, 'utf-8'));
  let newRepo = normalizeRepo(repoInput);
  const index = parseInt(repoInput) - 1;
  if (!isNaN(index) && index >= 0 && index < REPOS.length - 1) {
    newRepo = REPOS[index].value;
  }
  config.repo = newRepo;
  writeFullSettings(config);
  console.log(`✅ 镜像源已更新为：${newRepo}`);
}

function removeSettings() {
  if (fss.existsSync(SETTINGS_FILE)) {
    fss.unlinkSync(SETTINGS_FILE);
    console.log('🗑️ settings.json 已删除');
  } else {
    console.log('ℹ️ settings.json 不存在');
  }
}

function showVersion() {
  console.log(`📦 nodelinks v${VERSION}`);
}

function showWelcome() {
  console.log(`📦 nodelinks v${VERSION}\n`);
  console.log('nodeLinks 已安装完毕！请使用 "nodelinks -h" 查看帮助。');
}

function showHelp() {
  console.log(`
🎯 nodelinks — npm 镜像与依赖管理工具（v${VERSION}）

用法: nodelinks [命令]

配置管理:
  -h, --help, help           显示帮助信息
  -v, --version, version     显示版本信息
  welcome                    显示安装欢迎信息
  show                       查看当前配置信息
  -rs, removeSettings        删除配置文件
  reinit                     重新初始化配置

镜像源测试与选择:
  -trp [target]              测试镜像源延迟（默认测试所有源）
  setRepo                    手动指定设置镜像源
  -crp [target]              测试并交互选择镜像源（默认测试所有源）

  [target]:
      alias                  使用repos.json中的alias别名
      url                    直接使用url
      index                  使用repos.json中的repo索引（从1开始）

符号链接管理:
  create                      在当前目录创建 node_modules 符号链接
  del                         删除当前目录的 node_modules 符号链接

npm 包管理命令:
  install <pkg...>           安装包到统一目录
  -i <pkg...>                快捷安装（等同于 install）
  uninstall <pkg...>         从统一依赖目录卸载包
  -ui <pkg...>               快捷卸载（等同于 uninstall）
  reinstall <pkg...>         重装包
  -ri <pkg...>               快捷重装（等同于 reinstall）
  list                       查看统一目录的顶级依赖列表
  -l                         快捷查看列表（等同于 list）
`);
}

/**
 * 显示指定子命令的帮助信息
 */
function showSubCommandHelp(command) {
  const helps = {
    install: `
📦 install / -i  — 安装包到统一依赖目录

用法:
  nodelinks install <package1> [package2...]    安装一个或多个包
  nodelinks -i <package1> [package2...]         快捷安装

示例:
  nodelinks install express lodash
  nodelinks -i vue@3 react

注意:
  • 所有包都会安装到配置的统一目录（settings.json 中的 folderPath）
  • 自动使用配置的 npm 镜像源
  • 支持版本指定，如 vue@3.4.0
`,

    uninstall: `
🗑️ uninstall / -ui  — 从统一依赖目录卸载包

用法:
  nodelinks uninstall <package1> [package2...]
  nodelinks -ui <package1> [package2...]

示例:
  nodelinks uninstall lodash
  nodelinks -ui express axios
`,

    reinstall: `
🔄 reinstall / -ri  — 重装包（先卸载后安装）

用法:
  nodelinks reinstall <package1> [package2...]
  nodelinks -ri <package1> [package2...]

示例:
  nodelinks reinstall vue
  nodelinks -ri react redux
`,

    list: `
📋 list / -l  — 查看统一目录已安装的顶级依赖

用法:
  nodelinks list
  nodelinks -l

说明:
  显示当前统一依赖目录中所有顶级模块（按字母排序）
`,

    setRepo: `
🔧 setRepo  — 手动设置 npm 镜像源

用法:
  nodelinks setRepo <source>

<source> 支持:
  • 数字索引（如 1、2、3）
  • 别名（如 taobao、tencent、npmjs）
  • 完整地址（如 registry.npmmirror.com）
  • 带协议的 URL（如 https://registry.example.com）

示例:
  nodelinks setRepo taobao
  nodelinks setRepo 1
  nodelinks setRepo https://registry.npmjs.org
`,

    '-trp': `
🌐 -trp  — 测试镜像源延迟

用法:
  nodelinks -trp [target]

[target] 可选:
  • 不写或 all   → 测试所有预设源
  • 数字（如 1） → 测试对应索引的源
  • 别名（如 taobao）
  • 完整地址或 URL

示例:
  nodelinks -trp
  nodelinks -trp taobao
  nodelinks -trp https://registry.example.com
`,

    '-crp': `
⚙️ -crp  — 测试并交互选择最优镜像源（推荐）

用法:
  nodelinks -crp [target]

功能:
  • 测试所有源延迟并按速度排序
  • 支持分页浏览
  • 可直接选择并保存为当前镜像源
  • 支持输入 q 退出

示例:
  nodelinks -crp          # 测试所有源并交互选择
  nodelinks -crp 2        # 直接测试第2个源并询问是否切换
`,

    create: `
🔗 create  — 在当前目录创建 node_modules 符号链接

用法:
  nodelinks create

功能:
  • 读取 settings.json 中的 folderPath 配置
  • 自动检测并添加 node_modules 路径
  • 在当前目录创建指向统一依赖目录的符号链接
  • 支持 Windows junction 和 Unix 符号链接

示例:
  nodelinks create

注意:
  • 需要先完成初始化配置（nodelinks reinit）
  • 如果符号链接已存在会跳过创建
`,

    del: `
🗑️ del  — 删除当前目录的 node_modules 符号链接

用法:
  nodelinks del

功能:
  • 删除当前目录的 node_modules 符号链接
  • 仅删除符号链接，不影响实际文件
  • 如果符号链接不存在会提示无需删除

示例:
  nodelinks del

注意:
  • 仅删除符号链接，统一依赖目录中的包不会被删除
  • 删除后需要重新运行 nodelinks create 恢复链接
`,
    removeSettings: `
🗑️ removeSettings / -rs  — 删除配置文件

用法:
  nodelinks removeSettings
  nodelinks -rs

功能:
  • 删除 settings.json 配置文件
  • 删除后下次运行命令会重新进入初始化流程

示例:
  nodelinks removeSettings
  nodelinks -rs

注意:
  • 此操作不可逆，请谨慎使用
  • 仅删除配置文件，不会删除已安装的包
`
  };

  if (helps[command]) {
    console.log(helps[command].trim());
  } else {
    console.log(`ℹ️ 暂无 "${command}" 命令的详细帮助，可使用 nodelinks -h 查看主帮助`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let cmd = args[0] || '';

  const alias = {
    '-h': 'help', '--help': 'help',
    '-v': 'version', '--version': 'version',
    '-crp': 'changeRepo', '--changeRepo': 'changeRepo',
    '-trp': 'testRepo', '--testRepo': 'testRepo',
    '-rs': 'removeSettings',
    '-i': 'install', '-ui': 'uninstall', '-ri': 'reinstall', '-l': 'list'
  };
  
  // 检查是否有帮助请求（优先级最高）
  const hasHelp = args.some(arg => arg === '-h' || arg === '--help');
  if (hasHelp) {
    // 如果有帮助参数，优先显示帮助
    if (alias[cmd]) cmd = alias[cmd];
    
    if (cmd === 'testRepo') {
      showSubCommandHelp('-trp');
      return;
    }
    if (cmd === 'changeRepo') {
      showSubCommandHelp('-crp');
      return;
    }
    if (cmd === 'setRepo') {
      showSubCommandHelp('setRepo');
      return;
    }
    if (cmd === 'create') {
      showSubCommandHelp('create');
      return;
    }
    if (cmd === 'del') {
      showSubCommandHelp('del');
      return;
    }
    if (cmd === 'removeSettings') {
      showSubCommandHelp('removeSettings');
      return;
    }
    
    // 对于 npm 命令的帮助
    const npmCommands = ['install', 'uninstall', 'reinstall', 'list'];
    if (npmCommands.includes(cmd)) {
      showSubCommandHelp(cmd);
      return;
    }
    
    // 默认显示主帮助
    showHelp();
    return;
  }

  // 如果没有帮助请求，才正常处理命令别名
  if (alias[cmd]) cmd = alias[cmd];

  if (cmd === 'welcome') {
    showWelcome();
    return;
  }

  // 处理 testRepo 命令
  if (cmd === 'testRepo') {
    const repoInput = args[1];
    await testRepoCommand(repoInput);
    return;
  }

  // 处理 changeRepo 命令
  if (cmd === 'changeRepo') {
    const repoInput = args[1];
    await crpCommand(repoInput);
    return;
  }

  const npmCommands = ['install', 'uninstall', 'reinstall', 'list'];
  if (npmCommands.includes(cmd)) {
    const config = await loadConfig();
    const pkgs = args.slice(1);

    if (cmd !== 'list' && pkgs.length === 0) {
      console.error(`❌ 缺少包名，用法: nodelinks ${cmd} <package1> [package2...]`);
      console.log(`💡 输入 nodelinks ${cmd} -h 查看详细帮助`);
      process.exit(1);
    }

    switch (cmd) {
      case 'install':
        await runNpmWithSafetyCheck(['install', ...pkgs], config);
        break;
      case 'uninstall':
        await runNpmWithSafetyCheck(['uninstall', ...pkgs], config);
        break;
      case 'reinstall':
        const uninstallChild = await runNpmWithSafetyCheck(['uninstall', ...pkgs], config);
        uninstallChild.on('close', () => {
          setTimeout(() => runNpmWithSafetyCheck(['install', ...pkgs], config), 1000);
        });
        break;
      case 'list':
        npmList(config.folderPath);
        break;
    }
    return;
  }

  switch (cmd) {
    case 'help': case '': 
      showHelp(); 
      return;
    case 'version': 
      showVersion(); 
      return;
    case 'show':
      const config = await loadConfig();
      console.log('📁 当前配置:');
      console.log(JSON.stringify(config, null, 2));
      return;
    case 'setRepo': 
      const sourceArg = args[1];
      setRepo(sourceArg);
      return;
    case 'reinit': 
      await initialize(); 
      return;
    case 'removeSettings': 
      removeSettings(); 
      return;
    case 'create':
      await createJunction();
      return;
    case 'del':
      await delJunction();
      return;
    default:
      console.error(`❌ 未知命令: ${cmd}`);
      console.log('💡 使用 "nodelinks -h" 查看帮助信息');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 未捕获错误:', err.message || err);
  process.exit(1);
});