# dsh-version-update

在 DSH 设置页集中显示版本与环境信息，**分渠道**检查 npm 上的官方正式版与 Alpha 预览版，并生成一段可以直接交给 agent 执行的升级提示词。

## 能做什么

入口：**设置 → 版本与更新**。

- **基本信息**：一屏列出版本（dsh / Node.js / npm）、**当前渠道**（官方正式版 / Alpha 预览版）、安装路径与**探测来源**（桌面应用 / CLI 等，决定提示词里的更新方式）、操作系统与架构、数据目录（`$DSH_HOME`）和上次检查时间。
- **检查更新**：点一次按钮，**同时查询两个渠道**：
  - **官方正式版** —— npm 上**所有正式版标签（`latest`、`next` 等）中版本最高者**；
  - **Alpha 预览版** —— npm 的 `alpha` 标签（同样按「属于该渠道的最高版本」判定）。
  两个渠道各自显示最新版本号、与本机版本的对比结果；可给出提示词时各自提供可复制内容。任一渠道查询失败只影响自己（就地显示原因并可重试），不会连带另一个渠道。
  - 正式版块会额外显示**版本来源**（例如「该版本取自 npm 的 `next` 标签；`latest` 标签当前为 v0.1.5-rc.3」），因为 `latest` 只是标签之一，不等于整条正式版线。
  - **只要本机在 Alpha 线上，正式版块一定可操作**：正式版更高时给「升级/切回正式版线路」提示词，正式版更低时给「切回正式版」的回退提示词，不会既不给提示词也不说清原因。
- **升级提示词**：按**实际安装来源**生成，不再默认所有环境都用 npm：
  - **命令行 / npm 全局安装**：官方方式 —— `npm install -g @deepseek-ai/dsh@<精确版本>`，再用 `dsh --version` 验证并提醒彻底重启 `dsh web`。固定用精确版本号而不是 `@latest`/`@alpha`，避免 dist-tag 漂移导致静默装到别的版本甚至降级。
  - **桌面应用（`desktop` profile）**：提示在**桌面应用内更新** —— 应用菜单打开「检查更新…」，按提示下载并重启应用；如果应用内暂时没有目标版本，就等待桌面壳发布对应版本。验证以应用内「设置 → 版本与更新」显示的版本为准（不是命令行的 `dsh --version`）。提示词**不再**让你 `npm install -g` 后重启 `dsh web`：桌面运行时打包在 `app.asar` 内，npm 全局安装只改命令行 CLI，不会更新正在运行的桌面应用。
  - **来源未知**（探测不到安装目录、或 `info()` 失败）：两条路径都列出并逐条标注适用场景，由你按实际运行方式二选一，插件不猜。
  - **正式版提示词**：升级步骤 + 精确版本 + 回退方式（npm 回退命令 / 对应版本的桌面安装包）。
  - **Alpha 提示词**：额外包含一句中文风险说明（官方开发者预览通道、可能有破坏兼容性的变更）、从正式版线路切换过来的明确提示，以及回退到正式版的路径。**不含备份 `$DSH_HOME` 的步骤**（覆盖安装/桌面更新都不写 `$DSH_HOME`，提示词末尾已写明），也**不堆 npm/GitHub 术语**（`dist-tag`、`pre-release`）和「不适合生产环境」的劝阻句。
- **版本历史**：读取官方 GitHub Releases 最近 10 个版本的中文摘要，每条标注**渠道标签**（正式版 / Alpha），可按渠道筛选；点击可跳转完整说明。
- **健壮性**：npm 查询是异步的（不阻塞 Host），所有网络请求 15 秒超时，GitHub 403 / 429 显示限流提示，复制失败自动回退到 `execCommand('copy')`。

## 渠道与版本判定

「装了 Alpha 算不算最新版」这类问题由下面的规则回答，界面就是照它渲染的：

**总原则（正式版块）：只要查到了版本号，正式版块就一定给出可复制的提示词；版本高低只决定文案，不决定「能不能下载」。** 没有提示词的情况只有两种：渠道查询失败、根本没有版本号可钉；或 **Alpha 块遇到本机版本无法判断**（安装 Alpha 属高风险动作，不在无法判断时诱导执行）。

| 本机渠道 | 检查渠道 | 结果 |
| --- | --- | --- |
| 官方正式版 | 官方正式版 | 目标更高 → 「发现新版本」+ 升级提示词；相同 → 已是最新；目标更低 → 「已领先渠道」+ **切回渠道版本**提示词 |
| 官方正式版 | Alpha 预览版 | 目标更高 → 发现 Alpha 预览版（含风险提示）；其余 → 中性说明 |
| Alpha 预览版 | Alpha 预览版 | 按语义化版本正常判定「发现新 Alpha 预览版 / 已是最新 / 已领先」 |
| Alpha 预览版 | 官方正式版 | 目标**高于**当前 Alpha（更新的 rc、正式版或更高版本线）→ 「可切回正式版线路（属于升级）」+ 升级提示词；目标**低于**当前 Alpha → 标注为回退 + 「切回正式版」提示词。两种情况下 Alpha 用户都随时能回到正式版线路 |
| 本机版本未知 / 无法解析 | 官方正式版 | 不猜方向：中性「切换到官方正式版 vX」提示词，并要求 agent 先记录当前版本便于回退（CLI 用 `dsh --version`，桌面看应用内「设置 → 版本与更新」） |
| 本机版本未知 / 无法解析 | Alpha 预览版 | 中性说明，不给提示词（安装 Alpha 是高风险动作，不在无法判断时诱导执行） |
| 任意 | 渠道查询失败 | 就地显示失败原因 + 重试，不给提示词（没有版本号可钉） |

补充说明：

- **`rc` 属于正式版渠道** —— 带 `alpha` 标识的版本才归入 Alpha 渠道，其余（含 `0.1.7-rc.1` 这类候选版）都算正式版线。注意 npm 的 `latest` 标签**不等于**整条正式版线：预览周期里 `latest` 可能仍停在上一代（如 `0.1.5-rc.3`），而下一代正式版已作为 `next`（如 `0.1.7-rc.1`）发布 —— 所以本插件按「所有正式版标签中版本最高者」判定，与「版本历史」看到的口径一致。
- **覆盖安装（CLI / npm 全局）**：`npm install -g @deepseek-ai/dsh@<版本>` 永远覆盖同一个全局包，不存在并行安装。所以每条提示词都要求 agent 先记录「升级前版本 + 渠道」，失败时用它回退；从 Alpha 切回正式版会在界面上明确标注是升级还是降级/回退。**桌面应用不适用这条**：桌面运行时在 `app.asar` 内，由桌面壳整体替换，npm 全局安装碰不到它。
- **「版本未知」不再等于「不能操作」**：本机版本识别不出来时，正式版块仍给出中性提示词（钉住具体版本号），只是不声称这是升级还是回退。
- **Alpha 没有 GitHub 产物**：官方 Alpha 的可执行分发渠道就是 npm（GitHub Release 只有更新说明、assets 为空），因此 CLI 的 Alpha 安装方式同样是官方命令 + 精确版本号；桌面版 Alpha 则由桌面壳的更新通道提供，提示词会说明等待应用内通道。
- **桌面与 CLI 是两套更新通道**：同一台机器上可能同时存在 npm 全局 CLI 和桌面应用，二者版本可以不同。面板会显示「探测来源」（`pluginPackages` / `clientModules` / `desktopApp` / `require` / `npmRoot`），提示词只针对探测到的那个安装树。

## 安装来源与更新方式

`info()` 同时返回 `installSource`（哪个探针命中）与 `installEnvironment`（`desktop` / `cli`）。提示词按安装环境选择更新方式：

| installEnvironment | 判定依据 | 提示词目标 |
| --- | --- | --- |
| `desktop` | 安装路径在桌面应用的 `process.resourcesPath` 下（含 `app.asar`），或来源是桌面 app.asar 探针 | 桌面应用内「检查更新…」；不执行 npm 全局安装，验证看应用内版本 |
| `cli` | 运行时模块 / 模块解析 / npm 全局探针命中，且路径不在桌面 resources 下 | `npm install -g @deepseek-ai/dsh@<精确版本>` + `dsh --version` + 重启 `dsh web` |
| 未知 | 全部探针落空（`info()` 失败或找不到安装目录） | 两种方式都列出并逐条标注，由用户按实际运行方式二选一 |

`0.2.1` 起优先使用官方 `ctx.pluginPackages.packageOf('@deepseek-ai/dsh', import.meta.url)` 探测：它走运行时解析，桌面 `app.asar` 与 npm 全局布局都能定位，且不需要 `exports` 暴露 `package.json`。该服务在 `0.2.0-rc.2` 不存在，因此全程特性检测、失败静默并回退到文件系统探针（见「开发者」的探测顺序）。

## 安装

要求：DSH 运行时 **`>=0.2.0-rc.1 <0.3.0-0`** —— `package.json` 的 `engines.dsh`（官方兼容性闸门的首选声明，有它时闸门忽略 peer 范围），同时保留 `@deepseek-ai/dsh-typert-protocol` 的 `peerDependencies`/`devDependencies` 供包管理器与真实依赖使用。**兼容目标与已核对宿主**（静态契约核对，安装后仍需在目标宿主冒烟）：DSH `0.2.0-rc.2`（npm 全局 web profile）与 DSH `0.2.1-rc.2`（桌面应用当前内建运行时，Electron 44 / Node 24；上一轮静态核对基线 `0.2.1-rc.1`；其 `process.resourcesPath` / `app.asar` 与 `pluginPackages` 路径已按运行时源码和只读探测核对）。dsh 已通过 npm 全局安装、能用 `dsh plugin`，并且 [pnpm](https://pnpm.io/zh/) 在 PATH 中。

> 桌面应用（`desktop` profile）由 Electron 独占，`dsh plugin --profile desktop` 会被 CLI 拒绝；桌面侧请在应用内「插件」页安装。

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
| 页面显示「获取失败」或版本「未知」 | `info()` 只在打开设置页时请求一次，页面内**没有**重试按钮；重新打开设置页（或刷新页面）会重新探测。仍失败请看「诊断：」行，按提示检查对应探针（`pluginPackages` / 桌面 `app.asar` / npm 全局） |
| 某个渠道显示查询失败 | 只有那个渠道的请求失败（网络或标签不存在），点该渠道的「重试」；另一个渠道不受影响 |
| 检查更新提示限流 | GitHub 对未登录请求有频率限制，等一会儿再试 |
| 复制按钮没反应 | 浏览器在非安全上下文会禁用剪贴板 API；本机 localhost 通常可用，失败时会自动选中文本供手动复制 |
| 显示「已是最新」但版本号看着旧 | 本地版本高于该渠道标签时会这样（例如自己装的构建比公开版新），属正常 |
| 正式版块显示的版本比 npm `latest` 新 | 正常，且是刻意的：`latest` 只是标签之一，正式版线取所有正式版标签中的最高版本；块内会注明该版本来自哪个标签（如 `next`） |
| 桌面应用里为什么提示「检查更新…」而不是 npm 命令？ | 桌面版运行时打包在应用的 `app.asar` 内，由桌面壳更新；`npm install -g` 只更新命令行 CLI。插件按 `installEnvironment=desktop` 生成应用内更新提示词（提示词里不会出现 `npm install -g`） |
| 桌面版能钉死某个精确版本吗？ | 桌面更新由桌面壳提供，应用内「检查更新…」不一定能选到任意 npm 版本。提示词会说明：应用内没有目标版本时等待桌面壳发布；验证以应用内显示的版本为准 |
| 装了 Alpha，想回稳定版但没有提示词 | 不应再出现：正式版高于当前 Alpha 时给升级/切回提示词，低于时给回退提示词，本机版本识别失败时给中性提示词。若仍看不到，说明正式版渠道查询失败（块内会显示失败原因），点「重试」 |
| 本机版本比渠道还新，块里却说「已领先」 | 现在会额外给出「切回渠道版本提示词」，可以精确钉回渠道当前发布的版本 |

## 开发者

- `lib/index.js` —— Host 半区：`TypertRemoteService` + 手工 `@Remote` 标记（注册 `versionUpdate`）、出站网络（npm registry / GitHub Releases，15 秒超时）与三个 Remote 方法：
  - `info()` —— 本地版本 / 安装路径 / 安装来源 / 安装环境 / Node / npm / 平台 / 数据目录 + 诊断；本地事实与探针链在 `lib/probe.js`。
  - `checkChannels()` —— **一次请求取回全部 dist-tag**（`latest` / `next` / `alpha` …），每个渠道取「属于该渠道的最高版本」，返回 `{ checkedAt, channels: { stable, alpha } }`；每个渠道自带 `version` / `sourceTag` / `latestVersion` / `error`。整批失败时自动回退到 `latest` + `alpha` 两个单标签查询；失败原因由各渠道自己的 `error` 说明，不再返回从未展示的 `distTags` / `distTagsError`。
  - `releases()` —— 官方 GitHub Releases 摘要。
- `lib/probe.js` —— 安装探测（从 `lib/index.js` 抽出）：`runCmd` / `npmVersion` / `npmRoot` / `packageRootFrom` / `findDshRoot` / `readLocalInfo`。探测顺序（命中即止）：
  1. `ctx.get('pluginPackages').packageOf('@deepseek-ai/dsh', import.meta.url)` —— `0.2.1` 新增的官方解析，返回 `{ dir, version }`；特性检测，失败静默；
  2. `clientModules.clientPath('@deepseek-ai/dsh-client-modules')` 反推 —— 桌面下**必然未命中**（`app.asar/dsh` 的 manifest 是桌面运行时，不是 `@deepseek-ai/dsh`），因此该探针失败**静默**，不写误导性的「诊断」；
  3. `<process.resourcesPath>/app.asar/dsh/node_modules/@deepseek-ai/dsh` —— 桌面主路径；
  4. `createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')` —— profile 把运行时提升到自身依赖树时命中；
  5. `npm root -g` —— 机器上的 npm 全局 CLI，可能不是当前运行的版本。
  结果同时给出 `installSource`（哪个探针命中）与 `installEnvironment`（`desktop` / `cli`）——后者决定提示词用哪种更新方式。
- `lib/client.js` —— Client 半区，`__ModuleLoader__.load` 格式，注册设置页入口；两个渠道块共用 `channelView()` 的渲染结果，界面里不重复判定逻辑；`installSource` / `installEnvironment` / `installPath` 原样传入 `channelView()`，提示词由纯函数按安装环境生成。
- `lib/version.js` —— 纯函数（语义化版本比较、渠道识别、判定、提示词模板、安装来源 → 更新方式），**可单测的那一份**。
- `test/version.test.mjs` —— `npm test`（即 `node test/version.test.mjs`）；包含行为断言、**漂移守卫**、桌面/未知来源提示词断言、`pluginPackages` 探测断言与 manifest/图标断言（当前 25 条）。

> **为什么纯函数写了两份？** DSH 的客户端模块表按包只注册一个工厂，运行时**无法** `require("./version.js")`（ESM import 在这个经典脚本里也是语法错误），所以逻辑必须内联在 `lib/client.js`；`lib/version.js` 是可测试的副本。测试会把 `client.js` 中 `__VERSION_BEGIN__` / `__VERSION_END__` 之间的区域抽出来与新文件逐行比对，两边不同步就会**测试失败**。改逻辑时请同时改两处内联区域（`node test/version.test.mjs` 会立刻抓到漂移）。

改完源码：Host 重启 DSH，Client 刷新页面，无需构建。`ctx.remote.$mount()` 返回的卸载函数是 **async** 的；`ctx.effect` 的 disposer 会把它返回并等待，HMR 重挂载时不会与旧 namespace 竞争。探针结果只在 `info()` 调用时读取；诊断行不再把桌面下 `clientModules` 的预期未命中写成故障。

## 更新日志

### v1.4.1
- **修复（P1｜桌面提示词目标）**：`info.installSource` 现在贯通到 `channelView()` 与 `buildStablePrompt` / `buildAlphaPrompt` / `buildRollbackPrompt`。桌面应用（来源 `desktopApp`、`installEnvironment: desktop`，或 `pluginPackages` 命中 `app.asar`）的提示词改为**在桌面应用内用「检查更新…」更新、在应用内核对版本**；**不再出现 `npm install -g`，也不再要求重启 `dsh web`**。CLI / npm 全局保持原提示词；来源未知时两条路径都给出并逐条标注。新增断言：桌面提示词不含 `npm install -g`。
- **修复（P1｜兼容声明）**：`package.json` 增加 `engines.dsh: ">=0.2.0-rc.1 <0.3.0-0"`（官方兼容性闸门的首选字段），并**保留** `@deepseek-ai/dsh-typert-protocol` 的 peer/dev 依赖。
- **新增（0.2.1 接口｜`pluginPackages` 后备探针）**：`lib/probe.js` 的探测链最前面加入 `ctx.get('pluginPackages').packageOf('@deepseek-ai/dsh', import.meta.url)`（官方来源优先尝试、特性检测、失败静默回退到原有探针链；`0.2.0-rc.2` 无此服务），返回 `{ dir, version }`，并据此给出 `installEnvironment`；原 `clientModules` → 桌面 `app.asar` → `require` → `npm root -g` 探针链保留。桌面下 `clientModules` 探针必然未命中，其失败改为**静默**（不再写误导诊断）。
- **修复（P2｜$mount 生命周期）**：`ctx.remote.$mount()` 返回的 **async** 卸载函数现在由 `ctx.effect` 的 disposer 返回并等待，HMR / 插件卸载时不会与重挂载的旧 namespace 竞争。
- **清理（P2）**：删除 gateway/registry 都不读的 `sourceLocation` 死字段；删除 `checkChannels` 从未被客户端展示的 `distTags` / `distTagsError` 输出；`lib/index.js` 只保留 Remote / 网络 / 服务，安装探测纯移动到 `lib/probe.js`；源码里的历史记账注释（v1.1.x 的 npm/Windows/性能说明、旧判定 bug 叙述）迁入本更新日志。
- **展示（P2）**：`package.json` 增加 `icon: "./icon.svg"` 与 16×16 单色线性图标（版本/升级箭头，`fill="none" stroke="currentColor" stroke-width="1.5"`），`icon.svg` 加入 `files`。
- 验证：`node test/version.test.mjs` **25/25 通过**（含两条漂移守卫、桌面/未知来源提示词、`pluginPackages` 探测、manifest/图标断言）；`node --check` 对 `lib/index.js` / `lib/version.js` / `lib/client.js` / `lib/probe.js` 全部通过。

### v1.4.0
- **修复（peer 范围）**：`^0.1.7-rc.1` → **`>=0.2.0-rc.1 <0.3.0`** —— 原范围导致 `0.2.0-rc.1` / `rc.2` 上安装被官方闸门直接拒绝（已有真实拒绝日志）；并补上 `devDependencies` 镜像。
- 删除 `checkUpdate()` 宿主方法与客户端描述符：仅供 pre-1.3.0 的缓存客户端，早已不可达。
- `findDshRoot()` 新增桌面 app.asar 探针 `<process.resourcesPath>/app.asar/dsh/node_modules/@deepseek-ai/dsh`，修正桌面下版本识别失败 / 误报 npm 全局版本的问题；面板显示「探测来源」。
- `summarizeBody` 中文段切分新增 `<h3 id="en-` 边界（现行 release body 没有 `---` 分隔符）。
- 清理注释里写死的 `0.1.5-rc.3` / `0.1.7-rc.1` dist-tag 举例；新增 locale 元数据。
- 验证：`npm test` 18/18 通过（含两条 client/version 漂移守卫）。

### v1.3.3
- 迁移：对齐 DSH `0.1.7-rc.1`（自 `0.1.7-alpha.2`）。本插件用到的 `clientModules.clientPath()`、`slots.inject` / `slots.register`、`ctx.remote.$mount`（CONTRIBUTION 校验逻辑在 `alpha.2 → rc.1` 逐字节未变）与 `@deepseek-ai/dsh-typert-protocol` 的 Remote 契约均未变，无需改接口代码。peer 对齐 `^0.1.7-rc.1`。
- 说明：本插件解析出的「正式版线最新版」正是 `0.1.7-rc.1`（npm `next` 标签），也就是本次迁移的目标版本。
- 验证：`npm test` 18/18（含漂移守卫）；隔离 `DSH_HOME` 冷启动 rc.1 → 模块已注册、客户端产物 HTTP 200 且含 `__ModuleLoader__.load`。

### v1.3.2
- 修复（渠道口径不一致）：正式版渠道过去只读 npm 的 `latest` 标签，而「版本历史」列的是全部已发布版本，于是同一个问题出现两个答案 —— 本机 `0.1.7-alpha.2` 时，「检查更新」显示正式版为 `v0.1.5-rc.3`（`latest`），「版本历史」却把 `v0.1.7-rc.1` 标为正式版。现在 `checkChannels` 一次取回**全部 dist-tag**，正式版取「所有正式版标签中版本最高者」，与版本历史口径一致；块内新增来源说明（如「取自 `next` 标签；`latest` 当前为 v0.1.5-rc.3」）。
- 修复（Alpha 拿不到正式版提示词）：判定逻辑里「同一版本线的 rc 不算更新」的守卫会把 `0.1.7-rc.1` 判成「已领先」并**不生成任何提示词**。按语义化版本 `rc.1 > alpha.2`，这实际是更新。现在：正式版更高 → 升级/切回正式版线路提示词；正式版更低 → 新增 `switch` 判定，仍给出明确标注为回退的「切回正式版」提示词（复用此前从未接线的 `buildRollbackPrompt`）。**只要在 Alpha 线上，正式版块一定可操作。**
- 策略（确认后加固「随时能切回稳定版」）：**只要渠道查到版本号，块内一定有可复制提示词**，版本高低只决定文案（v1.4.1 起修正为：正式版块仍如此，Alpha 块在本机版本无法判断时不给提示词，见「渠道与版本判定」）：
  - 本机版本识别失败（`uncomparable`）时，正式版块不再只留一句「无法对比」，而是给出中性「切换到官方正式版 vX」提示词，并要求 agent 先 `dsh --version` 记录当前版本以便回退；不会声称是升级还是降级，也不会猜本机渠道；
  - 本机版本**高于**正式版渠道（`ahead`，例如自己装了更新的 rc）时，正式版块从「无需操作」改为给出「切回渠道版本提示词」，文案明确写「本机版本高于渠道当前版本，这是降级/回退」，绝不写成升级；
  - Alpha 块在「本机已领先 alpha 渠道」和「无法对比」时仍不给提示词（安装 Alpha 属高风险动作，不在无法判断时诱导执行）。
- 修复（提示词措辞）：Alpha → 正式版不再一律写成「降级/回退」，按实际版本高低分别写成「属于升级」或「属于降级/回退」，并保持步骤编号连续；`buildRollbackPrompt` 按来源线区分文案（Alpha 线 vs 更高的正式版版本）。
- 提示词精简（按确认的要求）：
  - **Alpha 提示词去掉「先备份 `$DSH_HOME`」步骤** —— 覆盖安装只替换全局包、不写 `$DSH_HOME`，提示词末尾本来就如此声明，备份步骤与之矛盾。步骤号由计数器重排（换线 3–7、同线 3–6），不再硬编码。
  - 风险说明压成一句中文：删掉 `npm dist-tag 为 alpha` / `GitHub Release 标记为 pre-release` 术语，以及「不适合生产或长期主力环境，请先确认可以接受这些风险」的劝阻句。
  - 两端提示词结尾的 `注意` 长句同样精简：正式版由「（不要用 @latest，npm 的 latest 标签可能解析到别的发行线）」缩为「（不要用 @latest）」，Alpha 由「不要用 @alpha 或 @latest（dist-tag 会随时间漂移）」缩为「（不要用 @alpha 或 @latest）」。
  - Alpha 渠道块上方的界面说明同步删掉「请先备份 `$DSH_HOME`」，与提示词保持一致。
  - 顺手修掉一处重复的注释行（两份内联区域里 `buildAlphaPrompt` 上方的注释被重复粘贴，因两边同错所以漂移守卫没报）。
  - 测试新增回归断言：不得出现备份字样、不得出现 `dist-tag`/`pre-release` 术语与劝阻句、步骤编号连续。
- 修复（健壮性）：`runCmd()` 在沙箱/受限环境下 `execFile` 会**同步抛出** EPERM，异常在 Promise executor 里变成 rejection，直接打挂整个 `info()`，界面显示「获取失败」；`npmRoot()` 失败时还会把 `null` 缓存哨兵返回给 `path.join()` 抛错。现在两者都按各自文档「失败返回 `''`」降级为「版本未知 + 诊断」。
- 修复（复制回退）：`execCommand('copy')` 回退按位置取第 2 个 textarea 认定 Alpha；现在两个块都可能各自有提示词，改为按 `data-channel` 定位。
- 测试：`npm test` 18/18（含漂移守卫）；另用一次性 harness 以真实 npm registry 跑通 Host `checkChannels`，并渲染真实客户端 bundle 验证三种本机状态（Alpha 升级、版本识别失败、本机领先渠道）都出现提示词，以及两条失败链路降级而非抛错。

### v1.3.1
- 修复：DSH 0.1.7 的 Typert codec 契约变更（strict codec 必须带 `create()` 工厂），`versionUpdate` 的 Remote namespace 挂载失败，「版本与更新」取不到数据；`strictCodec()` 改为提供 `create`。peer 对齐 `^0.1.7-alpha.2`。
- 复核：`lib/version.js` 与 `lib/client.js` 的 `__VERSION_BEGIN__/__VERSION_END__` 漂移守卫区域未受影响，`npm test` 14/14 通过。

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
