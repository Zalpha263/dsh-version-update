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
//   "update"       - the channel has a newer version; upgrade prompt available
//   "current"      - the local version IS the channel's newest
//   "ahead"        - the local version is newer than this channel's newest
//   "switch"       - the stable target is OLDER than the running alpha build,
//                    yet the block still offers the switch-back prompt: an
//                    alpha user must always be able to return to the stable
//                    line, explicitly labelled as a rollback, never hidden
//   "uncomparable" - a version is missing or unparseable; never guess
//
// Ordering is plain semver precedence, prerelease order included. While the
// running build is an ALPHA, a stable target that outranks it — a newer rc, a
// final release, or a newer core line — IS an update and must offer the switch
// back to the stable line. The old "same core is not an update" guard was
// wrong: it hid v0.1.7-rc.1 from a v0.1.7-alpha.2 install even though semver
// ranks rc.1 above alpha.2 and the stable line had already moved on.
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
	if (cmp > 0) return { kind: "update", canPrompt: true };
	if (channel === "stable" && localChannel === "alpha") return { kind: "switch", canPrompt: true };
	return { kind: "ahead", canPrompt: false };
}

// --- Upgrade prompts (plain string concatenation: no template literals so the
// --- region stays trivially extractable by the drift guard) ---
function chooseChannel(promptChannel, version) {
	if (promptChannel === "alpha" || promptChannel === "stable") return promptChannel;
	return channelOf(version) || "stable";
}

// Official stable channel: exact pinned version, plus a rollback command.
// Three shapes, chosen from what is actually known:
//   * local build is a known ALPHA → this also changes the release LINE
//     (alpha → stable); say so, and say which way the version moves instead of
//     calling every alpha→stable move a "downgrade" (0.1.7-rc.1 outranks
//     0.1.7-alpha.2);
//   * local build is a known stable release → the plain upgrade steps;
//   * local build is UNKNOWN/unparseable → stay neutral: switch to the pinned
//     version, never claim it is an upgrade, and make the agent confirm the
//     running version first. The stable block must stay actionable, because
//     "return to the stable line at any time" cannot depend on version
//     detection succeeding.
function buildStablePrompt(input) {
	var target = input.target;
	var knownLocal = typeof input.localVersion === "string" && input.localVersion !== "" ? input.localVersion : null;
	var localVersion = knownLocal === null ? "未知" : knownLocal;
	var localChannel = chooseChannel(input.localChannel, knownLocal);
	var fromAlpha = localChannel === "alpha";
	var step = 2;
	var lines = knownLocal === null
		? [
			"请帮我把 dsh（DeepSeek Harness）切换到官方正式版 " + target + "：",
			"1. 本机版本未能识别，无法判断这是升级还是降级；请先运行 dsh --version 记录当前版本与渠道，以便回退"
		]
		: [
			"请帮我升级 dsh（DeepSeek Harness）的官方正式版到 " + target + "：",
			"1. 升级前记录：当前版本 " + localVersion + "，当前渠道 " + channelLabel(localChannel)
		];
	if (fromAlpha) {
		var lineCmp = compareVersions(target, localVersion);
		lines.push(step + ". 这会把你从 Alpha 预览线路切回官方正式版线路（覆盖安装同一个全局包；" +
			(lineCmp !== null && lineCmp > 0 ? "目标版本高于当前 Alpha，属于升级" : "目标版本低于当前 Alpha，属于降级/回退") + "）");
		step += 1;
	}
	lines.push(step + ". 官方安装命令（会覆盖安装同名的全局包）：npm install -g @deepseek-ai/dsh@" + target);
	step += 1;
	lines.push(step + ". 升级后运行 dsh --version，确认输出为 " + target);
	step += 1;
	lines.push(step + ". 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）使新版本生效");
	lines.push("注意：必须使用上面的精确版本号（不要用 @latest）；");
	lines.push("升级只替换全局安装的 @deepseek-ai/dsh 包，不影响 $DSH_HOME（~/.dsh）下的配置、会话与插件数据。");
	if (knownLocal === null) {
		lines.push("如果升级后出现异常，请先确认升级前的实际版本，再执行：npm install -g @deepseek-ai/dsh@<升级前版本>");
	} else {
		lines.push("如果升级后出现异常，回退命令：npm install -g @deepseek-ai/dsh@" + localVersion);
	}
	return lines.join("\n");
}

// Alpha preview channel: same pinned install, plus a short pre-release warning
// and the path back to the stable line. Deliberately NO backup step: the
// install only replaces the global package and does not touch $DSH_HOME (the
// closing line says so), so a numbered "back up first" instruction contradicted
// the rest of the prompt.
function buildAlphaPrompt(input) {
	var target = input.target;
	var localVersion = input.localVersion || "未知";
	var localChannel = chooseChannel(input.localChannel, input.localVersion);
	var switching = localChannel !== "alpha";
	var step = 3;
	var lines = [
		"请帮我安装/升级 dsh（DeepSeek Harness）的 Alpha 预览版 " + target + "：",
		"1. 升级前记录：当前版本 " + localVersion + "，当前渠道 " + channelLabel(localChannel),
		"2. 这是官方开发者预览通道，正在快速迭代，可能包含破坏兼容性的变更（会话日志格式、插件 API、设置存储方式等）。"
	];
	if (switching) {
		lines.push(step + ". 这会把你从正式版线路切换到 Alpha 预览线路（覆盖安装同一个全局包，不是并行安装）");
		step += 1;
	}
	lines.push(step + ". 官方安装命令（会覆盖安装当前版本）：npm install -g @deepseek-ai/dsh@" + target);
	step += 1;
	lines.push(step + ". 升级后运行 dsh --version，确认输出为 " + target);
	step += 1;
	lines.push(step + ". 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）使新版本生效");
	step += 1;
	lines.push(step + ". 如遇到插件或会话异常，回退到官方正式版：");
	lines.push("   npm install -g @deepseek-ai/dsh@<正式版精确版本号>");
	lines.push("注意：必须使用上面的精确版本号（不要用 @alpha 或 @latest）；");
	lines.push("升级只替换全局安装的 @deepseek-ai/dsh 包，不影响 $DSH_HOME 下的配置、会话与插件数据。");
	return lines.join("\n");
}

// One-line prompt to go back to the stable line from an alpha install, or from
// a build that has moved ahead of the stable channel. The origin line changes
// the wording: only an alpha install is "switching back from the Alpha line".
function buildRollbackPrompt(input) {
	var currentVersion = input.currentVersion || "未知";
	var currentChannel = chooseChannel(input.currentChannel, input.currentVersion);
	var fromAlpha = currentChannel === "alpha";
	var lines = [
		fromAlpha
			? "请帮我把 dsh（DeepSeek Harness）从上一条 Alpha 线路切回官方正式版 " + input.target + "："
			: "请帮我把 dsh（DeepSeek Harness）回退到正式版渠道当前版本 " + input.target + "：",
		"1. 升级前记录：当前版本 " + currentVersion + "，当前渠道 " + channelLabel(currentChannel),
		fromAlpha
			? "2. 这是降级/回退操作（覆盖安装同一个全局包）：npm install -g @deepseek-ai/dsh@" + input.target
			: "2. 本机版本高于渠道当前版本，这是降级/回退操作（覆盖安装同一个全局包）：npm install -g @deepseek-ai/dsh@" + input.target,
		"3. 运行 dsh --version，确认输出为 " + input.target,
		"4. 确认后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）",
		"注意：必须使用精确版本号；$DSH_HOME 下的配置、会话与插件数据不会被这次覆盖安装改动。"
	];
	return lines.join("\n");
}

// --- Per-channel display model (single source of truth for the two blocks) ---
// Keep every threshold and every string here; the UI only renders this shape.
//
// sourceTag / altLatest carry the RESOLUTION PROVENANCE of the target: the
// host picks each channel's newest version from every npm dist-tag of that
// channel, so the number shown can legitimately differ from the npm latest
// tag (stable line: latest = 0.1.5-rc.3 while the newer rc 0.1.7-rc.1 is
// published under next). The note explaining that difference is derived HERE,
// next to the decision, so block text and decision cannot drift apart.
function channelView(input) {
	var channel = input.channel;
	var target = typeof input.target === "string" && input.target !== "" ? input.target : null;
	var localVersion = typeof input.localVersion === "string" && input.localVersion !== "" ? input.localVersion : null;
	var localChannel = input.localChannel || null;
	var sourceTag = typeof input.sourceTag === "string" && input.sourceTag !== "" ? input.sourceTag : null;
	var altLatest = typeof input.altLatest === "string" && input.altLatest !== "" ? input.altLatest : null;
	var base = { version: target, decision: null, statusKind: "muted", status: "", note: null, prompt: null, promptLabel: null };
	if (target === null) return base;
	if (channel === "stable" && sourceTag !== null && sourceTag !== "latest" && altLatest !== null && altLatest !== target) {
		base.note = "该版本取自 npm 的 " + sourceTag + " 标签；latest 标签当前为 v" + altLatest +
			"。正式版线按「所有正式版标签中版本最高者」判定，与版本历史口径一致。";
	}
	var decision = decideChannel({ localVersion: localVersion, localChannel: localChannel, channel: channel, target: target });
	base.decision = decision.kind;
	if (decision.kind === "uncomparable") {
		if (channel !== "stable") {
			base.status = "已获取 " + target + "；本机版本未知或无法解析，无法对比（见上方基本信息与诊断）。";
			return base;
		}
		// The stable block stays actionable even when version detection failed:
		// the target is known, so the user can still pin it.
		base.status = "已获取 " + target + "；本机版本未知或无法解析，无法判断是升级还是回退（见上方基本信息与诊断）。可复制下方提示词直接切换到该版本。";
		base.promptLabel = "切换提示词（复制后粘贴给 DeepSeek）";
		base.prompt = buildStablePrompt({ localVersion: localVersion, localChannel: localChannel, target: target });
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
			? "正式版线已发布 v" + target + "，高于当前 Alpha v" + localVersion + "；可切回正式版线路（覆盖安装、属于升级）"
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
	if (decision.kind === "switch") {
		base.status = "本机运行的是 Alpha 预览版 v" + localVersion + "；正式版线当前为 v" + target +
			"。可随时切回正式版线路（回退操作），复制下方提示词即可。";
		base.promptLabel = "切回正式版提示词（复制后粘贴给 DeepSeek）";
		base.prompt = buildRollbackPrompt({ target: target, currentVersion: localVersion, currentChannel: localChannel });
		return base;
	}
	// ahead — the running build leads this channel.
	if (channel === "alpha") {
		base.status = "本机 v" + localVersion + " 已领先 alpha 渠道的 v" + target + "（无需操作）。";
		return base;
	}
	// The stable block still offers the way back to the channel's version: a
	// build ahead of the stable channel (hand-installed or from a newer line)
	// must be able to return to the exact published stable version.
	base.status = "本机 v" + localVersion + " 已领先正式版渠道的 v" + target +
		"（渠道当前最高版本）。如需回到渠道当前版本，可复制下方提示词。";
	base.promptLabel = "切回渠道版本提示词（复制后粘贴给 DeepSeek）";
	base.prompt = buildRollbackPrompt({ target: target, currentVersion: localVersion, currentChannel: localChannel });
	return base;
}
/*__VERSION_END__*/

// --- Host-side channel resolution (host only; outside the shared region) -----
//
// THE BUG THIS FIXES: "检查更新" resolved the stable channel from ONE tag
// (`latest` = 0.1.5-rc.3) while the release history listed every published
// release (newest stable-classified release = 0.1.7-rc.1), so the same question
// — "what is the newest official stable version?" — got two different answers.
// During a preview cycle npm keeps `latest` on the promoted stable release while
// the NEXT stable line ships under `next`, so a single tag is not a channel.
//
// npm dist-tags stay the authority (a version that exists only in the release
// notes cannot be installed), but a channel's target is the highest version
// among ALL tags classified into that channel. This is what makes the update
// check agree with the release history.
function newestByChannel(entries) {
	var best = { stable: null, alpha: null };
	if (!Array.isArray(entries)) return best;
	for (var i = 0; i < entries.length; i += 1) {
		var entry = entries[i];
		if (entry === null || typeof entry !== "object") continue;
		if (typeof entry.version !== "string") continue;
		var channel = channelOf(entry.version);
		if (channel === null) continue;
		var candidate = { tag: typeof entry.tag === "string" ? entry.tag : null, version: entry.version };
		var current = best[channel];
		if (current === null) { best[channel] = candidate; continue; }
		var cmp = compareVersions(entry.version, current.version);
		if (cmp !== null && cmp > 0) best[channel] = candidate;
	}
	return best;
}

// Shape the per-channel result the Remote method returns and channelView()
// consumes: { version, sourceTag, latestVersion, error }.
function resolveChannelResults(entries) {
	var best = newestByChannel(entries);
	var list = Array.isArray(entries) ? entries : [];
	var latestVersion = null;
	for (var i = 0; i < list.length; i += 1) {
		var entry = list[i];
		if (entry === null || typeof entry !== "object") continue;
		if (entry.tag === "latest" && typeof entry.version === "string") latestVersion = entry.version;
	}
	var stable = best.stable;
	var alpha = best.alpha;
	return {
		stable: {
			tag: "stable",
			version: stable === null ? null : stable.version,
			sourceTag: stable === null ? null : stable.tag,
			latestVersion: latestVersion,
			error: stable === null ? "npm dist-tags 中没有可解析的正式版版本" : null
		},
		alpha: {
			tag: "alpha",
			version: alpha === null ? null : alpha.version,
			sourceTag: alpha === null ? null : alpha.tag,
			latestVersion: null,
			error: alpha === null ? "npm dist-tags 中没有可解析的 Alpha 版本" : null
		}
	};
}

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
	channelView,
	newestByChannel,
	resolveChannelResults
};
