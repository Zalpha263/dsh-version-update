# dsh-version-update

> 在 DSH 的设置面板里集中显示版本与环境信息，检查 npm 上的官方最新版本，并在发现新版本时生成一段可以直接交给 agent 执行的升级提示词。

## 它做什么

**基本信息**：一屏列出 dsh 版本、安装路径、Node.js 与 npm 版本、操作系统与架构、数据目录（`$DSH_HOME`）以及上次检查时间，排查环境问题时会比较省事。

**检查更新**：点一下按钮就查询官方 npm registry（`https://registry.npmjs.org/@deepseek-ai/dsh/latest`）的 `latest` 标签，已是最新时给绿色提示，发现新版本时给黄色提示（当前版本与最新版本并列）并生成升级提示词，检查失败则显示红色提示与原因，可以重试。

**升级提示词**：提示词按官方更新方式生成——`npm install -g @deepseek-ai/dsh@<精确目标版本>`，随后用 `dsh --version` 验证并提醒重启；v1.2.1 起固定使用检查到的精确版本号而不再用 `@latest`，避免 npm 的 latest 标签指向旧发行线时静默降级。复制后粘贴给 DSH 里的 agent 即可执行升级。

**版本历史**：读取官方 GitHub Releases 最近 10 个版本的中文摘要，点击可以跳转到完整说明；受官方限流影响时会给出可读提示而不是一直转圈。

**健壮性**：npm 查询是异步的（不会阻塞 Host 事件循环），所有网络请求带 15 秒超时，GitHub 返回 403 / 429 时显示限流提示，复制失败会自动回退到 `execCommand('copy')` 并给出反馈。

## 前置条件

DSH（`dsh` CLI）通过 npm 全局安装、可以使用 `dsh plugin` 命令，并且 [pnpm](https://pnpm.io/zh/) 在 PATH 中（`dsh plugin` 依赖它）。

## 安装

官方机制是 `dsh plugin --profile <profile名> add <spec>`：参数转发给 pnpm，安装后自动把声明了 `dsh.bundle.patch` 的包加入 profile 的 bundles 列表，注册行由插件包自带的 `cordis.patch.yml` 提供，无需手工填写。

```bash
# 发布态（推荐：钉死提交，任何一次 install 都不会回退到旧版本）
dsh plugin --profile web add github:Zalpha263/dsh-version-update#<完整40位commit>

# 开发态（本地源码目录）
dsh plugin --profile web add file:<你的源码绝对路径>

# 移除
dsh plugin --profile web remove dsh-version-update
```

`<完整40位commit>` 必须是已经推送到 GitHub 的提交号（例如 `git ls-remote https://github.com/Zalpha263/dsh-version-update.git main` 输出的 HEAD）。装完**重启 DSH**（Host 半区需要加载，仅 Client 改动可以 Ctrl+F5），设置面板里就会出现「版本与更新」页。

## 升级已有版本

推送新提交后，把 profile 的 `package.json`（`<DSH_HOME>/profiles/<profile名>/package.json`，Windows 默认 `<DSH_HOME>` 是 `%USERPROFILE%\.dsh`）里钉住的提交号改成新提交（无 BOM 保存），然后执行 `dsh plugin --profile web install` 并重启验证。

## 验证

```powershell
# 1. 官方 CLI 自检（手改过 profile 的 package.json 后必做）
dsh plugin --profile web --help

# 2. 安装的版本号是否正确
(Get-Content "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-version-update\package.json" | Select-String '"version"')

# 3. 服务器实际服务的 bundle 是否为最新
(Invoke-WebRequest http://127.0.0.1:3080/plugins/dsh-version-update/client.js).Content.Contains('vu-prompt')

# 4. 启动 manifest 是否包含本包
(Invoke-WebRequest http://127.0.0.1:3080/).Content -match 'dsh-version-update'

# 5. 功能抽查：设置 → 版本与更新 → 基本信息 + 检查更新 + 复制按钮
```

## 开发者

源码结构是 `lib/index.js`（Host 半区，`TypertRemoteService` 加 `@Remote` 标记）、`lib/client.js`（Client 半区，`__ModuleLoader__.load` 格式）与 `cordis.patch.yml`（注册行）。Host 半区运行在 Node 环境，直接使用 `process` / `os` / `fs` / `child_process` 与全局 `fetch`；版本与路径发现优先用 `clientModules.clientPath('@deepseek-ai/dsh-client-modules')` 向上定位正在运行的 dsh 包，其次用插件模块图 `require.resolve('@deepseek-ai/dsh')`，最后回退到 `npm root -g`。开发态下 pnpm 不会自动刷新 `file:` 副本，改完源码要 `remove` + `add` 重新同步（仅 Client 改动可以直接刷新页面）。任何一步失败都会降级为 `null` 字段并显示「诊断：」行，便于排查。

## 更新日志

### v1.2.1
- 修复：升级提示词改用检查到的精确版本号，不再用 `@latest`，避免静默降级到旧发行线。
- 修复：本地版本高于 npm 标签时，「已是最新」不再显示更旧的数字。

### v1.2.0
- 变更：适配 DSH 0.1.2-rc.1 —— 清理已移除的依赖声明、peer 依赖升到 `^0.1.2-rc.1`、主机与客户端接口逐项核对、代码去重。

### v1.1.2
- 修复：Windows 上 npm 命令改经 shell 启动（`npm` 是 `.cmd` 批处理）；安装目录探测改为三级回退；npm 失败结果不再被永久缓存；版本比较改用 semver 语义。

### v1.1.1
- 变更：npm 查询由同步改为异步并加进程级缓存，所有网络请求加 15 秒超时，GitHub 限流给出可读提示，复制失败回退 `execCommand('copy')`。

### v1.1.0
- 新增：版本历史区块（GitHub Releases 最近 10 个版本的中文摘要）。

### v1.0.0
- 初版：版本与环境信息 + npm 更新检查 + 升级提示词复制。

## License

MIT
