# dsh-version-update

**版本与更新**：在设置面板显示 dsh 版本与环境信息，检查 npm 官方最新版本；发现新版本时生成升级提示词，一键复制后交给 DeepSeek 执行升级。

## 功能

- **基本信息**：dsh 版本、安装路径、Node.js 版本、npm 版本、操作系统/架构、数据目录（$DSH_HOME）、上次检查时间
- **检查更新**：手动点击，查询官方 npm registry（`https://registry.npmjs.org/@deepseek-ai/dsh/latest`）的 dist-tag `latest`
  - 已是最新 → 绿色提示
  - 发现新版本 → 黄色提示（当前 vs 最新）+ 升级提示词 + 一键复制
  - 检查失败 → 红色提示（原因）+ 重试
- **升级提示词**：按官方更新方式生成（`npm install -g @deepseek-ai/dsh@latest` + `dsh --version` 验证 + 重启提醒），复制后粘贴给 DSH 里的 agent 即可执行升级
- **版本历史**：查看官方 GitHub Releases 最近 10 个版本的中文摘要（GitHub API，受官方限流影响时给出提示）；点击可跳转完整说明
- **健壮性（v1.1.1）**：npm 查询异步化（不阻塞 Host 事件循环）、所有网络请求带 15s 超时、GitHub 限流（403/429）显示可读提示、复制失败自动回退 `execCommand('copy')`

## 前置条件

- DSH（`dsh` CLI）通过 npm 全局安装，可用 `dsh plugin` 命令
- pnpm 在 PATH 中（`dsh plugin` 依赖）

## 安装（官方流程）

> 官方机制：`dsh plugin --profile <profile名> add <spec>` 把参数转发给 pnpm，安装后自动把声明了 `dsh.bundle.patch` 的包加入 profile 的 bundles 层列表（注册行由插件包自带的 `cordis.patch.yml` 提供，无需手工写行）。

### 发布态（推荐，钉死提交防回退）

```powershell
dsh plugin --profile web add github:Zalpha263/dsh-version-update#<完整40位commit>
```

`<完整40位commit>` 必须是已推送到 GitHub 的提交号（例如 `git ls-remote https://github.com/Zalpha263/dsh-version-update.git main` 输出的 HEAD）。钉死提交后，任何一次 install 都不会回退到旧版本。

### 开发态（本地源码目录依赖）

```powershell
dsh plugin --profile web add file:<你的源码绝对路径>
# 例如：dsh plugin --profile web add file:D:/path/to/dsh-version-update
```

安装后重启 DSH（改过 Host 半区必须重启；仅 Client 改动可 Ctrl+F5）。设置面板出现「版本与更新」页。

## 升级已有版本

> 完整发布流程（改码 → 冒烟 → 推送 → 更新钉死提交 → 重装 → 重启 → 验收）
> 见工作区根目录《DSH-发布SOP.md》流程 A。

```powershell
# 1. 推送新提交到 GitHub：
git push origin main

# 2. 取新提交号（在源码目录内执行）：
git rev-parse HEAD

# 3. 无 BOM 手改 profile 的 package.json 中钉住的提交号：
#    <DSH_HOME>/profiles/<profile名>/package.json
#    （Windows 默认 <DSH_HOME> = %USERPROFILE%\.dsh；无 BOM 保存，可用 PowerShell 7 的 -Encoding utf8）

# 4. 官方入口重装：
dsh plugin --profile web install
# 5. 重启验证
```

## 移除

```powershell
dsh plugin --profile web remove dsh-version-update
# bundles 列表由官方 CLI 自动对账移除；重启 DSH 后生效。
```

## 验证清单

```powershell
# 0. 官方 CLI 自检（手改过 profile 的 package.json 后必做）：
dsh plugin --profile web --help

# 1. 版本号正确（<profile名> 换成你的 profile，如 web）：
(Get-Content "$env:USERPROFILE\.dsh\profiles\<profile名>\node_modules\dsh-version-update\package.json" | Select-String '"version"')

# 2. lockfile 钉住的是期望提交：
Select-String -Path "$env:USERPROFILE\.dsh\profiles\<profile名>\pnpm-lock.yaml" -Pattern 'dsh-version-update@'

# 3. 服务器实际服务的 bundle 是最新（端口按你的实际端口，默认 3080）：
$c = (Invoke-WebRequest http://127.0.0.1:3080/plugins/dsh-version-update/client.js).Content
$c.Contains('vu-prompt')

# 4. 启动 manifest 含包名：
(Invoke-WebRequest http://127.0.0.1:3080/).Content -match 'dsh-version-update'

# 5. 功能抽查：设置 → 版本与更新 → 基本信息 + 检查更新 + 复制按钮
```

## 开发说明

- 源码结构：`lib/index.js`（Host 半，TypertRemoteService + @Remote 标记）、`lib/client.js`（Client 半，`__ModuleLoader__.load` 格式）、`cordis.patch.yml`（注册行）
- Host 半在 Node 环境运行：直接读 `process`/`os`/`fs`/`child_process` 与全局 `fetch`
- 版本/路径发现：优先 `clientModules.clientPath('@deepseek-ai/dsh-web-app')` 推断安装根，fallback `npm root -g`
- 开发态 `file:` 目录依赖下，pnpm 不自动刷新副本：改源码后 `dsh plugin --profile web remove dsh-version-update` + `add` 重新同步（仅 Client 改动可刷新页面生效）
- 诊断：任何一步失败会降级为 null 字段并显示「诊断：」行，方便排查

## 许可

MIT

## 版本历史

- **v1.2.0**：适配 DSH 0.1.2-rc.1——清理 `dsh.client.inject` 中已移除/并入运行时的包名（`dsh-client-runtime`、`dsh-client-ui-slots` 等，模块表对新包名静默跳过但按新契约不应声明）、`dsh-typert-protocol` peer 升至 `^0.1.2-rc.1`（旧 `^0.1.0-rc.7` 按 semver 预发布规则不匹配）；主机与客户端接口逐项与 0.1.2-rc.1 核对通过（clientModules.clientPath / Remote SRC 发现 / settings.section 槽位）；代码去重（`strictCodec` 合并 `passthroughSchema`、抽取共享补零函数），无行为变化。
- **v1.1.2**：修复 Windows 上版本信息读取失败——`npm -v` / `npm root -g` 改经 `cmd.exe`（shell）启动（npm 在 Windows 是 `.cmd` 批处理，`execFile` 无法直接启动，v1.1.1 异步化时引入此回归）；安装目录探测改为三级：`clientModules.clientPath('@deepseek-ai/dsh-client-modules')` 向上定位正在运行的 dsh 包 → 插件模块图 `require.resolve('@deepseek-ai/dsh')` → `npm root -g`（原主路径探测的 `@deepseek-ai/dsh-web-app` 不含 `dsh.client` 声明，从未生效，已替换）；npm 失败结果不再被永久缓存；"检查更新"改用 semver 语义比较，本地版本缺失时显示中性提示（不再误报"发现新版本"）；样式与设置页注册改用 `ctx.effect` 托管（HMR 卸载时正确释放）。
- **v1.1.1**：审计加固——`npm root -g` / `npm -v` 由同步 `execSync` 改为异步 `execFile`（原实现每次打开设置页都会阻塞 Host 事件循环最多 15s）并加进程级缓存；所有 fetch 加 15s 超时（网络黑洞时不再永久停在"检查中"）；GitHub 限流（403/429）显示可读提示；复制提示词失败时回退 `execCommand('copy')` 并有反馈；修正"检查更新"在本地信息加载失败时误报"已是最新"；摘要截断避免切断 UTF-16 代理对。
- **v1.1.0**：新增「版本历史」区块（GitHub Releases 最近 10 个版本中文摘要）。
- **v1.0.0**：初版（版本与环境信息 + npm 更新检查 + 升级提示词复制）。
