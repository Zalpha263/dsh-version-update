# dsh-version-update

在 DSH 设置页集中显示版本与环境信息，检查 npm 上的官方最新版，并生成一段可以直接交给 agent 执行的升级提示词。

## 能做什么

入口：**设置 → 版本与更新**。

- **基本信息**：一屏列出版本（dsh / Node.js / npm）、安装路径、操作系统与架构、数据目录（`$DSH_HOME`）和上次检查时间，排查环境问题很方便。
- **检查更新**：点一下按钮查询官方 registry 的 `latest` 标签。已是最新给绿色提示；有新版本给黄色提示（当前版本与最新版本并列）并生成升级提示词；检查失败给红色提示和原因，可以重试。
- **升级提示词**：按官方方式生成 —— `npm install -g @deepseek-ai/dsh@<精确版本>`，再用 `dsh --version` 验证并提醒重启。复制后粘贴给 DSH 里的 agent 就能执行。固定用精确版本号而不是 `@latest`，避免 latest 指向旧发行线时静默降级。
- **版本历史**：读取官方 GitHub Releases 最近 10 个版本的中文摘要，点击可跳转完整说明；被限流时给可读提示，不会一直转圈。
- **健壮性**：npm 查询是异步的（不阻塞 Host），所有网络请求 15 秒超时，GitHub 403 / 429 显示限流提示，复制失败自动回退到 `execCommand('copy')`。

## 安装

要求：dsh 已通过 npm 全局安装、能用 `dsh plugin`，并且 [pnpm](https://pnpm.io/zh/) 在 PATH 中。

```bash
# 发布态：钉死提交，任何一次 install 都不会回退到旧版本
dsh plugin --profile web add github:Zalpha263/dsh-version-update#<40位commit>

# 开发态：裸目录路径 = link:（源码即部署，改完不用重装）
dsh plugin --profile web add D:/path/to/dsh-version-update

# 卸载
dsh plugin --profile web remove dsh-version-update
```

装完**重启 DSH**（Host 半区需要加载；只改界面可以 Ctrl+F5），设置里就会出现「版本与更新」。

## 常见问题

| 问题 | 原因与解决 |
| --- | --- |
| 页面显示「获取失败」或版本「未知」 | 点「检查更新」重试；仍失败看页面上的「诊断：」行 |
| 检查更新提示限流 | GitHub 对未登录请求有频率限制，等一会儿再试 |
| 复制按钮没反应 | 浏览器在非安全上下文会禁用剪贴板 API；本机 localhost 通常可用，失败时会自动选中文本供手动复制 |
| 显示「已是最新」但版本号看着旧 | 本地版本高于 npm latest 标签时会这样，属正常 |

## 开发者

- `lib/index.js` —— Host 半区，`TypertRemoteService` + `@Remote` 标记，注册 `versionUpdate` 服务（`info` / `checkUpdate` / `releases`）。
- `lib/client.js` —— Client 半区，`__ModuleLoader__.load` 格式，注册设置页的「版本与更新」入口。
- `cordis.patch.yml` —— bundle 层注册行。

版本与安装路径发现分三级：`clientModules.clientPath('@deepseek-ai/dsh-client-modules')` → 插件模块图的 `require.resolve('@deepseek-ai/dsh')` → `npm root -g`。任何一步失败都会降级为 `null` 并显示「诊断：」行。改完源码：Host 重启 DSH，Client 刷新页面，无需构建。

## 更新日志

### v1.2.2
- peer 依赖对齐 `@deepseek-ai/dsh-typert-protocol ^0.1.5-rc.2`；已复核 0.1.2-rc.1 → 0.1.5-rc.2 期间本插件没有需要适配的接口变更。

### v1.2.1
- 升级提示词改用检查到的精确版本号，不再用 `@latest`，避免静默降级到旧发行线；本地版本高于 npm 标签时，「已是最新」不再显示更旧的数字。

### v1.2.0 及更早
- **v1.2.0**：适配 DSH 0.1.2-rc.1；清理已移除的依赖声明、逐项核对主/客户端接口、去重。
- **v1.1.2**：Windows 上 npm 命令改经 shell 启动（npm 是 `.cmd`）；安装目录探测改三级回退；npm 失败结果不再被永久缓存；版本比较改用 semver。
- **v1.1.1**：npm 查询改异步 + 进程级缓存；网络请求加 15 秒超时；GitHub 限流给可读提示；复制失败回退 `execCommand('copy')`。
- **v1.1.0**：新增版本历史区块（GitHub Releases 最近 10 个版本的中文摘要）。
- **v1.0.0**：初版（版本与环境信息 + npm 更新检查 + 升级提示词复制）。

## License

MIT
