# dsh-version-update

在 DSH 设置页集中显示版本与环境信息，**分渠道**检查 npm 上的官方正式版与 Alpha 预览版，并生成一段可以直接交给 agent 执行的升级提示词。

## 能做什么

入口：**设置 → 版本与更新**。

- **基本信息**：一屏列出版本（dsh / Node.js / npm）、**当前渠道**（官方正式版 / Alpha 预览版）、安装路径、操作系统与架构、数据目录（`$DSH_HOME`）和上次检查时间。
- **检查更新**：点一次按钮，**同时查询两个渠道**：
  - **官方正式版** —— npm 的 `latest` 标签；
  - **Alpha 预览版** —— npm 的 `alpha` 标签。
  两个渠道各自显示最新版本号、与本机版本的对比结果，以及**各自可复制的升级提示词**。任一渠道查询失败只影响自己（就地显示原因并可重试），不会连带另一个渠道。
- **升级提示词**：按官方方式生成 —— `npm install -g @deepseek-ai/dsh@<精确版本>`，再用 `dsh --version` 验证并提醒重启。固定用精确版本号而不是 `@latest`/`@alpha`，避免 dist-tag 漂移导致静默装到别的版本甚至降级。
  - **正式版提示词**：升级步骤 + 精确版本 + 回退命令，并说明升级只替换全局包、不动 `$DSH_HOME`。
  - **Alpha 提示词**：额外包含「这是官方开发者预览通道（GitHub Release 标记为 pre-release，可能破坏兼容）」的风险说明、备份 `$DSH_HOME` 的建议、从正式版线路切换过来的明确提示，以及回退到正式版的命令。
- **版本历史**：读取官方 GitHub Releases 最近 10 个版本的中文摘要，每条标注**渠道标签**（正式版 / Alpha），可按渠道筛选；点击可跳转完整说明。
- **健壮性**：npm 查询是异步的（不阻塞 Host），所有网络请求 15 秒超时，GitHub 403 / 429 显示限流提示，复制失败自动回退到 `execCommand('copy')`。

## 渠道与版本判定

「装了 Alpha 算不算最新版」这类问题由下面的规则回答，界面就是照它渲染的：

| 本机渠道 | 检查渠道 | 结果 |
| --- | --- | --- |
| 官方正式版 | 官方正式版 | 目标更高 → 发现新版本；相同 → 已是最新；目标更低 → 已领先 |
| 官方正式版 | Alpha 预览版 | 目标更高 → 发现 Alpha 预览版（含风险提示） |
| Alpha 预览版 | Alpha 预览版 | 按语义化版本正常判定「发现新 Alpha 预览版 / 已是最新 / 已领先」 |
| Alpha 预览版 | 官方正式版 | **绝不提示降级**：正式版更旧（含同版本线的 rc）时只显示中性说明「本机运行的是 Alpha，切回正式版属于降级操作」；只有正式线发布了**更高版本号**时，才提示「可切换回正式版线路」并给出覆盖安装提示词 |

补充说明：

- **`rc` 属于正式版渠道** —— 目前 npm 的 `latest` 标签本身就是 `0.1.5-rc.2` 这样的候选版本，只有带 `alpha` 标识的版本才归入 Alpha 渠道。
- **覆盖安装**：`npm install -g @deepseek-ai/dsh@<版本>` 永远覆盖同一个全局包，不存在并行安装。所以每条提示词都要求 agent 先记录「升级前版本 + 渠道」，失败时用它回退；从 Alpha 切回正式版会在界面上明确标注为降级/回退操作。
- 本机版本未知或无法解析时，两个渠道都只显示中性提示，不会误报「已是最新」或「发现新版本」。
- **Alpha 没有 GitHub 产物**：官方 Alpha 的可执行分发渠道就是 npm（GitHub Release 只有更新说明、assets 为空），因此 Alpha 的安装方式同样是官方命令 + 精确版本号。

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
| 某个渠道显示查询失败 | 只有那个渠道的请求失败（网络或标签不存在），点该渠道的「重试」；另一个渠道不受影响 |
| 检查更新提示限流 | GitHub 对未登录请求有频率限制，等一会儿再试 |
| 复制按钮没反应 | 浏览器在非安全上下文会禁用剪贴板 API；本机 localhost 通常可用，失败时会自动选中文本供手动复制 |
| 显示「已是最新」但版本号看着旧 | 本地版本高于该渠道标签时会这样（例如自己装的构建比公开版新），属正常 |
| 装了 Alpha，正式版却提示旧版本 | 正常：正式版渠道更旧时只给中性说明，不提供降级提示词 |

## 开发者

- `lib/index.js` —— Host 半区，`TypertRemoteService` + 手工 `@Remote` 标记，注册 `versionUpdate` 服务：
  - `info` —— 本地版本 / 安装路径 / Node / npm / 平台 / 数据目录 + 诊断；
  - `checkChannels` —— **一次并发查询 `latest` 与 `alpha` 两个 dist-tag**，返回 `{ checkedAt, channels: { stable, alpha } }`，每个渠道自带 `version` 或 `error`；
  - `checkUpdate` —— 只查 `latest` 的旧接口，**为兼容可能被缓存的旧客户端 bundle 而保留**，新界面不再使用；
  - `releases` —— 官方 GitHub Releases 摘要。
- `lib/client.js` —— Client 半区，`__ModuleLoader__.load` 格式，注册设置页入口；两个渠道块共用 `channelView()` 的渲染结果，界面里不重复判定逻辑。
- `lib/version.js` —— 纯函数（语义化版本比较、渠道识别、判定、提示词模板），**可单测的那一份**。
- `test/version.test.mjs` —— `npm test`（即 `node test/version.test.mjs`）；包含行为断言与**漂移守卫**。

> **为什么纯函数写了两份？** DSH 的客户端模块表按包只注册一个工厂，运行时	extbf{无法} `require("./version.js")`（ESM import 在这个经典脚本里也是语法错误），所以逻辑必须内联在 `lib/client.js`；`lib/version.js` 是可测试的副本。测试会把 `client.js` 中 `__VERSION_BEGIN__` / `__VERSION_END__` 之间的区域抽出来与新文件逐行比对，两边不同步就会**测试失败**。改逻辑时请同时改两处内联区域。

版本与安装路径发现分三级：`clientModules.clientPath('@deepseek-ai/dsh-client-modules')` → 插件模块图的 `require.resolve('@deepseek-ai/dsh')` → `npm root -g`。任何一步失败都会降级为 `null` 并显示「诊断：」行。改完源码：Host 重启 DSH，Client 刷新页面，无需构建。

## 更新日志

### v1.3.0
- 「检查更新」拆分为**官方正式版（latest）与 Alpha 预览版（alpha）双渠道**，一次检查同时给出两个渠道的版本、状态与各自的升级提示词；新增 `checkChannels` 远程方法（`checkUpdate` 保留兼容），单渠道失败互不影响。
- 「基本信息」新增「当前渠道」；新增渠道感知的判定规则：**Alpha 用户不会被提示降级**，只有正式线发布更高版本号时才提供切回正式版的覆盖安装提示词。
- 「版本历史」每条加渠道标签并支持按渠道筛选。
- 新增 `lib/version.js` 与 `test/version.test.mjs`（含内联逻辑的漂移守卫）。

### v1.2.2 及更早
- **v1.2.2**：peer 依赖对齐 `@deepseek-ai/dsh-typert-protocol ^0.1.5-rc.2`；复核 0.1.2-rc.1 → 0.1.5-rc.2 无接口变更。
- **v1.2.1**：升级提示词改用检查到的精确版本号，不再用 `@latest`，避免静默降级；本地版本更高时不再显示更旧的数字。
- **v1.2.0**：适配 DSH 0.1.2-rc.1；清理已移除的依赖声明、逐项核对主/客户端接口、去重。
- **v1.1.2**：Windows 上 npm 命令改经 shell 启动；安装目录探测改三级回退；npm 失败结果不再被永久缓存；版本比较改用 semver。
- **v1.1.1**：npm 查询改异步 + 进程级缓存；网络请求加 15 秒超时；GitHub 限流给可读提示；复制失败回退 `execCommand('copy')`。
- **v1.1.0**：新增版本历史区块（GitHub Releases 最近 10 个版本的中文摘要）。
- **v1.0.0**：初版（版本与环境信息 + npm 更新检查 + 升级提示词复制）。

## License

MIT
