# dsh-version-update

**版本与更新**：在设置面板显示 dsh 版本与环境信息，检查 npm 官方最新版本；发现新版本时生成升级提示词，一键复制后交给 DeepSeek 执行升级。

## 功能

- **基本信息**：dsh 版本、安装路径、Node.js 版本、npm 版本、操作系统/架构、数据目录（$DSH_HOME）、上次检查时间
- **检查更新**：手动点击，查询官方 npm registry（`https://registry.npmjs.org/@deepseek-ai/dsh/latest`）的 dist-tag `latest`
  - 已是最新 → 绿色提示
  - 发现新版本 → 黄色提示（当前 vs 最新）+ 升级提示词 + 一键复制
  - 检查失败 → 红色提示（原因）+ 重试
- **升级提示词**：按官方更新方式生成（`npm install -g @deepseek-ai/dsh@latest` + `dsh --version` 验证 + 重启提醒），复制后粘贴给 DSH 里的 agent 即可执行升级

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
