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
// back to the stable line. A "same core is not an update" rule would hide such
// a target even though semver ranks rc.1 above alpha.2 and the stable line has
// already moved on.
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

// --- Prompt target -----------------------------------------------------------
// WHICH update steps apply depends on how dsh was installed, not only on the
// version. The desktop app bundles its dsh runtime inside the app (app.asar)
// and updates through the desktop shell; the npm-global command replaces the
// CLI package, which a running desktop app never reads. A CLI / npm-global
// install keeps the pinned 「npm install -g」 steps. When the source is unknown
// both routes are offered, each labelled, instead of guessing one.
//
// installEnvironment is the Host's authoritative answer ("desktop" | "cli");
// installSource / installPath are fallbacks for callers that only know which
// probe answered (a Host built before installEnvironment existed).
function promptTargetOf(installSource, installEnvironment, installPath) {
	if (installEnvironment === "desktop" || installEnvironment === "cli") return installEnvironment;
	if (installSource === "desktopApp") return "desktop";
	if (installSource === "pluginPackages" && typeof installPath === "string" && /app\.asar/i.test(installPath)) return "desktop";
	if (installSource === "clientModules" || installSource === "require" || installSource === "npmRoot") return "cli";
	return "unknown";
}

// The numbered step that explains an alpha→stable line switch. "how" names the
// mechanism actually used: an npm-global install overwrites one global package,
// a desktop update happens inside the app, an unknown source may be either.
function lineSwitchStep(step, target, localVersion, mode) {
	var lineCmp = compareVersions(target, localVersion);
	var how = mode === "desktop"
		? "应用内更新"
		: mode === "unknown" ? "按实际安装方式更新" : "覆盖安装同一个全局包";
	return step + ". 这会把你从 Alpha 预览线路切回官方正式版线路（" + how + "；" +
		(lineCmp !== null && lineCmp > 0 ? "目标版本高于当前 Alpha，属于升级" : "目标版本低于当前 Alpha，属于降级/回退") + "）";
}

// Official stable channel: exact pinned version, plus a rollback command.
// The desktop / unknown branches keep the same shape and honesty rules:
//   * a known ALPHA local build switches the release LINE (alpha → stable);
//     say so, and say which way the version moves instead of calling every
//     alpha→stable move a "downgrade" (an rc outranks an alpha of the same core);
//   * an UNKNOWN local build stays neutral: switch to the pinned version,
//     never claim it is an upgrade, and make the agent record the running
//     version first, because "return to the stable line at any time" cannot
//     depend on version detection succeeding;
//   * the install steps name the updater that actually applies: pinned npm
//     install for a CLI/npm-global tree, the in-app 「检查更新…」 for a desktop
//     app, both (labelled) when the source is unknown.
function buildStablePrompt(input) {
	var target = input.target;
	var knownLocal = typeof input.localVersion === "string" && input.localVersion !== "" ? input.localVersion : null;
	var localVersion = knownLocal === null ? "未知" : knownLocal;
	var localChannel = chooseChannel(input.localChannel, knownLocal);
	var fromAlpha = localChannel === "alpha";
	var mode = promptTargetOf(input.installSource, input.installEnvironment, input.installPath);
	var step = 2;
	var lines;
	if (knownLocal === null) {
		lines = mode === "desktop"
			? [
				"请帮我在 DeepSeek Harness 桌面应用内把 dsh 切换到官方正式版 " + target + "：",
				"1. 本机版本未能识别，无法判断这是升级还是降级；请先在桌面应用内「设置 → 版本与更新」记录当前版本，以便回退"
			]
			: [
				"请帮我把 dsh（DeepSeek Harness）切换到官方正式版 " + target + "：",
				mode === "unknown"
					? "1. 本机版本未能识别，无法判断这是升级还是降级；请先运行 dsh --version 或在桌面应用内查看当前版本并记录，以便回退"
					: "1. 本机版本未能识别，无法判断这是升级还是降级；请先运行 dsh --version 记录当前版本与渠道，以便回退"
			];
	} else {
		lines = mode === "desktop"
			? [
				"请帮我在 DeepSeek Harness 桌面应用内把 dsh 更新到官方正式版 " + target + "：",
				"1. 更新前记录：当前版本 " + localVersion + "，当前渠道 " + channelLabel(localChannel)
			]
			: [
				"请帮我升级 dsh（DeepSeek Harness）的官方正式版到 " + target + "：",
				"1. 升级前记录：当前版本 " + localVersion + "，当前渠道 " + channelLabel(localChannel)
			];
	}
	if (fromAlpha) {
		lines.push(lineSwitchStep(step, target, localVersion, mode));
		step += 1;
	}
	if (mode === "desktop") {
		lines.push(step + ". 桌面版 dsh 的运行时内置于桌面应用（app.asar），更新由桌面应用本身完成：请在应用菜单中打开「检查更新…」，按提示下载并安装；如果应用内暂时没有 " + target + "，请等待桌面壳发布对应版本后再更新");
		step += 1;
		lines.push(step + ". 安装完成后按应用提示退出并重新打开桌面应用，在应用内「设置 → 版本与更新」确认版本为 " + target + "（桌面版以应用内版本为准，不要用命令行的 dsh --version 判断）");
		step += 1;
		lines.push(step + ". 不要用 npm 全局安装命令更新桌面应用：npm -g 只更新命令行 CLI，不会更新桌面应用内的运行时");
		lines.push("注意：桌面更新会替换整个应用（含内置运行时），不影响 $DSH_HOME（~/.dsh）下的配置、会话与插件数据。");
		if (knownLocal === null) {
			lines.push("如果更新后出现异常，请先确认更新前的实际版本，再在应用内安装/切换到该版本的桌面安装包。");
		} else {
			lines.push("如果更新后出现异常，请在应用内安装/切换回 " + localVersion + " 版本的桌面安装包，不要用 npm 全局安装覆盖桌面运行时。");
		}
		return lines.join("\n");
	}
	if (mode === "unknown") {
		lines.push(step + ". 未能识别 dsh 的安装来源，请按实际运行方式二选一（不要同时执行）：");
		lines.push("   - 桌面应用内运行：在应用菜单中打开「检查更新…」，按提示完成更新，并在应用内确认版本");
		lines.push("   - npm 全局安装（命令行 CLI / dsh web）：npm install -g @deepseek-ai/dsh@" + target + "，然后运行 dsh --version 确认");
		step += 1;
		lines.push(step + ". 更新后重启对应的宿主：桌面应用需退出后重新打开；dsh web 需关掉旧 node 进程再启动");
		lines.push("注意：npm 全局安装必须使用上面的精确版本号（不要用 @latest）；");
		lines.push("npm 全局安装只替换全局包，桌面更新会替换整个应用；两者都不影响 $DSH_HOME（~/.dsh）下的配置、会话与插件数据。");
		if (knownLocal === null) {
			lines.push("如果更新后出现异常，请先确认更新前的实际版本再回退：npm 全局安装用 npm install -g @deepseek-ai/dsh@<升级前版本>；桌面应用请在应用内安装/切换回旧版本桌面安装包。");
		} else {
			lines.push("如果更新后出现异常：npm 全局安装的回退命令是 npm install -g @deepseek-ai/dsh@" + localVersion + "；桌面应用请在应用内安装/切换回 " + localVersion + " 版本的桌面安装包。");
		}
		return lines.join("\n");
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

// Alpha preview channel: the same channel warning and path back to the stable
// line in every mode. Deliberately NO backup step: an npm-global install only
// replaces the global package and a desktop update only replaces the app, and
// neither touches $DSH_HOME (the closing line says so), so a numbered "back up
// first" instruction would contradict the rest of the prompt.
function buildAlphaPrompt(input) {
	var target = input.target;
	var localVersion = input.localVersion || "未知";
	var localChannel = chooseChannel(input.localChannel, input.localVersion);
	var switching = localChannel !== "alpha";
	var mode = promptTargetOf(input.installSource, input.installEnvironment, input.installPath);
	var step = 3;
	var lines = [
		mode === "desktop"
			? "请帮我在 DeepSeek Harness 桌面应用内安装/升级到 Alpha 预览版 " + target + "："
			: "请帮我安装/升级 dsh（DeepSeek Harness）的 Alpha 预览版 " + target + "：",
		"1. 升级前记录：当前版本 " + localVersion + "，当前渠道 " + channelLabel(localChannel),
		"2. 这是官方开发者预览通道，正在快速迭代，可能包含破坏兼容性的变更（会话日志格式、插件 API、设置存储方式等）。"
	];
	if (switching) {
		var how = mode === "desktop" ? "应用内更新" : mode === "unknown" ? "按实际安装方式更新" : "覆盖安装同一个全局包";
		lines.push(step + ". 这会把你从正式版线路切换到 Alpha 预览线路（" + how + "，不是并行安装）");
		step += 1;
	}
	if (mode === "desktop") {
		lines.push(step + ". 桌面版 dsh 的运行时内置于桌面应用（app.asar），更新由桌面应用本身完成：请在应用菜单中打开「检查更新…」，按提示下载并安装；如果应用内没有 Alpha / nightly 更新通道，请等待桌面壳发布 Alpha 版本后再更新");
		step += 1;
		lines.push(step + ". 安装完成后按应用提示退出并重新打开桌面应用，在应用内「设置 → 版本与更新」确认版本为 " + target + "（桌面版以应用内版本为准，不要用命令行的 dsh --version 判断）");
		step += 1;
		lines.push(step + ". 不要用 npm 全局安装命令更新桌面应用：npm -g 只更新命令行 CLI，不会更新桌面应用内的运行时");
		step += 1;
		lines.push(step + ". 如遇到插件或会话异常，请在应用内切回官方正式版通道，或安装正式版桌面安装包");
		lines.push("注意：桌面更新会替换整个应用（含内置运行时），不影响 $DSH_HOME 下的配置、会话与插件数据。");
		return lines.join("\n");
	}
	if (mode === "unknown") {
		lines.push(step + ". 未能识别 dsh 的安装来源，请按实际运行方式二选一（不要同时执行）：");
		lines.push("   - 桌面应用内运行：在应用菜单中打开「检查更新…」，把更新通道切到 Alpha 后按提示完成更新");
		lines.push("   - npm 全局安装（命令行 CLI / dsh web）：npm install -g @deepseek-ai/dsh@" + target + "，然后运行 dsh --version 确认");
		step += 1;
		lines.push(step + ". 更新后重启对应的宿主：桌面应用需退出后重新打开；dsh web 需关掉旧 node 进程再启动");
		step += 1;
		lines.push(step + ". 如遇到插件或会话异常：npm 全局安装可回退到官方正式版（npm install -g @deepseek-ai/dsh@<正式版精确版本号>）；桌面应用请在应用内切回正式版通道或安装正式版桌面安装包");
		lines.push("注意：npm 全局安装必须使用上面的精确版本号（不要用 @alpha 或 @latest）；");
		lines.push("npm 全局安装只替换全局包，桌面更新会替换整个应用；两者都不影响 $DSH_HOME 下的配置、会话与插件数据。");
		return lines.join("\n");
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
// The desktop / unknown branches replace the npm step with the updater that
// applies to the running install, keeping the same origin wording.
function buildRollbackPrompt(input) {
	var currentVersion = input.currentVersion || "未知";
	var currentChannel = chooseChannel(input.currentChannel, input.currentVersion);
	var fromAlpha = currentChannel === "alpha";
	var mode = promptTargetOf(input.installSource, input.installEnvironment, input.installPath);
	var opening = fromAlpha
		? "请帮我把 dsh（DeepSeek Harness）从上一条 Alpha 线路切回官方正式版 " + input.target + "："
		: "请帮我把 dsh（DeepSeek Harness）回退到正式版渠道当前版本 " + input.target + "：";
	if (mode === "desktop") {
		var desktopLines = [
			fromAlpha
				? "请帮我在 DeepSeek Harness 桌面应用内从上一条 Alpha 线路切回官方正式版 " + input.target + "："
				: "请帮我在 DeepSeek Harness 桌面应用内把 dsh 回退到正式版渠道当前版本 " + input.target + "：",
			"1. 更新前记录：当前版本 " + currentVersion + "，当前渠道 " + channelLabel(currentChannel),
			"2. 这是降级/回退操作（桌面应用内更新）：请在应用菜单中打开「检查更新…」，按提示安装 " + input.target + "；如果应用内不提供该版本，请安装对应版本的桌面安装包",
			"3. 安装完成后按应用提示退出并重新打开桌面应用，在应用内「设置 → 版本与更新」确认版本为 " + input.target + "（桌面版以应用内版本为准，不要用命令行的 dsh --version 判断）",
			"4. 不要用 npm 全局安装命令更新桌面应用：npm -g 只更新命令行 CLI，不会更新桌面应用内的运行时",
			"注意：桌面更新会替换整个应用（含内置运行时）；$DSH_HOME 下的配置、会话与插件数据不会被这次更新改动。"
		];
		return desktopLines.join("\n");
	}
	if (mode === "unknown") {
		var unknownLines = [
			opening,
			"1. 更新前记录：当前版本 " + currentVersion + "，当前渠道 " + channelLabel(currentChannel),
			fromAlpha
				? "2. 这是降级/回退操作；未能识别 dsh 的安装来源，请按实际运行方式二选一（不要同时执行）："
				: "2. 本机版本高于渠道当前版本，这是降级/回退操作；未能识别 dsh 的安装来源，请按实际运行方式二选一（不要同时执行）：",
			"   - 桌面应用内运行：在应用菜单中打开「检查更新…」，或安装 " + input.target + " 版本的桌面安装包",
			"   - npm 全局安装（命令行 CLI / dsh web）：npm install -g @deepseek-ai/dsh@" + input.target + "，然后运行 dsh --version 确认",
			"3. 更新后重启对应的宿主：桌面应用需退出后重新打开；dsh web 需关掉旧 node 进程再启动",
			"注意：npm 全局安装必须使用精确版本号；$DSH_HOME 下的配置、会话与插件数据不会被这次覆盖安装改动。"
		];
		return unknownLines.join("\n");
	}
	var lines = [
		opening,
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
// channel, so the number shown can legitimately differ from whatever the npm
// "latest" tag points at during a preview cycle (npm keeps "latest" on the
// promoted stable release while the next stable line ships under another tag).
// The note explaining that difference is derived HERE, next to the decision,
// so block text and decision cannot drift apart.
function channelView(input) {
	var channel = input.channel;
	var target = typeof input.target === "string" && input.target !== "" ? input.target : null;
	var localVersion = typeof input.localVersion === "string" && input.localVersion !== "" ? input.localVersion : null;
	var localChannel = input.localChannel || null;
	var sourceTag = typeof input.sourceTag === "string" && input.sourceTag !== "" ? input.sourceTag : null;
	var altLatest = typeof input.altLatest === "string" && input.altLatest !== "" ? input.altLatest : null;
	// Installation facts from info(): which updater the prompts must target.
	// They flow through unchanged, so channelView stays the single owner of the
	// prompt strings (the UI never rebuilds an install instruction itself).
	var installSource = typeof input.installSource === "string" && input.installSource !== "" ? input.installSource : null;
	var installEnvironment = input.installEnvironment === "desktop" || input.installEnvironment === "cli" ? input.installEnvironment : null;
	var installPath = typeof input.installPath === "string" && input.installPath !== "" ? input.installPath : null;
	var mode = promptTargetOf(installSource, installEnvironment, installPath);
	var switchHow = mode === "desktop" ? "应用内更新" : mode === "unknown" ? "按实际安装方式更新" : "覆盖安装";
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
		base.prompt = buildStablePrompt({ localVersion: localVersion, localChannel: localChannel, target: target, installSource: installSource, installEnvironment: installEnvironment, installPath: installPath });
		return base;
	}
	if (decision.kind === "update") {
		if (channel === "alpha") {
			base.statusKind = "update";
			base.status = "发现 Alpha 预览版 v" + target + "（当前 v" + localVersion + "）";
			base.promptLabel = "Alpha 升级提示词（复制后粘贴给 DeepSeek）";
			base.prompt = buildAlphaPrompt({ localVersion: localVersion, target: target, installSource: installSource, installEnvironment: installEnvironment, installPath: installPath });
			return base;
		}
		base.statusKind = "update";
		base.status = localChannel === "alpha"
			? "正式版线已发布 v" + target + "，高于当前 Alpha v" + localVersion + "；可切回正式版线路（" + switchHow + "、属于升级）"
			: "发现新版本 v" + target + "（当前 v" + localVersion + "）";
		base.promptLabel = "升级提示词（复制后粘贴给 DeepSeek）";
		base.prompt = buildStablePrompt({ localVersion: localVersion, localChannel: localChannel, target: target, installSource: installSource, installEnvironment: installEnvironment, installPath: installPath });
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
		base.prompt = buildRollbackPrompt({ target: target, currentVersion: localVersion, currentChannel: localChannel, installSource: installSource, installEnvironment: installEnvironment, installPath: installPath });
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
	base.prompt = buildRollbackPrompt({ target: target, currentVersion: localVersion, currentChannel: localChannel, installSource: installSource, installEnvironment: installEnvironment, installPath: installPath });
	return base;
}
/*__VERSION_END__*/

// --- Host-side channel resolution (host only; outside the shared region) -----
//
// WHY A CHANNEL IS NOT ONE TAG: "检查更新" must agree with the release history.
// Resolving the stable channel from `latest` alone asks "what is the newest
// official stable version?" twice and gets two answers: during a preview cycle
// npm keeps `latest` on the promoted stable release while the NEXT stable line
// ships under `next`. npm dist-tags stay the authority (a version that exists
// only in the release notes cannot be installed), but a channel's target is the
// highest version among ALL tags classified into that channel.
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
	promptTargetOf,
	buildStablePrompt,
	buildAlphaPrompt,
	buildRollbackPrompt,
	channelView,
	newestByChannel,
	resolveChannelResults
};
