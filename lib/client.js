// dsh-version-update — Client half (persistent, web module-loader format).
//
// Registers the "版本与更新" settings.section entry with the full UI:
//   - local version / environment facts (+ which release channel is running)
//   - the update check, split into two side-by-side channels
//       * 官方正式版  → npm dist-tag "latest"
//       * Alpha 预览版 → npm dist-tag "alpha"
//   - one upgrade prompt per channel (copy + paste to DeepSeek)
//   - GitHub release history tagged by channel, with a channel filter
// It calls the Host through the "remote.versionUpdate" namespace mounted by
// THIS entry (never list it in "inject" — that would deadlock the entry).
//
// IMPORTANT — why the pure logic is inlined twice:
// The client module loader registers exactly ONE factory per plugin package and
// the synchronous require it hands us resolves only platform seed words and
// already-materialized entries, so this file CANNOT require("./version.js") at
// runtime (a bare ESM import would also be a syntax error in this classic
// script). The region delimited by __VERSION_BEGIN__ / __VERSION_END__ below is
// therefore duplicated in lib/version.js, which owns the unit tests;
// test/version.test.mjs extracts this region and fails when the two copies
// drift. Keep the region pure (no imports, no template literals, no React/DOM)
// so that extraction stays trivial.

window.__ModuleLoader__.load({
	id: "dsh-version-update",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		/** Package-owned <style> host — the persistent client has no "styles" builtin. */
		let styleEl = null;
		function insertCss(css) {
			if (styleEl === null || !document.contains(styleEl)) {
				styleEl = document.createElement("style");
				// data-plugin lets the client-modules materializer / HMR cleanup
				// claim and remove this tag with the plugin's other owned styles.
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
.vu-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex;font-family:inherit}
.vu-title{margin:0;font-size:18px;font-weight:600}
.vu-intro{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px}
.vu-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;flex-direction:column;gap:10px;padding:14px;display:flex}
.vu-cardHead{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;display:flex}
.vu-cardTitle{font-size:14px;font-weight:600;margin:0}
.vu-row{flex-direction:row;align-items:baseline;gap:10px;display:flex}
.vu-label{color:var(--dsw-alias-label-secondary);font-size:12px;min-width:92px;flex:none}
.vu-value{font-size:13px;overflow-wrap:anywhere;flex:1;min-width:0}
.vu-version{font-size:22px;font-weight:700;line-height:1.3}
.vu-btn{appearance:none;font:inherit;cursor:pointer;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 10px;font-size:13px;line-height:18px}
.vu-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.vu-btn:disabled{opacity:.5;cursor:default}
.vu-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-btn-primary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vu-btn-on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vu-status{font-size:13px;line-height:20px;margin:0}
.vu-status-ok{color:var(--dsw-alias-state-success-primary)}
.vu-status-update{color:var(--dsw-alias-state-warn-primary)}
.vu-status-error{color:var(--dsw-alias-state-error-primary)}
.vu-promptLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:0}
.vu-prompt{appearance:none;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;resize:vertical;min-height:130px;width:100%;box-sizing:border-box}
.vu-prompt:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.vu-actions{flex-direction:row;gap:8px;justify-content:flex-end;display:flex}
.vu-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.vu-list{margin:0;padding:0;list-style:none;flex-direction:column;gap:10px;display:flex}
.vu-item{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;flex-direction:column;gap:6px;padding:10px 12px;display:flex}
.vu-itemVersion{font-size:14px;font-weight:600}
.vu-itemSummary{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.vu-link{appearance:none;font:inherit;cursor:pointer;color:var(--dsw-alias-brand-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 10px;font-size:12px;line-height:18px;text-decoration:none;align-self:flex-start}
.vu-channel{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}
.vu-channelHead{flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap;display:flex}
.vu-tag{font-size:11px;font-weight:600;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary)}
.vu-tag-alpha{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.vu-channelVersion{font-size:15px;font-weight:700}
.vu-channelNote{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.vu-filters{flex-direction:row;gap:6px;flex-wrap:wrap;display:flex}
`;

		// --- Remote namespace contribution --------------------------------------
		// The "remote.versionUpdate" namespace is mounted by THIS entry; it must
		// therefore never appear in "inject". Codecs are "strict" with passthrough
		// schemas: the client-side Gateway only calls codec.schema.parse(value).
		function strictCodec(typeSymbol) {
			return { mode: "strict", typeSymbol: typeSymbol, schema: { parse: (value) => value } };
		}
		const CONTRIBUTION = {
			package: "dsh-version-update",
			descriptors: [
				{
					id: "dsh-version-update#versionUpdate/info",
					service: "versionUpdate",
					namespace: "versionUpdate",
					method: "info",
					invocation: { kind: "direct" },
					parameters: [],
					result: strictCodec("dsh-version-update#versionUpdate/info:result"),
					sourceLocation: { "file": "dsh-version-update/lib/client.js", "line": 1, "column": 1 }
				},
				{
					id: "dsh-version-update#versionUpdate/checkUpdate",
					service: "versionUpdate",
					namespace: "versionUpdate",
					method: "checkUpdate",
					invocation: { kind: "direct" },
					parameters: [],
					result: strictCodec("dsh-version-update#versionUpdate/checkUpdate:result"),
					sourceLocation: { "file": "dsh-version-update/lib/client.js", "line": 1, "column": 1 }
				},
				{
					id: "dsh-version-update#versionUpdate/checkChannels",
					service: "versionUpdate",
					namespace: "versionUpdate",
					method: "checkChannels",
					invocation: { kind: "direct" },
					parameters: [],
					result: strictCodec("dsh-version-update#versionUpdate/checkChannels:result"),
					sourceLocation: { "file": "dsh-version-update/lib/client.js", "line": 1, "column": 1 }
				},
				{
					id: "dsh-version-update#versionUpdate/releases",
					service: "versionUpdate",
					namespace: "versionUpdate",
					method: "releases",
					invocation: { kind: "direct" },
					parameters: [],
					result: strictCodec("dsh-version-update#versionUpdate/releases:result"),
					sourceLocation: { "file": "dsh-version-update/lib/client.js", "line": 1, "column": 1 }
				}
			]
		};

		const pad = (n) => String(n).padStart(2, '0');

		function formatTime(ts) {
			if (!ts) return '—';
			const d = new Date(ts);
			return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
		}

		function formatDate(iso) {
			if (!iso) return '—';
			const d = new Date(iso);
			if (isNaN(d.getTime())) return '—';
			return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
		}

/*__VERSION_BEGIN__*/
// --- Semver parsing and comparison (no dependency) --------------------------
// Parse "x.y.z[-prerelease]" (optional leading "v") and compare with semver
// ordering: numeric identifiers compare numerically, a prerelease sorts before
// its release, and prerelease identifiers compare numeric-before-alphanumeric.
// Returns -1 / 0 / 1, or null when either side does not parse (callers treat
// null as "cannot determine" and show a neutral hint instead of guessing).
var SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(v) {
	if (typeof v !== "string") return null;
	var m = SEMVER_RE.exec(v.trim());
	if (m === null) return null;
	return {
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3]),
		prerelease: m[4] === undefined ? null : m[4].split(".")
	};
}

function compareVersions(a, b) {
	var pa = parseVersion(a);
	var pb = parseVersion(b);
	if (pa === null || pb === null) return null;
	var keys = ["major", "minor", "patch"];
	for (var i = 0; i < keys.length; i += 1) {
		if (pa[keys[i]] !== pb[keys[i]]) return pa[keys[i]] < pb[keys[i]] ? -1 : 1;
	}
	// Equal core: none < prerelease < release (a missing prerelease sorts
	// AFTER one that is present).
	if (pa.prerelease === null && pb.prerelease === null) return 0;
	if (pa.prerelease === null) return 1;
	if (pb.prerelease === null) return -1;
	var max = Math.max(pa.prerelease.length, pb.prerelease.length);
	for (var j = 0; j < max; j += 1) {
		var x = pa.prerelease[j];
		var y = pb.prerelease[j];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (x === y) continue;
		var xn = /^\d+$/.test(x);
		var yn = /^\d+$/.test(y);
		if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
		if (xn) return -1; // numeric identifiers sort before alphanumeric
		if (yn) return 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

// --- Release channels -------------------------------------------------------
// A version belongs to the "alpha" channel when its prerelease segment carries
// an "alpha" identifier; everything else (plain releases AND the "rc" release
// candidates that the npm "latest" tag ships) belongs to the stable channel.
function channelOf(version) {
	var parsed = parseVersion(version);
	if (parsed === null) return null;
	if (parsed.prerelease === null) return "stable";
	for (var i = 0; i < parsed.prerelease.length; i += 1) {
		if (/alpha/i.test(parsed.prerelease[i])) return "alpha";
	}
	return "stable";
}

function channelLabel(channel) {
	if (channel === "alpha") return "Alpha 预览版";
	if (channel === "stable") return "官方正式版";
	return "未知渠道";
}

// Decide what the panel should show for one channel.
//
//   { localVersion, localChannel, channel, target }
//     localVersion / localChannel - the version actually running
//     channel                     - "stable" | "alpha", the channel being checked
//     target                      - that channel's newest version (null = unknown)
//
// Returns { kind, canPrompt } with kind one of:
//   "update"       - the channel has a newer version; prompt available
//   "current"      - the local version IS the channel's newest
//   "ahead"        - the local version is newer than this channel's newest
//   "uncomparable" - a version is missing or unparseable; never guess
//
// Cross-channel rule (the reason this is more than a plain compare): when the
// running build is an ALPHA, an older stable target is NOT an update and must
// never produce a downgrade prompt; only a strictly NEWER stable core may.
function decideChannel(input) {
	var localVersion = input.localVersion;
	var localChannel = input.localChannel;
	var channel = input.channel;
	var target = input.target;
	if (typeof target !== "string" || target === "") return { kind: "uncomparable", canPrompt: false };
	if (typeof localVersion !== "string" || localVersion === "") return { kind: "uncomparable", canPrompt: false };
	var cmp = compareVersions(target, localVersion);
	if (cmp === null) return { kind: "uncomparable", canPrompt: false };
	if (cmp === 0) return { kind: "current", canPrompt: false };
	if (cmp > 0) {
		if (localChannel === "alpha" && channel === "stable") {
			var localCore = parseVersion(localVersion);
			var targetCore = parseVersion(target);
			if (localCore === null || targetCore === null) return { kind: "uncomparable", canPrompt: false };
			if (localCore.major > targetCore.major) return { kind: "ahead", canPrompt: false };
			if (localCore.major === targetCore.major && localCore.minor > targetCore.minor) return { kind: "ahead", canPrompt: false };
			if (targetCore.major === localCore.major && targetCore.minor === localCore.minor && targetCore.patch === localCore.patch) {
				return { kind: "ahead", canPrompt: false };
			}
			return { kind: "update", canPrompt: true };
		}
		return { kind: "update", canPrompt: true };
	}
	return { kind: "ahead", canPrompt: false };
}

// --- Upgrade prompts (plain string concatenation: no template literals so the
// --- region stays trivially extractable by the drift guard) ---
function chooseChannel(promptChannel, version) {
	if (promptChannel === "alpha" || promptChannel === "stable") return promptChannel;
	return channelOf(version) || "stable";
}

// Official stable channel: exact pinned version, plus a rollback command.
function buildStablePrompt(input) {
	var target = input.target;
	var localVersion = input.localVersion || "未知";
	var localChannel = chooseChannel(input.localChannel, input.localVersion);
	var isRollback = localChannel === "alpha";
	var lines = [
		"请帮我升级 dsh（DeepSeek Harness）的官方正式版到 " + target + "：",
		"1. 升级前记录：当前版本 " + localVersion + "，当前渠道 " + channelLabel(localChannel)
	];
	if (isRollback) {
		lines.push("2. 这是从上一条 Alpha 线路切回正式版的降级/回退操作（覆盖安装同一个全局包）");
		lines.push("3. 官方安装命令（会覆盖安装同名的全局包）：npm install -g @deepseek-ai/dsh@" + target);
		lines.push("4. 升级后运行 dsh --version，确认输出为 " + target);
		lines.push("5. 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）使新版本生效");
	} else {
		lines.push("2. 官方安装命令（会覆盖安装同名的全局包）：npm install -g @deepseek-ai/dsh@" + target);
		lines.push("3. 升级后运行 dsh --version，确认输出为 " + target);
		lines.push("4. 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）使新版本生效");
	}
	lines.push("注意：必须使用上面的精确版本号（不要用 @latest，npm 的 latest 标签可能解析到别的发行线）；");
	lines.push("升级只替换全局安装的 @deepseek-ai/dsh 包，不影响 $DSH_HOME（~/.dsh）下的配置、会话与插件数据。");
	if (localVersion === "未知") {
		lines.push("如果升级后出现异常，请先确认升级前的实际版本，再执行：npm install -g @deepseek-ai/dsh@<升级前版本>");
	} else {
		lines.push("如果升级后出现异常，回退命令：npm install -g @deepseek-ai/dsh@" + localVersion);
	}
	return lines.join("\n");
}

// Alpha preview channel: same pinned install, plus the pre-release warning,
// a backup step, and the path back to the stable line.
function buildAlphaPrompt(input) {
	var target = input.target;
	var localVersion = input.localVersion || "未知";
	var localChannel = chooseChannel(input.localChannel, input.localVersion);
	var switching = localChannel !== "alpha";
	var lines = [
		"请帮我安装/升级 dsh（DeepSeek Harness）的 Alpha 预览版 " + target + "：",
		"1. 升级前记录：当前版本 " + localVersion + "，当前渠道 " + channelLabel(localChannel),
		"2. 这是官方开发者预览通道（npm dist-tag 为 alpha，GitHub Release 标记为 pre-release）：",
		"   正在快速迭代，可能包含破坏兼容性的变更（会话日志格式、插件 API、设置存储方式等），",
		"   不适合生产或长期主力环境，请先确认可以接受这些风险。",
		"3. 建议先备份数据目录 $DSH_HOME（默认 ~/.dsh），至少备份会话与配置文件。"
	];
	if (switching) {
		lines.push("4. 这会把你从正式版线路切换到 Alpha 预览线路（覆盖安装同一个全局包，不是并行安装）");
		lines.push("5. 官方安装命令（会覆盖安装当前版本）：npm install -g @deepseek-ai/dsh@" + target);
		lines.push("6. 升级后运行 dsh --version，确认输出为 " + target);
		lines.push("7. 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）使新版本生效");
		lines.push("8. 如遇到插件或会话异常，回退到官方正式版：");
		lines.push("   npm install -g @deepseek-ai/dsh@<正式版精确版本号>");
	} else {
		lines.push("4. 官方安装命令（会覆盖安装当前版本）：npm install -g @deepseek-ai/dsh@" + target);
		lines.push("5. 升级后运行 dsh --version，确认输出为 " + target);
		lines.push("6. 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）使新版本生效");
		lines.push("7. 如遇到插件或会话异常，回退到官方正式版：");
		lines.push("   npm install -g @deepseek-ai/dsh@<正式版精确版本号>");
	}
	lines.push("注意：必须使用上面的精确版本号，不要用 @alpha 或 @latest（dist-tag 会随时间漂移）；");
	lines.push("升级只替换全局安装的 @deepseek-ai/dsh 包，不影响 $DSH_HOME 下的配置、会话与插件数据。");
	return lines.join("\n");
}

// One-line prompt to go back to the stable line from an alpha install.
function buildRollbackPrompt(input) {
	var currentVersion = input.currentVersion || "未知";
	var currentChannel = chooseChannel(input.currentChannel, input.currentVersion);
	var lines = [
		"请帮我把 dsh（DeepSeek Harness）从上一条 Alpha 线路切回官方正式版 " + input.target + "：",
		"1. 升级前记录：当前版本 " + currentVersion + "，当前渠道 " + channelLabel(currentChannel),
		"2. 这是降级/回退操作（覆盖安装同一个全局包）：npm install -g @deepseek-ai/dsh@" + input.target,
		"3. 运行 dsh --version，确认输出为 " + input.target,
		"4. 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）",
		"注意：必须使用精确版本号；$DSH_HOME 下的配置、会话与插件数据不会被这次覆盖安装改动。"
	];
	return lines.join("\n");
}

// --- Per-channel display model (single source of truth for the two blocks) ---
// Keep every threshold and every string here; the UI only renders this shape.
function channelView(input) {
	var channel = input.channel;
	var target = typeof input.target === "string" && input.target !== "" ? input.target : null;
	var localVersion = typeof input.localVersion === "string" && input.localVersion !== "" ? input.localVersion : null;
	var localChannel = input.localChannel || null;
	var base = { version: target, decision: null, statusKind: "muted", status: "", prompt: null, promptLabel: null };
	if (target === null) return base;
	var decision = decideChannel({ localVersion: localVersion, localChannel: localChannel, channel: channel, target: target });
	base.decision = decision.kind;
	if (decision.kind === "uncomparable") {
		base.status = "已获取 " + target + "；本机版本未知或无法解析，无法对比（见上方基本信息与诊断）。";
		return base;
	}
	if (decision.kind === "update") {
		if (channel === "alpha") {
			base.statusKind = "update";
			base.status = "发现 Alpha 预览版 v" + target + "（当前 v" + localVersion + "）";
			base.promptLabel = "Alpha 升级提示词（复制后粘贴给 DeepSeek）";
			base.prompt = buildAlphaPrompt({ localVersion: localVersion, target: target });
			return base;
		}
		base.statusKind = "update";
		base.status = localChannel === "alpha"
			? "正式版已发布 v" + target + "，高于当前 Alpha v" + localVersion + "；可切换回正式版线路（覆盖安装）"
			: "发现新版本 v" + target + "（当前 v" + localVersion + "）";
		base.promptLabel = "升级提示词（复制后粘贴给 DeepSeek）";
		base.prompt = buildStablePrompt({ localVersion: localVersion, localChannel: localChannel, target: target });
		return base;
	}
	if (decision.kind === "current") {
		base.statusKind = "ok";
		base.status = channel === "alpha"
			? "当前已是最新的 Alpha 预览版 v" + localVersion
			: "当前已是最新版本 v" + localVersion;
		return base;
	}
	// ahead
	if (channel === "alpha") {
		base.status = "本机 v" + localVersion + " 已领先 alpha 渠道的 v" + target + "（无需操作）。";
		return base;
	}
	if (localChannel === "alpha") {
		base.status = "本机运行的是 Alpha 预览版 v" + localVersion + "；正式版渠道当前为 v" + target +
			"。切回正式版属于降级操作，仅在排查问题或需要稳定环境时执行。";
		return base;
	}
	base.status = "本机 v" + localVersion + " 已领先正式版渠道的 v" + target + "（无需操作）。";
	return base;
}
/*__VERSION_END__*/

		function InfoRow(props) {
			return React.createElement('div', { className: 'vu-row' },
				React.createElement('span', { className: 'vu-label' }, props.label),
				React.createElement('span', { className: 'vu-value' }, props.value),
			);
		}

		// One channel block. Renders from channelView() only — never recompute
		// thresholds or strings here.
		function ChannelBlock(props) {
			const channel = props.channel;
			const localVersion = props.localVersion;
			const localChannel = props.localChannel;
			const result = props.result || null;
			const view = channelView({ channel: channel, target: result && result.version, localVersion: localVersion, localChannel: localChannel });
			const label = channelLabel(channel);
			const error = result && result.error ? result.error : null;
			const statusClass = view.statusKind === 'ok' ? 'vu-status vu-status-ok'
				: view.statusKind === 'update' ? 'vu-status vu-status-update' : 'vu-meta';
			return React.createElement('div', { className: 'vu-channel' },
				React.createElement('div', { className: 'vu-channelHead' },
					React.createElement('span', { className: 'vu-tag' + (channel === 'alpha' ? ' vu-tag-alpha' : '') }, label),
					React.createElement('span', { className: 'vu-channelVersion' }, view.version ? 'v' + view.version : '版本未知'),
				),
				channel === 'alpha' && React.createElement('p', { className: 'vu-channelNote' },
					'Alpha 为官方开发者预览通道，可能包含破坏兼容性的变更（会话日志格式、插件 API 等），请先备份 $DSH_HOME。'),
				React.createElement('p', { className: statusClass }, view.status !== '' ? view.status : (props.checking ? '正在查询…' : '尚未检查')),
				error !== null && React.createElement('p', { className: 'vu-status vu-status-error' },
					'渠道查询失败：' + error, ' ',
					React.createElement('button', { className: 'vu-btn', onClick: props.onRetry, disabled: props.checking }, '重试'),
				),
				view.prompt !== null && React.createElement('p', { className: 'vu-promptLabel' }, view.promptLabel),
				view.prompt !== null && React.createElement('textarea', { className: 'vu-prompt', readOnly: true, value: view.prompt }),
				view.prompt !== null && React.createElement('div', { className: 'vu-actions' },
					React.createElement('button', {
						className: 'vu-btn vu-btn-primary',
						onClick: () => props.onCopy(view.prompt),
					}, props.copied ? '已复制 ✓' : '复制提示词'),
				),
			);
		}

		const ALL_CHANNEL = '__all__';
		const CHANNEL_ORDER = [ALL_CHANNEL, 'stable', 'alpha'];

		function VersionUpdateSection(props) {
			const { remote } = props;
			const [info, setInfo] = React.useState(null);
			const [infoFailed, setInfoFailed] = React.useState(false);
			const [phase, setPhase] = React.useState('idle'); // idle | checking | done
			const [channels, setChannels] = React.useState({ stable: null, alpha: null });
			const [checkedAt, setCheckedAt] = React.useState(null);
			const [copiedKey, setCopiedKey] = React.useState(null);
			const [historyPhase, setHistoryPhase] = React.useState('idle'); // idle | loading | ready | error
			const [historyItems, setHistoryItems] = React.useState([]);
			const [historyError, setHistoryError] = React.useState(null);
			const [historyFilter, setHistoryFilter] = React.useState(ALL_CHANNEL);

			React.useEffect(() => {
				let alive = true;
				remote().info()
					.then((res) => {
						if (!alive) return;
						if (res && typeof res === 'object') setInfo(res);
						else setInfoFailed(true);
					})
					.catch(() => { if (alive) setInfoFailed(true); });
				return () => { alive = false; };
			}, []);

			const checkChannels = () => {
				if (phase === 'checking') return;
				setPhase('checking');
				const startedAt = Date.now();
				remote().checkChannels()
					.then((result) => {
						const chans = result && result.channels && typeof result.channels === 'object' ? result.channels : {};
						setChannels({ stable: chans.stable || null, alpha: chans.alpha || null });
						setCheckedAt(typeof (result && result.checkedAt) === 'number' ? result.checkedAt : startedAt);
						setPhase('done');
					})
					.catch((err) => {
						const message = String((err && err.message) || err);
						setChannels({
							stable: { tag: 'stable', version: null, error: '远程调用失败：' + message },
							alpha: { tag: 'alpha', version: null, error: '远程调用失败：' + message }
						});
						setCheckedAt(startedAt);
						setPhase('done');
					});
			};

			const loadHistory = () => {
				if (historyPhase === 'loading') return;
				setHistoryPhase('loading');
				setHistoryError(null);
				remote().releases()
					.then((result) => {
						const items = result && Array.isArray(result.items) ? result.items : [];
						if (items.length > 0 || (result && !result.error)) {
							setHistoryItems(items);
							setHistoryPhase('ready');
						} else {
							setHistoryError((result && result.error) || '未知错误');
							setHistoryPhase('error');
						}
					})
					.catch((err) => {
						setHistoryError(String((err && err.message) || err));
						setHistoryPhase('error');
					});
			};

			const copyPrompt = (key, text) => {
				const done = () => {
					setCopiedKey(key);
					window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
				};
				const fallback = () => {
					// clipboard API 不可用或被拒：退回 execCommand('copy')
					const els = document.querySelectorAll('.vu-prompt');
					const target = els.length > 1 && key === 'alpha' ? els[1] : els[0];
					if (target) {
						try {
							target.select();
							if (document.execCommand && document.execCommand('copy')) { done(); return; }
						} catch (e) { /* fall through */ }
						// 仍失败：至少让用户看到选中状态可手动 Ctrl+C
						try { target.select(); } catch (e) {}
					}
				};
				if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text).then(done).catch(fallback);
				} else {
					fallback();
				}
			};

			const pending = info === null && !infoFailed;
			const localVersion = info && typeof info.localVersion === 'string' && info.localVersion !== '' ? info.localVersion : null;
			const localChannel = channelOf(localVersion);
			const debugText = info && typeof info.debug === 'string' && info.debug !== '' ? info.debug : null;
			const shownHistory = historyItems.filter((item) => historyFilter === ALL_CHANNEL || channelOf(item.version) === historyFilter);

			return React.createElement('div', { className: 'vu-section' },
				React.createElement('h2', { className: 'vu-title' }, '版本与更新'),
				React.createElement('p', { className: 'vu-intro' },
					'查看当前 dsh 版本与环境信息，分别检查 npm 官方正式版与 Alpha 预览版。发现新版本后可复制对应的升级提示词，交给 DeepSeek 执行升级。'),

				React.createElement('div', { className: 'vu-card' },
					React.createElement('h3', { className: 'vu-cardTitle' }, '基本信息'),
					React.createElement(InfoRow, { label: 'dsh 版本', value: React.createElement('span', { className: 'vu-version' }, pending ? '获取中…' : (infoFailed ? '获取失败' : (info.localVersion || '未知'))) }),
					React.createElement(InfoRow, { label: '当前渠道', value: pending ? '获取中…' : (infoFailed ? '—' : (localChannel === null ? '—' : channelLabel(localChannel) + (localChannel === 'alpha' ? '（预发布）' : ''))) }),
					React.createElement(InfoRow, { label: '安装路径', value: pending ? '获取中…' : (infoFailed ? '—' : (info.installPath || '未知')) }),
					React.createElement(InfoRow, { label: 'Node.js', value: pending ? '获取中…' : (infoFailed ? '—' : (info.nodeVersion || '未知')) }),
					React.createElement(InfoRow, { label: 'npm', value: pending ? '获取中…' : (infoFailed ? '—' : (info.npmVersion || '未知')) }),
					React.createElement(InfoRow, { label: '操作系统', value: pending ? '获取中…' : (infoFailed ? '—' : ((info.platform || '未知') + (info.arch ? ' ' + info.arch : ''))) }),
					React.createElement(InfoRow, { label: '数据目录', value: pending ? '获取中…' : (infoFailed ? '—' : (info.dshHome || '未知')) }),
					React.createElement(InfoRow, { label: '上次检查', value: formatTime(checkedAt) }),
					debugText !== null && React.createElement('p', { className: 'vu-meta' }, '诊断：' + debugText),
				),

				React.createElement('div', { className: 'vu-card' },
					React.createElement('div', { className: 'vu-cardHead' },
						React.createElement('h3', { className: 'vu-cardTitle' }, '检查更新'),
						React.createElement('button', {
							className: 'vu-btn vu-btn-primary',
							onClick: checkChannels,
							disabled: phase === 'checking'
						}, phase === 'checking' ? '检查中…' : '检查更新'),
					),
					React.createElement('p', { className: 'vu-meta' },
						'点击「检查更新」同时查询两个渠道：官方正式版（npm registry.npmjs.org 的 latest 标签）与 Alpha 预览版（alpha 标签）。'),
					React.createElement(ChannelBlock, {
						channel: 'stable',
						result: channels.stable,
						localVersion: localVersion,
						localChannel: localChannel,
						checking: phase === 'checking',
						copied: copiedKey === 'stable',
						onCopy: (text) => copyPrompt('stable', text),
						onRetry: checkChannels,
					}),
					React.createElement(ChannelBlock, {
						channel: 'alpha',
						result: channels.alpha,
						localVersion: localVersion,
						localChannel: localChannel,
						checking: phase === 'checking',
						copied: copiedKey === 'alpha',
						onCopy: (text) => copyPrompt('alpha', text),
						onRetry: checkChannels,
					}),
				),

				React.createElement('div', { className: 'vu-card' },
					React.createElement('h3', { className: 'vu-cardTitle' }, '版本历史'),
					historyPhase === 'idle' && React.createElement('div', { className: 'vu-cardHead' },
						React.createElement('p', { className: 'vu-meta' }, '查看官方发布的各版本更新说明（GitHub Releases）。'),
						React.createElement('button', { className: 'vu-btn', onClick: loadHistory }, '加载历史版本'),
					),
					historyPhase === 'loading' && React.createElement('p', { className: 'vu-meta' }, '正在获取官方发布记录 …'),
					historyPhase === 'error' && React.createElement('p', { className: 'vu-status vu-status-error' }, '获取失败：' + (historyError || '未知错误'), ' ',
						React.createElement('button', { className: 'vu-btn', onClick: loadHistory }, '重试')),
					historyPhase === 'ready' && React.createElement('div', { className: 'vu-filters' },
						CHANNEL_ORDER.map((key) => React.createElement('button', {
							key: key,
							className: 'vu-btn' + (historyFilter === key ? ' vu-btn-on' : ''),
							onClick: () => setHistoryFilter(key),
						}, key === ALL_CHANNEL ? '全部' : channelLabel(key))),
					),
					historyPhase === 'ready' && historyItems.length === 0 && React.createElement('p', { className: 'vu-meta' }, '暂无发布记录。'),
					historyPhase === 'ready' && historyItems.length > 0 && shownHistory.length === 0 && React.createElement('p', { className: 'vu-meta' }, '该渠道暂无发布记录。'),
					historyPhase === 'ready' && shownHistory.length > 0 && React.createElement('ul', { className: 'vu-list' },
						shownHistory.map((item) => React.createElement('li', { key: item.version, className: 'vu-item' },
							React.createElement('div', { className: 'vu-row' },
								React.createElement('span', { className: 'vu-itemVersion' }, item.version),
								React.createElement('span', { className: 'vu-tag' + (channelOf(item.version) === 'alpha' ? ' vu-tag-alpha' : '') },
									channelOf(item.version) === 'alpha' ? 'Alpha' : '正式版'),
								React.createElement('span', { className: 'vu-meta' }, formatDate(item.publishedAt)),
							),
							item.summary !== '' && React.createElement('p', { className: 'vu-itemSummary' }, item.summary),
							React.createElement('a', { className: 'vu-link', href: item.url, target: '_blank', rel: 'noreferrer' }, '查看完整说明 ↗'),
						)),
					),
				),
			);
		}

		async function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			// Own every registration through ctx.effect so an entry unload
			// (HMR refresh / plugin removal) disposes styles, the remote
			// namespace, and the settings section (mirrors the
			// dsh-file-explorer pattern).
			ctx.effect(function installCss() {
				return insertCss(CSS);
			});

			// Mount the remote namespace BEFORE registering UI so section calls
			// resolve immediately.
			try {
				const disposeMount = await ctx.remote.$mount(CONTRIBUTION);
				ctx.effect(function ownMount() {
					return () => {
						try { disposeMount(); } catch (err) {}
					};
				});
			} catch (err) {
				console.error("[dsh-version-update] remote namespace mount failed:", err);
				return;
			}

			// Remote namespace methods resolve to { ok, value } envelopes; unwrap
			// them before the UI consumes the results (mirrors the file-explorer
			// pattern). Never access `ctx.remote.versionUpdate` as a property —
			// that path resolves through the caller fiber's ancestry and throws for
			// a namespace mounted by this very entry; `ctx.get()` reads the shared
			// store directly.
			function unwrap(result) {
				if (result && result.ok === true) return result.value;
				const error = result && result.error;
				throw new Error((error && error.message) || "versionUpdate remote call failed");
			}
			function call(method) {
				const args = Array.prototype.slice.call(arguments, 1);
				return Promise.resolve().then(() => {
					const ns = ctx.get("remote.versionUpdate");
					if (ns === undefined) throw new Error("versionUpdate namespace unavailable");
					return ns[method].apply(ns, args);
				}).then(unwrap);
			}
			function remote() {
				return {
					info: () => call("info"),
					checkChannels: () => call("checkChannels"),
					releases: () => call("releases")
				};
			}

			ctx.effect(function installSection() {
				return slots.inject("settings.section", () => slots.register(
					{ name: "settings.section", id: "version-update", order: 30, label: "版本与更新" },
					(props) => React.createElement(VersionUpdateSection, { ...props, remote }),
				));
			});
		}

		const inject = ["slots", "remote"];
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
