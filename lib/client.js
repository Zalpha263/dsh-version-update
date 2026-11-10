// dsh-version-update — Client half (persistent, web module-loader format).
//
// Registers the "更新日志" settings.section entry. The page is a read-only
// browser for the official release notes:
//   - local environment card (version / channel / install tree / Node / npm)
//   - "where does my version sit" banner
//   - channel groups (Alpha preview / RC stable) -> collapsible versions ->
//     collapsible categories (新增功能 / 体验优化 / 问题修复 / 其他变更) -> bullets
//   - full-text search + channel/category filters
//   - version-range comparison (default: running version -> newest)
//   - cached data with a manual refresh and GitHub rate-limit degradation
// There is deliberately NO update button and no update prompt: the official
// desktop updater owns that. This page only answers "what changed?".
//
// The Client half cannot import lib/changelog.js at runtime (the DSH client
// module loader hands one factory a synchronous require that resolves only the
// platform seeds and already-materialized entries), so it renders the Host's
// pre-parsed data and only owns presentation logic.

window.__ModuleLoader__.load({
	id: "dsh-version-update",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		const NS = "versionUpdate";
		const ALL = "__all__";
		const KINDS = ["added", "improved", "fixed", "other"];

		/* ------------------------------------------------------------------
		   1. Package-owned styles (the persistent client has no builtin styles)
		   ------------------------------------------------------------------ */
		let styleEl = null;
		function insertCss(css) {
			if (styleEl === null || !document.contains(styleEl)) {
				styleEl = document.createElement("style");
				styleEl.setAttribute("data-plugin", "dsh-version-update");
				styleEl.setAttribute("data-plugin-css", "dsh-version-update");
				document.head.appendChild(styleEl);
			}
			const node = document.createTextNode(css);
			styleEl.appendChild(node);
			return function dispose() {
				if (node.parentNode === styleEl) styleEl.removeChild(node);
			};
		}

		const CSS = `
.vu-section{max-width:780px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex;font-family:inherit}
.vu-head{gap:2px;display:flex;flex-direction:column}
.vu-title{margin:0;font-size:18px;font-weight:600}
.vu-intro{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}
.vu-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;flex-direction:column;gap:10px;padding:14px;display:flex}
.vu-cardHead{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;display:flex;flex-wrap:wrap}
.vu-cardTitle{font-size:14px;font-weight:600;margin:0}
.vu-row{flex-direction:row;align-items:baseline;gap:10px;display:flex}
.vu-label{color:var(--dsw-alias-label-secondary);font-size:12px;min-width:88px;flex:none}
.vu-value{font-size:13px;overflow-wrap:anywhere;flex:1;min-width:0}
.vu-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.vu-btn{appearance:none;font:inherit;cursor:pointer;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 10px;font-size:13px;line-height:18px}
.vu-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.vu-btn:disabled{opacity:.5;cursor:default}
.vu-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-btnPrimary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vu-btnOn{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vu-btnText{border-color:transparent;padding:2px 6px;color:var(--dsw-alias-label-secondary)}
.vu-btnText:hover:not(:disabled){background:transparent;color:var(--dsw-alias-label-primary)}
.vu-status{font-size:13px;line-height:20px;margin:0}
.vu-ok{color:var(--dsw-alias-state-success-primary)}
.vu-warn{color:var(--dsw-alias-state-warn-primary)}
.vu-error{color:var(--dsw-alias-state-error-primary)}
.vu-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.vu-banner{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1)}
.vu-bannerUpdate{border-color:var(--dsw-alias-brand-primary)}
.vu-bannerHead{display:flex;flex-direction:row;align-items:center;gap:10px;flex-wrap:wrap}
.vu-chips{display:flex;flex-wrap:wrap;gap:6px}
.vu-chip{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px;background:transparent;color:var(--dsw-alias-label-secondary)}
.vu-chip:hover{border-color:var(--dsw-alias-label-dimmed)}
.vu-chipOn{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.vu-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-toolbar{display:flex;flex-direction:column;gap:8px}
.vu-toolbarRow{display:flex;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap}
.vu-search{flex:1;min-width:200px;appearance:none;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 10px;font-size:13px;line-height:18px}
.vu-search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-channel{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;display:flex;flex-direction:column}
.vu-channelHead{display:flex;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px}
.vu-channelBody{display:flex;flex-direction:column;gap:8px;padding:0 12px 12px}
.vu-tag{font-size:11px;font-weight:600;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary)}
.vu-tagAlpha{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.vu-tagStable{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.vu-version{font-size:15px;font-weight:700}
.vu-count{color:var(--dsw-alias-label-tertiary);font-size:12px}
.vu-release{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;display:flex;flex-direction:column}
.vu-releaseHead{appearance:none;font:inherit;cursor:pointer;text-align:left;color:inherit;background:transparent;border:0;display:flex;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-radius:10px}
.vu-releaseHead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.vu-releaseHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-releaseBody{display:flex;flex-direction:column;gap:8px;padding:0 12px 12px}
.vu-releaseIntro{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}
.vu-sectionBlock{border-left:2px solid var(--dsw-alias-border-l1);padding-left:8px;display:flex;flex-direction:column;gap:4px}
.vu-kindHead{appearance:none;font:inherit;cursor:pointer;color:inherit;background:transparent;border:0;display:flex;flex-direction:row;align-items:center;gap:8px;padding:2px 0;font-size:13px;font-weight:600;text-align:left}
.vu-kindHead:hover{color:var(--dsw-alias-brand-primary)}
.vu-kindHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-kindBadge{font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.vu-kind-added{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.vu-kind-improved{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vu-kind-fixed{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.vu-kind-other{color:var(--dsw-alias-label-tertiary)}
.vu-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.vu-item{font-size:13px;line-height:20px;display:flex;flex-direction:column;gap:1px}
.vu-itemLine{display:flex;flex-direction:row;align-items:baseline;gap:8px}
.vu-itemText{flex:1;min-width:0;overflow-wrap:anywhere}
.vu-itemVersion{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}
.vu-authors{display:flex;flex-direction:row;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.vu-author{color:var(--dsw-alias-brand-primary);text-decoration:none}
.vu-author:hover{text-decoration:underline}
.vu-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;margin:0;line-height:20px}
.vu-range{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;display:flex;flex-direction:column;gap:10px;padding:14px}
.vu-rangeRow{display:flex;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap}
.vu-select{appearance:none;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;font-size:13px;line-height:18px}
.vu-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-searchGroup{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;display:flex;flex-direction:column;gap:6px;padding:10px 12px}
.vu-searchGroupHead{display:flex;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap}
.vu-link{color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:12px}
.vu-link:hover{text-decoration:underline}
`;

		/* ------------------------------------------------------------------
		   2. Official locale dictionaries (ctx.locale.register; flat keys)
		   UI language follows the official application language. Release bodies
		   are bilingual, so the visible text switches with it for free.
		   ------------------------------------------------------------------ */
		const ZH = {
			nav: "更新日志",
			title: "版本更新日志",
			intro: "查看 dsh 官方版本新增、调整与修复的内容；按 Alpha 预览版与 RC 稳定版分组，版本与分类都可折叠。数据来自官方 GitHub Releases。",
			"env.title": "本机环境",
			"env.version": "版本",
			"env.channel": "渠道",
			"env.path": "安装路径",
			"env.source": "探测来源",
			"env.node": "Node.js",
			"env.npm": "npm",
			"env.home": "数据目录",
			"env.platform": "平台",
			"env.checked": "数据更新于",
			"env.refresh": "刷新数据",
			"env.refreshing": "正在获取…",
			"env.unknown": "未知",
			"env.failed": "获取失败",
			"env.debug": "诊断",
			"source.pluginPackages": "运行时解析",
			"source.clientModules": "运行时模块",
			"source.desktopApp": "桌面应用内",
			"source.require": "模块解析",
			"source.npmRoot": "npm 全局",
			"status.loading": "正在加载更新日志…",
			"status.empty": "暂无发布记录。",
			"status.limited": "GitHub 查询被限流，正在显示缓存（更新于 {time}）。",
			"status.network": "网络不可用，正在显示缓存。",
			"status.http": "查询失败（HTTP {status}），正在显示缓存。",
			"status.parse": "发布数据格式异常，暂时无法显示。",
			"status.stale": "缓存数据可能不是最新。",
			"status.retry": "重试",
			"toolbar.searchPlaceholder": "搜索版本或关键字，例如「插件」「会话」",
			"toolbar.channel": "渠道",
			"toolbar.kind": "分类",
			"toolbar.compare": "版本对比",
			"toolbar.clear": "清除",
			"channel.all": "全部",
			"channel.latest": "最新 v{version}",
			"channel.count": "{count} 个版本",
			"channel.alpha": "Alpha 预览版",
			"channel.stable": "RC 稳定版",
			"kind.all": "全部分类",
			"kind.added": "新增功能",
			"kind.improved": "体验优化",
			"kind.fixed": "问题修复",
			"kind.other": "其他变更",
			"release.published": "发布于 {date}",
			"release.items": "{count} 条",
			"release.source": "GitHub 原文",
			"release.expand": "展开",
			"release.collapse": "收起",
			"release.empty": "该版本没有可显示的条目。",
			"range.title": "版本对比",
			"range.from": "起点（不含）",
			"range.to": "终点（含）",
			"range.run": "生成对比",
			"range.running": "正在汇总…",
			"range.total": "共 {total} 条变更：新增 {added}、优化 {improved}、修复 {fixed}、其他 {other}",
			"range.empty": "该区间没有变更记录。",
			"range.swapped": "起点比终点新，已自动交换。",
			"range.close": "关闭",
			"range.error": "对比失败，请重试。",
			"standing.unknown": "本机版本未能识别，无法定位到更新日志中的位置。",
			"standing.current": "本机 v{version} 已是该渠道的最新版本。",
			"standing.ahead": "本机 v{version}（{channel}）之上还有 {count} 个版本、{total} 条变更。",
			"standing.view": "查看这些变更",
			"standing.latest": "最新：{stable}（RC）· {alpha}（Alpha）",
			"search.result": "匹配到 {total} 条（{count} 个版本）",
			"search.none": "没有匹配的变更。",
			"search.truncated": "结果过多，只显示前 {max} 条。",
			"error.info": "本机环境信息获取失败。"
		};
		const EN = {
			nav: "Changelog",
			title: "Release changelog",
			intro: "Browse what each official dsh release added, improved and fixed, grouped by Alpha preview and RC stable channels. Versions and categories are collapsible. Data comes from the official GitHub Releases.",
			"env.title": "Local environment",
			"env.version": "Version",
			"env.channel": "Channel",
			"env.path": "Install path",
			"env.source": "Probe",
			"env.node": "Node.js",
			"env.npm": "npm",
			"env.home": "Data directory",
			"env.platform": "Platform",
			"env.checked": "Data updated",
			"env.refresh": "Refresh data",
			"env.refreshing": "Fetching…",
			"env.unknown": "Unknown",
			"env.failed": "Unavailable",
			"env.debug": "Diagnostics",
			"source.pluginPackages": "runtime resolution",
			"source.clientModules": "runtime modules",
			"source.desktopApp": "desktop app",
			"source.require": "module resolution",
			"source.npmRoot": "npm global",
			"status.loading": "Loading the changelog…",
			"status.empty": "No releases found.",
			"status.limited": "GitHub rate-limited the request; showing the cache (updated {time}).",
			"status.network": "Network unavailable; showing the cache.",
			"status.http": "Request failed (HTTP {status}); showing the cache.",
			"status.parse": "The release data could not be parsed.",
			"status.stale": "The cache may be out of date.",
			"status.retry": "Retry",
			"toolbar.searchPlaceholder": "Search versions or keywords, e.g. plugin",
			"toolbar.channel": "Channel",
			"toolbar.kind": "Category",
			"toolbar.compare": "Compare versions",
			"toolbar.clear": "Clear",
			"channel.all": "All",
			"channel.latest": "Latest v{version}",
			"channel.count": "{count} versions",
			"channel.alpha": "Alpha preview",
			"channel.stable": "RC stable",
			"kind.all": "All categories",
			"kind.added": "New features",
			"kind.improved": "Improvements",
			"kind.fixed": "Bug fixes",
			"kind.other": "Other changes",
			"release.published": "Published {date}",
			"release.items": "{count} items",
			"release.source": "GitHub release",
			"release.expand": "Expand",
			"release.collapse": "Collapse",
			"release.empty": "No entries for this release.",
			"range.title": "Version comparison",
			"range.from": "From (exclusive)",
			"range.to": "To (inclusive)",
			"range.run": "Compare",
			"range.running": "Aggregating…",
			"range.total": "{total} changes: {added} new, {improved} improvements, {fixed} fixes, {other} other",
			"range.empty": "No changes in this range.",
			"range.swapped": "The endpoints were swapped automatically.",
			"range.close": "Close",
			"range.error": "Comparison failed; please retry.",
			"standing.unknown": "The running version could not be identified, so it cannot be placed on the changelog.",
			"standing.current": "The running v{version} is the newest in its channel.",
			"standing.ahead": "{count} versions and {total} changes are newer than v{version} ({channel}).",
			"standing.view": "View these changes",
			"standing.latest": "Latest: {stable} (RC) · {alpha} (Alpha)",
			"search.result": "{total} matches in {count} versions",
			"search.none": "No matching changes.",
			"search.truncated": "Too many matches; showing the first {max}.",
			"error.info": "Could not read the local environment."
		};
		const DICTS = { zh: ZH, en: EN };

		/* ------------------------------------------------------------------
		   3. Remote contribution
		   ------------------------------------------------------------------ */
		function passthroughSchema() {
			return { parse: (value) => value };
		}
		function strictCodec(typeSymbol) {
			return { mode: "strict", typeSymbol: typeSymbol, create: () => passthroughSchema() };
		}
		const PKG = "dsh-version-update";
		const seg = (method) => PKG + "#" + NS + "/" + method;
		function descriptor(method, params) {
			return {
				id: seg(method),
				service: NS,
				namespace: NS,
				method: method,
				invocation: { kind: "direct" },
				parameters: (params || []).map((param) => {
					const name = typeof param === "string" ? param : param.name;
					const entry = { name: name, wire: name, source: "json", codec: strictCodec(seg(method) + ":" + name) };
					if (typeof param === "object" && param.optional === true) entry.acceptsUndefined = true;
					return entry;
				}),
				result: strictCodec(seg(method) + ":result")
			};
		}
		const CONTRIBUTION = {
			package: PKG,
			descriptors: [
				descriptor("info", []),
				descriptor("changelog", [{ name: "refresh", optional: true }, { name: "lang", optional: true }]),
				descriptor("range", ["from", "to", { name: "lang", optional: true }]),
				descriptor("search", ["query", { name: "channel", optional: true }, { name: "kind", optional: true }, { name: "lang", optional: true }])
			]
		};

		/* ------------------------------------------------------------------
		   4. Presentation helpers (no React hooks)
		   ------------------------------------------------------------------ */
		const pad = (n) => String(n).padStart(2, "0");
		function formatTime(ts) {
			if (typeof ts !== "number" || isNaN(ts)) return "—";
			const d = new Date(ts);
			return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
		}
		function formatDate(iso) {
			if (typeof iso !== "string" || iso === "") return "—";
			const d = new Date(iso);
			if (isNaN(d.getTime())) return "—";
			return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
		}
		function selectedLang(locale) {
			try {
				const snapshot = locale && typeof locale.getSnapshot === "function" ? locale.getSnapshot() : null;
				const active = snapshot && typeof snapshot.active === "string" ? snapshot.active : "zh";
				return active.toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
			} catch (err) {
				return "zh";
			}
		}
		function channelLabel(t, channel) {
			if (channel === "alpha") return t("channel.alpha");
			if (channel === "stable") return t("channel.stable");
			return t("channel.all");
		}
		function sortedReleases(releases, channel) {
			const list = Array.isArray(releases) ? releases : [];
			return list.filter((release) => release.channel === channel);
		}
		function releaseSections(release, lang, kindFilter) {
			const sections = Array.isArray(release[lang]) ? release[lang] : [];
			return sections.filter((section) => kindFilter === ALL || section.kind === kindFilter);
		}
		function releaseCounts(release, lang) {
			const counts = { added: 0, improved: 0, fixed: 0, other: 0, total: 0 };
			const sections = Array.isArray(release[lang]) ? release[lang] : [];
			for (const section of sections) {
				counts[section.kind] += section.items.length;
				counts.total += section.items.length;
			}
			return counts;
		}
		function kindClass(kind) {
			return "vu-kindBadge vu-kind-" + kind;
		}
		function itemKey(version, kind, index) {
			return version + ":" + kind + ":" + String(index);
		}
		function toggleSet(set, key) {
			const next = new Set(set);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		}

				const h = React.createElement;

		function InfoRow(props) {
			return h("div", { className: "vu-row" },
				h("span", { className: "vu-label" }, props.label),
				h("span", { className: "vu-value" }, props.value));
		}

		function countsLine(t, counts) {
			const parts = [];
			for (const kind of KINDS) {
				if (counts[kind] > 0) parts.push(t("kind." + kind) + " " + counts[kind]);
			}
			return parts.join(" · ");
		}

		function sourceLabel(t, source) {
			if (typeof source !== "string" || source === "") return null;
			const text = t("source." + source);
			return text === "source." + source ? source : text;
		}

		function EnvCard(props) {
			const t = props.t;
			const info = props.info || {};
			const pending = props.pending === true;
			const failed = props.failed === true;
			const show = (value) => {
				if (pending) return t("status.loading");
				if (failed) return t("env.failed");
				return value === undefined || value === null || value === "" ? t("env.unknown") : String(value);
			};
			const channel = info.localChannel ? channelLabel(t, info.localChannel) : null;
			const source = sourceLabel(t, info.installSource);
			const pathText = info.installPath
				? info.installPath + (source ? "（" + t("env.source") + "：" + source + "）" : "")
				: t("env.unknown");
			const platform = [info.platform, info.arch].filter(Boolean).join(" ");
			return h("div", { className: "vu-card" },
				h("div", { className: "vu-cardHead" },
					h("h3", { className: "vu-cardTitle" }, t("env.title")),
					h("span", { className: "vu-meta" },
						t("env.checked") + "：" + (props.fetchedAt ? formatTime(props.fetchedAt) : "—"),
						h("button", {
							className: "vu-btn vu-btnText",
							onClick: props.onRefresh,
							disabled: props.refreshing === true,
							style: { marginLeft: "8px" }
						}, props.refreshing === true ? t("env.refreshing") : t("env.refresh")))),
				h(InfoRow, { label: t("env.version"), value: show(info.localVersion) + (channel ? "（" + channel + "）" : "") }),
				h(InfoRow, { label: t("env.path"), value: h("span", { className: "vu-mono" }, pathText) }),
				h(InfoRow, { label: t("env.node"), value: show(info.nodeVersion) }),
				h(InfoRow, { label: t("env.npm"), value: show(info.npmVersion) }),
				h(InfoRow, { label: t("env.home"), value: h("span", { className: "vu-mono" }, show(info.dshHome)) }),
				h(InfoRow, { label: t("env.platform"), value: show(platform) }),
				failed && h("p", { className: "vu-status vu-warn" }, t("error.info")),
				!failed && info.debug ? h("p", { className: "vu-meta" }, t("env.debug") + "：" + info.debug) : null);
		}

		function StandingBanner(props) {
			const t = props.t;
			const local = props.local || null;
			if (local === null) return null;
			const latestParts = [];
			if (local.latestStable) latestParts.push(local.latestStable);
			if (local.latestAlpha) latestParts.push(local.latestAlpha);
			const latestLine = local.latestStable || local.latestAlpha
				? h("p", { className: "vu-meta" }, t("standing.latest", {
					stable: local.latestStable || "—",
					alpha: local.latestAlpha || "—"
				}))
				: null;
			if (local.known !== true) {
				return h("div", { className: "vu-banner" },
					h("p", { className: "vu-status" }, t("standing.unknown")),
					latestLine);
			}
			const label = channelLabel(t, local.channel);
			const ahead = local.versionsAhead > 0;
			const text = ahead
				? t("standing.ahead", { version: local.version, channel: label, count: local.versionsAhead, total: local.counts.total })
				: t("standing.current", { version: local.version });
			const head = h("div", { className: "vu-bannerHead" },
				h("p", { className: ahead ? "vu-status vu-warn" : "vu-status vu-ok" }, text),
				ahead && local.newestSame
					? h("button", { className: "vu-btn vu-btnPrimary", onClick: () => props.onView(local.version, local.newestSame) }, t("standing.view"))
					: null);
			return h("div", { className: "vu-banner" + (ahead ? " vu-bannerUpdate" : "") },
				head,
				ahead ? h("p", { className: "vu-meta" }, countsLine(t, local.counts)) : null,
				latestLine);
		}

		function Toolbar(props) {
			const t = props.t;
			const channelChips = [
				h("button", { key: ALL, className: "vu-chip" + (props.channelFilter === ALL ? " vu-chipOn" : ""), onClick: () => props.onChannel(ALL) }, t("channel.all")),
				h("button", { key: "alpha", className: "vu-chip" + (props.channelFilter === "alpha" ? " vu-chipOn" : ""), onClick: () => props.onChannel("alpha") }, t("channel.alpha")),
				h("button", { key: "stable", className: "vu-chip" + (props.channelFilter === "stable" ? " vu-chipOn" : ""), onClick: () => props.onChannel("stable") }, t("channel.stable"))
			];
			const kindChips = [h("button", { key: ALL, className: "vu-chip" + (props.kindFilter === ALL ? " vu-chipOn" : ""), onClick: () => props.onKind(ALL) }, t("kind.all"))];
			for (const kind of KINDS) {
				kindChips.push(h("button", {
					key: kind,
					className: "vu-chip" + (props.kindFilter === kind ? " vu-chipOn" : ""),
					onClick: () => props.onKind(kind)
				}, t("kind." + kind)));
			}
			return h("div", { className: "vu-toolbar" },
				h("div", { className: "vu-toolbarRow" },
					h("input", {
						className: "vu-search",
						type: "search",
						value: props.query,
						placeholder: t("toolbar.searchPlaceholder"),
						onChange: (event) => props.onQuery(event.target.value)
					}),
					h("button", { className: "vu-btn" + (props.compareOpen ? " vu-btnOn" : ""), onClick: props.onToggleCompare }, t("toolbar.compare"))),
				h("div", { className: "vu-toolbarRow" },
					h("span", { className: "vu-meta" }, t("toolbar.channel")),
					h("div", { className: "vu-chips" }, channelChips)),
				h("div", { className: "vu-toolbarRow" },
					h("span", { className: "vu-meta" }, t("toolbar.kind")),
					h("div", { className: "vu-chips" }, kindChips)),
				props.searching ? h("p", { className: "vu-meta" }, t("status.loading")) : null);
		}

		function ItemRow(props) {
			const t = props.t;
			const item = props.item;
			const authors = Array.isArray(item.authors) ? item.authors : [];
			return h("li", { className: "vu-item" },
				h("div", { className: "vu-itemLine" },
					h("span", { className: "vu-itemText" }, item.text),
					props.showVersion && props.version ? h("span", { className: "vu-itemVersion" }, "v" + props.version) : null),
				authors.length > 0
					? h("div", { className: "vu-authors" }, authors.map((author) => h("a", {
						key: author,
						className: "vu-author",
						href: "https://github.com/" + encodeURIComponent(author),
						target: "_blank",
						rel: "noreferrer"
					}, "@" + author)))
					: null);
		}

		function SectionBlock(props) {
			const t = props.t;
			const section = props.section;
			const expanded = props.expanded === true;
			return h("div", { className: "vu-sectionBlock" },
				h("button", {
					className: "vu-kindHead",
					onClick: () => props.onToggle(section.kind),
					"aria-expanded": expanded
				},
				h("span", { className: kindClass(section.kind) }, t("kind." + section.kind)),
				h("span", { className: "vu-count" }, t("release.items", { count: section.items.length })),
				h("span", { className: "vu-meta" }, expanded ? t("release.collapse") : t("release.expand"))),
				expanded
					? h("ul", { className: "vu-items" }, section.items.map((item, index) => h(ItemRow, {
						key: itemKey(props.version, section.kind, index),
						item: item,
						version: props.version,
						showVersion: false,
						t: t
					})))
					: null);
		}

		function ReleaseCard(props) {
			const t = props.t;
			const release = props.release;
			const lang = props.lang;
			const expanded = props.expanded === true;
			const sections = releaseSections(release, lang, props.kindFilter);
			const counts = releaseCounts(release, lang);
			return h("div", { className: "vu-release" },
				h("div", { className: "vu-releaseHead" },
					h("button", {
						className: "vu-btn vu-btnText",
						onClick: () => props.onToggle(release.version),
						"aria-expanded": expanded
					}, (expanded ? "▾ " : "▸ ") + "v" + release.version),
					h("span", { className: "vu-tag " + (release.channel === "alpha" ? "vu-tagAlpha" : "vu-tagStable") }, channelLabel(t, release.channel)),
					h("span", { className: "vu-meta" }, t("release.published", { date: formatDate(release.publishedAt) })),
					h("span", { className: "vu-count" }, t("release.items", { count: counts.total })),
					h("span", { className: "vu-value" }),
					release.url ? h("a", { className: "vu-link", href: release.url, target: "_blank", rel: "noreferrer" }, t("release.source") + " ↗") : null),
				expanded
					? h("div", { className: "vu-releaseBody" },
						release.intro ? h("p", { className: "vu-releaseIntro" }, release.intro) : null,
						sections.length === 0
							? h("p", { className: "vu-empty" }, t("release.empty"))
							: sections.map((section) => h(SectionBlock, {
								key: release.version + ":" + section.kind,
								section: section,
								version: release.version,
								expanded: props.expandedSections.has(release.version + ":" + section.kind),
								onToggle: (kind) => props.onToggleSection(release.version, kind),
								t: t
							})),
						release.compareUrl
							? h("a", { className: "vu-link", href: release.compareUrl, target: "_blank", rel: "noreferrer" }, "Full Changelog ↗")
							: null)
					: null);
		}

		function ChannelGroup(props) {
			const t = props.t;
			const channel = props.channel;
			const releases = props.releases;
			const expanded = props.expanded === true;
			const latest = releases.length > 0 ? releases[0].version : null;
			return h("div", { className: "vu-channel" },
				h("div", { className: "vu-channelHead" },
					h("button", {
						className: "vu-btn vu-btnText",
						onClick: () => props.onToggle(channel),
						"aria-expanded": expanded
					}, (expanded ? "▾ " : "▸ ") + channelLabel(t, channel)),
					h("span", { className: "vu-count" }, t("channel.count", { count: releases.length })),
					latest ? h("span", { className: "vu-meta" }, t("channel.latest", { version: latest })) : null,
					h("span", { className: "vu-value" })),
				expanded
					? h("div", { className: "vu-channelBody" },
						releases.length === 0
							? h("p", { className: "vu-empty" }, t("status.empty"))
							: releases.map((release) => h(ReleaseCard, {
								key: release.version,
								release: release,
								expanded: props.expandedVersions.has(release.version),
								expandedSections: props.expandedSections,
								kindFilter: props.kindFilter,
								lang: props.lang,
								t: t,
								onToggle: props.onToggleVersion,
								onToggleSection: props.onToggleSection
							})))
					: null);
		}

		function SearchResults(props) {
			const t = props.t;
			const result = props.result;
			if (result === null) return null;
			if (result.total === 0) return h("p", { className: "vu-empty" }, t("search.none"));
			const groups = result.groups.map((group) => {
				const head = h("div", { className: "vu-searchGroupHead" },
					h("span", { className: "vu-version" }, "v" + group.version),
					h("span", { className: "vu-tag " + (group.channel === "alpha" ? "vu-tagAlpha" : "vu-tagStable") }, channelLabel(t, group.channel)),
					h("span", { className: "vu-meta" }, formatDate(group.publishedAt)),
					h("span", { className: "vu-value" }),
					group.url ? h("a", { className: "vu-link", href: group.url, target: "_blank", rel: "noreferrer" }, t("release.source") + " ↗") : null);
				const matches = group.matches.map((match) => {
					const items = match.items.map((item, index) => h(ItemRow, {
						key: itemKey(group.version, match.kind, index),
						item: item,
						version: group.version,
						showVersion: false,
						t: t
					}));
					return h("div", { key: group.version + ":" + match.kind, className: "vu-sectionBlock" },
						h("span", { className: kindClass(match.kind) }, t("kind." + match.kind)),
						h("ul", { className: "vu-items" }, items));
				});
				return h("div", { key: group.version, className: "vu-searchGroup" }, head, matches);
			});
			return h("div", { className: "vu-toolbar" },
				h("p", { className: "vu-meta" }, t("search.result", { total: result.total, count: result.groups.length })),
				result.truncated ? h("p", { className: "vu-status vu-warn" }, t("search.truncated", { max: 200 })) : null,
				groups);
		}

		function RangePanel(props) {
			const t = props.t;
			const releases = Array.isArray(props.releases) ? props.releases : [];
			const ascending = releases.slice().reverse();
			const options = (list) => list.map((release) => h("option", { key: release.version, value: release.version }, "v" + release.version + "（" + channelLabel(t, release.channel) + "）"));
			const result = props.result;
			return h("div", { className: "vu-range" },
				h("div", { className: "vu-cardHead" },
					h("h3", { className: "vu-cardTitle" }, t("range.title")),
					h("button", { className: "vu-btn vu-btnText", onClick: props.onClose }, t("range.close"))),
				h("div", { className: "vu-rangeRow" },
					h("span", { className: "vu-meta" }, t("range.from")),
					h("select", { className: "vu-select", value: props.from, onChange: (event) => props.onFrom(event.target.value) }, options(ascending)),
					h("span", { className: "vu-meta" }, t("range.to")),
					h("select", { className: "vu-select", value: props.to, onChange: (event) => props.onTo(event.target.value) }, options(releases)),
					h("button", {
						className: "vu-btn vu-btnPrimary",
						onClick: props.onRun,
						disabled: props.running === true
					}, props.running === true ? t("range.running") : t("range.run"))),
				props.error ? h("p", { className: "vu-status vu-error" }, t("range.error")) : null,
				result && result.ok === true
					? h("div", { className: "vu-toolbar" },
						h("p", { className: "vu-meta" }, t("range.total", {
							total: result.counts.total,
							added: result.counts.added,
							improved: result.counts.improved,
							fixed: result.counts.fixed,
							other: result.counts.other
						})),
						result.swapped ? h("p", { className: "vu-meta" }, t("range.swapped")) : null,
						result.versions.length === 0
							? h("p", { className: "vu-empty" }, t("range.empty"))
							: result.sections.map((section) => h("div", { key: section.kind, className: "vu-sectionBlock" },
								h("span", { className: kindClass(section.kind) }, t("kind." + section.kind) + " " + section.items.length),
								h("ul", { className: "vu-items" }, section.items.map((item, index) => h(ItemRow, {
									key: itemKey(section.kind, item.version, index),
									item: item,
									version: item.version,
									showVersion: true,
									t: t
								}))))))
					: null);
		}

		function errorText(t, data) {
			const error = data && data.error ? data.error : null;
			if (error === null) return null;
			const time = data && data.fetchedAt ? formatTime(data.fetchedAt) : "—";
			if (error.code === "rate-limit") return t("status.limited", { time: time });
			if (error.code === "network") return t("status.network");
			if (error.code === "http") return t("status.http", { status: error.status === null || error.status === undefined ? "—" : error.status });
			return t("status.parse");
		}

		function ChangelogSection(props) {
			const remote = props.remote;
			const locale = props.locale;
			const t = props.t;
			const [lang, setLang] = React.useState(() => selectedLang(locale));
			const [info, setInfo] = React.useState(null);
			const [infoFailed, setInfoFailed] = React.useState(false);
			const [phase, setPhase] = React.useState("loading");
			const [data, setData] = React.useState(null);
			const [refreshing, setRefreshing] = React.useState(false);
			const [query, setQuery] = React.useState("");
			const [channelFilter, setChannelFilter] = React.useState(ALL);
			const [kindFilter, setKindFilter] = React.useState(ALL);
			const [search, setSearch] = React.useState(null);
			const [searching, setSearching] = React.useState(false);
			const [compareOpen, setCompareOpen] = React.useState(false);
			const [fromVersion, setFromVersion] = React.useState("");
			const [toVersion, setToVersion] = React.useState("");
			const [rangeResult, setRangeResult] = React.useState(null);
			const [rangeError, setRangeError] = React.useState(false);
			const [rangeBusy, setRangeBusy] = React.useState(false);
			const [expandedChannels, setExpandedChannels] = React.useState({ alpha: true, stable: true });
			const [expandedVersions, setExpandedVersions] = React.useState(() => new Set());
			const [expandedSections, setExpandedSections] = React.useState(() => new Set());
			const alive = React.useRef(true);

			React.useEffect(() => {
				alive.current = true;
				return () => { alive.current = false; };
			}, []);

			React.useEffect(() => {
				if (!locale || typeof locale.subscribe !== "function") return undefined;
				const unsubscribe = locale.subscribe(() => setLang(selectedLang(locale)));
				return typeof unsubscribe === "function" ? unsubscribe : undefined;
			}, [locale]);

			const defaultExpanded = (releases) => {
				const versions = new Set();
				const sections = new Set();
				const list = Array.isArray(releases) ? releases : [];
				const newestStable = list.find((release) => release.channel === "stable");
				const newestAlpha = list.find((release) => release.channel === "alpha");
				if (newestStable) {
					versions.add(newestStable.version);
					const kinds = Array.isArray(newestStable[lang]) ? newestStable[lang].map((section) => section.kind) : [];
					for (const kind of ["added", "improved"]) {
						if (kinds.indexOf(kind) >= 0) sections.add(newestStable.version + ":" + kind);
					}
				}
				if (newestAlpha) versions.add(newestAlpha.version);
				return { versions: versions, sections: sections };
			};

			const applyData = (result) => {
				if (result === null || typeof result !== "object") return;
				setData(result);
				setPhase("ready");
				const releases = Array.isArray(result.releases) ? result.releases : [];
				setExpandedVersions((current) => (current.size > 0 ? current : defaultExpanded(releases).versions));
				setExpandedSections((current) => (current.size > 0 ? current : defaultExpanded(releases).sections));
				if (result.local && result.local.known === true) {
					setFromVersion((current) => (current === "" ? result.local.version : current));
					setToVersion((current) => (current === "" ? (result.local.newestSame || result.local.latest || "") : current));
				}
			};

			const load = (refreshRequested) => {
				if (refreshRequested !== true) setPhase((current) => (current === "ready" ? current : "loading"));
				return remote.changelog(refreshRequested === true, lang).then((result) => {
					if (!alive.current) return;
					applyData(result);
				}).catch(() => {
					if (!alive.current) return;
					setPhase("error");
					setData({
						releases: [],
						fetchedAt: null,
						checkedAt: null,
						stale: false,
						error: { code: "network", status: null }
					});
				});
			};

			React.useEffect(() => {
				let disposed = false;
				alive.current = true;
				remote.info().then((facts) => {
					if (!disposed && alive.current) setInfo(facts);
				}).catch(() => {
					if (!disposed && alive.current) setInfoFailed(true);
				});
				load(false);
				return () => { disposed = true; };
			}, []);

			React.useEffect(() => {
				const needle = query.trim();
				if (needle === "") {
					setSearch(null);
					setSearching(false);
					return undefined;
				}
				setSearching(true);
				const timer = window.setTimeout(() => {
					const channel = channelFilter === ALL ? null : channelFilter;
					const kind = kindFilter === ALL ? null : kindFilter;
					remote.search(needle, channel, kind, lang).then((result) => {
						if (!alive.current) return;
						setSearch(result);
						setSearching(false);
					}).catch(() => {
						if (!alive.current) return;
						setSearch({ ok: true, query: needle, total: 0, truncated: false, groups: [] });
						setSearching(false);
					});
				}, 250);
				return () => window.clearTimeout(timer);
			}, [query, channelFilter, kindFilter, lang]);

			const refresh = () => {
				if (refreshing) return;
				setRefreshing(true);
				remote.info().then((facts) => {
					if (!alive.current) return;
					setInfo(facts);
					setInfoFailed(false);
				}).catch(() => {
					if (alive.current) setInfoFailed(true);
				});
				remote.changelog(true, lang).then((result) => {
					if (!alive.current) return;
					applyData(result);
					setRefreshing(false);
				}).catch(() => {
					if (!alive.current) return;
					setRefreshing(false);
					setPhase((current) => (current === "ready" ? "ready" : "error"));
				});
			};

			const dataReleases = data && Array.isArray(data.releases) ? data.releases : [];
			const local = data && data.local ? data.local : null;

			const runRange = (start, end) => {
				const fromValue = typeof start === "string" && start !== "" ? start : fromVersion;
				const toValue = typeof end === "string" && end !== "" ? end : toVersion;
				if (fromValue === "" || toValue === "") return;
				setRangeBusy(true);
				setRangeError(false);
				remote.range(fromValue, toValue, lang).then((result) => {
					if (!alive.current) return;
					setRangeBusy(false);
					if (result && result.ok === true) {
						setRangeResult(result);
					} else {
						setRangeResult(null);
						setRangeError(true);
					}
				}).catch(() => {
					if (!alive.current) return;
					setRangeBusy(false);
					setRangeError(true);
				});
			};

			const toggleCompare = () => {
				if (compareOpen) {
					setCompareOpen(false);
					return;
				}
				setCompareOpen(true);
				setRangeResult(null);
				setRangeError(false);
				if (fromVersion === "" && local && local.known === true) setFromVersion(local.version);
				if (toVersion === "" && local) setToVersion(local.newestSame || local.latest || "");
			};

			const viewStanding = (fromValue, toValue) => {
				setCompareOpen(true);
				setRangeResult(null);
				setRangeError(false);
				setFromVersion(fromValue);
				setToVersion(toValue);
				runRange(fromValue, toValue);
			};

			const visibleChannels = channelFilter === ALL ? ["stable", "alpha"] : [channelFilter];
			const grouped = visibleChannels.map((channel) => ({
				channel: channel,
				releases: sortedReleases(dataReleases, channel)
			}));
			const showSearch = query.trim() !== "";
			const noData = data && data.error && dataReleases.length === 0;
			const staleNote = data && data.stale && dataReleases.length > 0 ? errorText(t, data) : null;

			return h("section", { className: "vu-section" },
				h("div", { className: "vu-head" },
					h("h2", { className: "vu-title" }, t("title")),
					h("p", { className: "vu-intro" }, t("intro"))),
				h(EnvCard, {
					info: info,
					pending: info === null && infoFailed !== true,
					failed: infoFailed,
					fetchedAt: data ? data.fetchedAt : null,
					refreshing: refreshing,
					onRefresh: refresh,
					t: t
				}),
				h(StandingBanner, { local: local, t: t, onView: viewStanding }),
				h(Toolbar, {
					query: query,
					channelFilter: channelFilter,
					kindFilter: kindFilter,
					onQuery: setQuery,
					onChannel: setChannelFilter,
					onKind: setKindFilter,
					compareOpen: compareOpen,
					onToggleCompare: toggleCompare,
					searching: searching,
					t: t
				}),
				compareOpen
					? h(RangePanel, {
						releases: dataReleases,
						from: fromVersion,
						to: toVersion,
						onFrom: setFromVersion,
						onTo: setToVersion,
						onRun: () => runRange(fromVersion, toVersion),
						onClose: () => setCompareOpen(false),
						running: rangeBusy,
						result: rangeResult,
						error: rangeError,
						t: t
					})
					: null,
				phase === "loading" ? h("p", { className: "vu-status" }, t("status.loading")) : null,
				noData
					? h("div", { className: "vu-status vu-error" },
						h("p", { className: "vu-status vu-error" }, errorText(t, data)),
						h("button", { className: "vu-btn", onClick: () => load(true) }, t("status.retry")))
					: null,
				phase !== "loading" && !noData
					? showSearch
						? h(SearchResults, { result: search, t: t })
						: h("div", { className: "vu-toolbar" }, grouped.map((group) => h(ChannelGroup, {
							key: group.channel,
							channel: group.channel,
							releases: group.releases,
							expanded: expandedChannels[group.channel] !== false,
							expandedVersions: expandedVersions,
							expandedSections: expandedSections,
							kindFilter: kindFilter,
							lang: lang,
							t: t,
							onToggle: (channel) => setExpandedChannels((current) => Object.assign({}, current, { [channel]: current[channel] === false })),
							onToggleVersion: (version) => setExpandedVersions((current) => toggleSet(current, version)),
							onToggleSection: (version, kind) => setExpandedSections((current) => toggleSet(current, version + ":" + kind))
						})))
					: null,
				staleNote ? h("p", { className: "vu-status vu-warn" }, staleNote) : null,
				phase === "ready" && dataReleases.length === 0 ? h("p", { className: "vu-empty" }, t("status.empty")) : null);
		}

		async function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			ctx.effect(function installCss() {
				return insertCss(CSS);
			});

			const locale = ctx.locale;
			const t = locale && typeof locale.bind === "function" ? locale.bind(NS) : (key) => key;
			if (locale && typeof locale.register === "function") {
				ctx.effect(function installDictionaries() {
					return locale.register(NS, DICTS);
				}, "version-update: dictionaries");
			}

			// Mount the remote namespace BEFORE registering UI so section calls
			// resolve immediately.
			try {
				const disposeMount = await ctx.remote.$mount(CONTRIBUTION);
				ctx.effect(function ownMount() {
					return function unmountRemoteNamespace() {
						// $mount resolves an ASYNC disposer: return its promise so an
						// entry unload / HMR replacement waits for the old namespace
						// before a new one mounts instead of racing it.
						return Promise.resolve().then(disposeMount).catch((err) => {
							console.error("[dsh-version-update] remote namespace unmount failed:", err);
						});
					};
				});
			} catch (err) {
				console.error("[dsh-version-update] remote namespace mount failed:", err);
				return;
			}

			function unwrap(result) {
				if (result && result.ok === true) return result.value;
				const error = result && result.error;
				throw new Error((error && error.message) || "versionUpdate remote call failed");
			}
			function call(method, args) {
				return Promise.resolve().then(() => {
					const namespace = ctx.get("remote.versionUpdate");
					if (namespace === undefined) throw new Error("versionUpdate namespace unavailable");
					return namespace[method].apply(namespace, args);
				}).then(unwrap);
			}
			const remote = {
				info: () => call("info", []),
				changelog: (refreshRequested, langCode) => call("changelog", [refreshRequested, langCode]),
				range: (from, to, langCode) => call("range", [from, to, langCode]),
				search: (query, channel, kind, langCode) => call("search", [query, channel, kind, langCode])
			};

			ctx.effect(function installSection() {
				return slots.inject("settings.section", () => slots.register(
					{ name: "settings.section", id: "version-update", order: 30, label: () => t("nav") },
					(sectionProps) => React.createElement(ChangelogSection, Object.assign({}, sectionProps, {
						remote: remote,
						locale: locale,
						t: t
					}))
				));
			});
		}

		const inject = ["slots", "remote", "locale"];
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});