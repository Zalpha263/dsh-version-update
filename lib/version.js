// dsh-version-update — pure version/channel/prompt logic (ESM, no side effects).
//
// WHY THIS FILE EXISTS
// The DSH client module loader registers exactly ONE factory per plugin package
// (the "dsh-version-update/client" entry); the synchronous require handed to that
// factory resolves only platform seed words and already-materialized entries, so
// "lib/client.js" CANNOT require("./version.js") at runtime. The shipped runtime
// logic therefore stays inline in lib/client.js, and this file is the testable
// owner of the same pure functions.
//
// DRIFT GUARD: test/version.test.mjs extracts the region delimited by
// __VERSION_BEGIN__ / __VERSION_END__ inside lib/client.js and asserts it is
// byte-identical (whitespace-insensitive) to the same region here. Never edit one
// side alone — the unit test fails loudly when they diverge.
//
// Everything inside the region must be pure JavaScript with NO imports, NO
// template literals, and NO dependency on React or the DOM.

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

export {
	SEMVER_RE,
	parseVersion,
	compareVersions,
	channelOf,
	channelLabel,
	decideChannel,
	chooseChannel,
	buildStablePrompt,
	buildAlphaPrompt,
	buildRollbackPrompt,
	channelView
};
