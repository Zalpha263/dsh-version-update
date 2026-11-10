# dsh-version-update

在 DSH 设置页浏览**官方版本更新日志**：按 **Alpha 预览版**与 **RC 稳定版**分组，版本与分类都可折叠；支持全文搜索、本机版本定位、版本区间对比与离线缓存。

> v2.0.0 起本插件**不再提供「检查更新 / 升级提示词」**——那部分能力已由 DSH 官方的桌面更新通道接管。这里只回答一个问题：**每个版本改了什么？**

## 功能

入口：**设置 → 更新日志**。

- **本机环境小卡片**：dsh 版本与渠道、安装路径与探测来源（桌面应用内 / npm 全局 / 运行时解析等）、Node.js、npm、`$DSH_HOME`、平台架构，以及数据更新时间与「刷新数据」按钮（刷新的是**更新日志数据**，不是升级）。
- **本机版本定位**：显示「你目前在 vX，同渠道之上还有 N 个版本、M 条变更」，一键打开该区间的对比。
- **双渠道折叠树**：
  - **Alpha 预览版** / **RC 稳定版** 两个分组，各自显示版本数与最新版本；
  - 每个版本可折叠，展开后按 **新增功能 / 体验优化 / 问题修复 / 其他变更** 四类再折叠；
  - 每条变更显示正文与 `@作者`（可点击到 GitHub），版本卡片带发布日期与 GitHub 原文链接。
- **全文搜索**：跨全部版本搜索关键字（如「插件」「会话」「MCP」），按版本分组展示命中条目；支持渠道与分类筛选，输入防抖 250ms。
- **版本区间对比**：选起点（不含）与终点（含），聚合这段时间内所有变更，按分类分组、每条标注来源版本；默认「本机版本 → 该渠道最新版本」，端点可手动调整，起点比终点新会自动交换。
- **中英双语**：界面文案走官方 `ctx.locale`，跟随应用语言；版本正文本身是中英双语的，按当前语言取对应段落，缺失时自动回退。
- **离线缓存与降级**：结果缓存在 `$DSH_HOME/cache/dsh-version-update/releases-v1.json`，15 分钟内直接复用；手动刷新可强制请求。GitHub 403/429（未登录 60 次/小时）或断网时显示缓存并标注「数据更新于 …」，不会白屏。

**没有更新按钮，也没有升级提示词**——这是刻意的：桌面更新由官方应用内「检查更新…」与强制更新策略负责，插件重复一套只会误导。

## 数据来源与解析

- 数据源：`https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100`，一次取回全部 37 个版本（约 340 KB，20 Alpha + 17 RC）。
- **渠道由版本号判定**：GitHub API 对这里所有版本都返回 `prerelease: true`（rc 也是），所以不能读该字段；版本号里带 `alpha` 归 Alpha，其余（含 `rc`）归 RC 稳定线。
- 正文有三种历史形态，解析器统一处理：
  1. 锚点标题：`<h3 id="cn-v0.2.2-rc.1-5">新增功能</h3>`；
  2. Markdown 标题：`### 体验优化`（语言按标题文字判定，并继承最近一次语言上下文）；
  3. 语言容器：`<h2 id="chinese">…</h2>` + 裸 `<h3>新增功能</h3>`（早期版本）。
- 标题归一化：`新增功能/✨ 新增/New Features → 新增`，`体验优化/🎨 优化/Improvements → 优化`，`问题修复/🐛 修复/Bug Fixes → 修复`，其余（含 `其他变更/Chores/SDK`）归「其他」。
- 条目处理：剔除 HTML 标签、Markdown 链接/粗体/行内代码、`[中文] | [English]` 导航行与 `Full Changelog` 行；`@作者` 从正文剥离后单独展示；`Full Changelog` 解析为对比链接（兼容 `[text](url)` 与裸 URL 两种写法）。

## 缓存与限流

- 路径：`$DSH_HOME/cache/dsh-version-update/releases-v1.json`（`DSH_HOME` 未设置时为 `~/.dsh`）。
- 结构：`{ schemaVersion, fetchedAt, checkedAt, etag, releases }`；原子写入（临时文件 + rename），损坏或版本不匹配时按无缓存处理。
- TTL 15 分钟（按 `checkedAt` 计）；`If-None-Match` 命中 304 只更新时间戳；失败时保留缓存并返回错误码（`network` / `rate-limit` / `http` / `parse`），客户端翻译成可读文案。
- 可选的 `GITHUB_TOKEN` 环境变量会把限额从 60/h 提升到 5000/h；插件只读取环境变量，不落盘、不记录。

## 安装

要求：DSH 运行时 **`>=0.2.0-rc.1 <0.3.0-0`**（`package.json` 的 `engines.dsh`），并且 dsh 已能使用 `dsh plugin`。

```bash
# 发布态：钉死提交
dsh plugin --profile web add github:Zalpha263/dsh-version-update#<40位commit>

# 开发态：裸目录路径 = link:（源码即部署，改完不用重装）
dsh plugin --profile web add D:/path/to/dsh-version-update

# 卸载
dsh plugin --profile web remove dsh-version-update
```

装完**重启 DSH**（Host 半区需要加载；只改界面可以 Ctrl+F5）。桌面应用（`desktop` profile）由 Electron 独占，`dsh plugin --profile desktop` 会被 CLI 拒绝，请在应用内「插件」页安装或按 profile 手动 link。

## 开发者

- `lib/changelog.js` —— 数据层：GitHub 抓取、双语文案解析、渠道/分类归一化、缓存读写、区间聚合、搜索、本机定位。纯函数可单测；`fetchReleases()` / `loadChangelog()` 接受 `fetchImpl` / `dshHome` 测试注入，测试不碰网络与真实主目录。
- `lib/index.js` —— Host 半区：`TypertRemoteService` + 手工 `@Remote` 标记（Node 24 不接受 stage-3 装饰器语法），4 个方法：
  - `info()` —— 本机版本/渠道/安装路径/安装环境/Node/npm/平台/数据目录 + 诊断；
  - `changelog(refresh, lang)` —— 解析后的发布列表、渠道统计、本机定位、缓存时间与错误码；
  - `range(from, to, lang)` —— 区间聚合；
  - `search(query, channel, kind, lang)` —— 全文搜索。
- `lib/probe.js` —— 安装探测链（`pluginPackages` → `clientModules` → 桌面 `app.asar` → `require` → `npm root -g`），产出 `installSource` / `installEnvironment`。与 v1.x 相同，未改动。
- `lib/client.js` —— Client 半区：`__ModuleLoader__.load` 格式；注册 `settings.section#version-update`（label 走 `ctx.locale.bind`）、挂载 Remote namespace、渲染折叠树/搜索/对比/环境卡片。**客户端不再内联纯逻辑**，只做展示。
- `test/changelog.test.mjs` —— 20 条单测：解析（锚点/Markdown/语言容器/emoji/仅中文）、渠道、区间、搜索、定位、缓存与 304/403/断网降级。
- `test/client-smoke.test.mjs` —— 无浏览器执行真实 bundle：模块形状、4 个 Remote descriptor 与参数、locale 字典、settings.section 注册、根组件空数据渲染、包布局；并断言旧的更新/提示词机器已移除。
- `test/fixtures/` —— 5 份裁剪后的真实 release body（四类标题、Alpha、emoji、Markdown 标题、仅中文），**不要手改**，按 README 重新从 GitHub API 抓取。

运行测试：

```bash
node test/changelog.test.mjs
node test/client-smoke.test.mjs
# 或
npm test
```

> `node --test test/` 在本机沙箱里会因测试 runner 需要 spawn 子进程而 EPERM；直接执行测试文件即可。

## 已验证

- `node --check` 通过 `lib/index.js`、`lib/changelog.js`、`lib/client.js`。
- 单测 20/20 通过；客户端冒烟 4/4 通过。
- 真实网络解析：37 个版本全部解析成功，无空语言段；中文 1113 条、英文 1116 条（翻译条目数略有差异），四类分布基本一致；渠道统计 17 RC / 20 Alpha；最长摘要 232 字符；单版本最多 126 条（0.2.2-rc.1）。
- Host 集成：`loadChangelog()` 在临时 `DSH_HOME` 下完成「抓取 → 解析 → 缓存 → 二次读取」，并验证 304、403 限流、断网降级路径（mock fetch）。
- 未做：真实宿主内浏览器点验（web profile 需要重启 host + 硬刷新；桌面 profile 需先安装本插件）。UI 的 API 契约已按宿主 0.2.2-rc.1 的 `ctx.locale` / `slots` / `remote` 源码核对。

## 更新日志

### v2.0.0（重写）
- **删除**：npm dist-tag 双渠道检查、9 种升级提示词模板、桌面/CLI 更新方式判定、与官方「检查更新…」重复的更新入口。原因：官方桌面更新（electron-updater + 强制更新策略 + 设置页侧栏徽标）已接管升级，插件再生成 npm/应用内升级指令只会误导。
- **新增**：官方 release notes 浏览器——双渠道折叠树、四类变更、本机环境卡片、本机版本定位、全文搜索与筛选、版本区间对比、15 分钟缓存 + 手动刷新 + GitHub 限流降级、中英双语（跟随官方 `locale`）。
- **重构**：解析/聚合/搜索全部收敛到 Host `lib/changelog.js`，删除 `lib/version.js` 与「纯逻辑双份 + 漂移守卫」；客户端只渲染。Remote 方法由 3 个改为 4 个（`info` / `changelog` / `range` / `search`），参数按官方 descriptor 规则声明。
- **保留**：安装探测链、环境诊断、`engines.dsh` 兼容闸门、设置页入口、图标与打包字段。

### v1.x（历史，已被 v2.0.0 取代）
- v1.4.1：桌面更新提示词改为应用内更新、`pluginPackages` 探测、`engines.dsh`、抽出 `probe.js`。
- v1.4.0：适配 DSH 0.2.0 线、桌面 `app.asar` 探针、删除 `checkUpdate`。
- v1.3.x：双渠道检查、渠道判定与提示词修复、对齐 0.1.7-rc.1。
- v1.2.x 及更早：版本/环境信息、npm 检查、版本历史（GitHub Releases 摘要）。

## License

MIT
