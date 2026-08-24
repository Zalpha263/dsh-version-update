# dsh-version-update

**版本与更新**：在设置面板显示 dsh 版本与环境信息，检查 npm 官方最新版本；发现新版本时生成升级提示词，一键复制后交给 DeepSeek 执行升级。

## 功能

- **基本信息**：dsh 版本、安装路径、Node.js 版本、npm 版本、操作系统/架构、数据目录（$DSH_HOME）、上次检查时间
- **检查更新**：手动点击，查询官方 npm registry（`https://registry.npmjs.org/@deepseek-ai/dsh/latest`）的 dist-tag `latest`
  - 已是最新 → 绿色提示
  - 发现新版本 → 黄色提示（当前 vs 最新）+ 升级提示词 + 一键复制
  - 检查失败 → 红色提示（原因）+ 重试
- **升级提示词**：按官方更新方式生成（`npm install -g @deepseek-ai/dsh@latest` + `dsh --version` 验证 + 重启提醒），复制后粘贴给 DSH 里的 agent 即可执行升级

## 安装（官方流程）

```powershell
# 开发态（目录依赖，改代码即生效）：
dsh plugin --profile web add file:D:/DeepseekPlugin/dsh-version-update

# 发布态（GitHub 钉死提交，防回退）：
dsh plugin --profile web add github:Zalpha263/dsh-version-update#<完整40位commit>
```

装完重启 DSH（改过 Host 半区必须重启；仅 Client 改动可 Ctrl+F5）。设置面板出现「版本与更新」页。

## 升级已有版本

1. 推送新提交到 GitHub：`git push origin main`
2. 取新提交号：`git -C D:\DeepseekPlugin\dsh-version-update rev-parse HEAD`
3. 无 BOM 手改 profile 的 `package.json` 中钉住的提交号（`C:\Users\ASUS\.dsh\profiles\web\package.json`）
4. `dsh plugin --profile web install` → 重启验证

## 移除

```powershell
dsh plugin --profile web remove dsh-version-update
```

## 验证清单

```powershell
# 1. 版本号正确
(Get-Content "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-version-update\package.json" | Select-String '"version"')

# 2. lockfile 钉住的是期望提交
Select-String -Path "$env:USERPROFILE\.dsh\profiles\web\pnpm-lock.yaml" -Pattern 'dsh-version-update@'

# 3. 服务器实际服务的 bundle 是最新
$c = (Invoke-WebRequest http://127.0.0.1:3080/plugins/dsh-version-update/client.js).Content
$c.Contains('vu-prompt')

# 4. 启动 manifest 含包名
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
