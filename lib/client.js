// dsh-version-update — Client half (persistent, web module-loader format).
//
// Registers the `settings.section` entry "版本与更新" with the full UI
// (local version/environment facts, update check against the official npm
// registry, upgrade prompt + copy button), calling the Host through the
// `remote.versionUpdate` namespace mounted by THIS entry (never list it in
// `inject` — that would deadlock the entry).

window.__ModuleLoader__.load({
	id: "dsh-version-update",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		/** Package-owned <style> host — the persistent client has no `styles` builtin. */
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
`;

		// --- Remote namespace contribution --------------------------------------
		// The `remote.versionUpdate` namespace is mounted by THIS entry; it
		// must therefore never appear in `inject`. Codecs are "strict" with
		// passthrough schemas: the client-side Gateway only calls
		// `codec.schema.parse(value)`; the Host Gateway validates via SRC markers.
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

		// --- Semver comparison (no dependency) ---------------------------------
		// Parse `x.y.z[-prerelease]` (optional leading `v`) and compare with
		// semver ordering: numeric identifiers compare numerically, a
		// prerelease sorts before its release, and prerelease identifiers
		// compare numeric-before-alphanumeric. Returns -1 / 0 / 1, or null
		// when either side does not parse (callers treat null as
		// "cannot determine" and show a neutral hint instead of guessing).
		const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
		function parseVersion(v) {
			if (typeof v !== 'string') return null;
			const m = SEMVER_RE.exec(v.trim());
			if (m === null) return null;
			return {
				major: Number(m[1]),
				minor: Number(m[2]),
				patch: Number(m[3]),
				prerelease: m[4] === undefined ? null : m[4].split('.')
			};
		}
		function compareVersions(a, b) {
			const pa = parseVersion(a);
			const pb = parseVersion(b);
			if (pa === null || pb === null) return null;
			for (const key of ['major', 'minor', 'patch']) {
				if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
			}
			// Equal core: none < prerelease < release (a missing prerelease
			// sorts AFTER one that is present).
			if (pa.prerelease === null && pb.prerelease === null) return 0;
			if (pa.prerelease === null) return 1;
			if (pb.prerelease === null) return -1;
			const max = Math.max(pa.prerelease.length, pb.prerelease.length);
			for (let i = 0; i < max; i += 1) {
				const x = pa.prerelease[i];
				const y = pb.prerelease[i];
				if (x === undefined) return -1;
				if (y === undefined) return 1;
				if (x === y) continue;
				const xn = /^\d+$/.test(x);
				const yn = /^\d+$/.test(y);
				if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
				if (xn) return -1; // numeric identifiers sort before alphanumeric
				if (yn) return 1;
				return x < y ? -1 : 1;
			}
			return 0;
		}

		function InfoRow(props) {
			return React.createElement('div', { className: 'vu-row' },
				React.createElement('span', { className: 'vu-label' }, props.label),
				React.createElement('span', { className: 'vu-value' }, props.value),
			);
		}

		function VersionUpdateSection(props) {
			const { remote } = props;
			const [info, setInfo] = React.useState(null);
			const [infoFailed, setInfoFailed] = React.useState(false);
			const [phase, setPhase] = React.useState('idle'); // idle | checking | done | error
			const [latest, setLatest] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [checkedAt, setCheckedAt] = React.useState(null);
			const [copied, setCopied] = React.useState(false);
			const [historyPhase, setHistoryPhase] = React.useState('idle'); // idle | loading | ready | error
			const [historyItems, setHistoryItems] = React.useState([]);
			const [historyError, setHistoryError] = React.useState(null);

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

			const checkUpdate = () => {
				if (phase === 'checking') return;
				setPhase('checking');
				setError(null);
				setLatest(null);
				const startedAt = Date.now();
				remote().checkUpdate()
					.then((result) => {
						const v = result && typeof result.latest === 'string' && result.latest !== '' ? result.latest : null;
						if (v !== null) {
							setLatest(v);
							setPhase('done');
						} else {
							setError((result && result.error) || '未知错误');
							setPhase('error');
						}
						setCheckedAt(startedAt);
					})
					.catch((err) => {
						setError(String((err && err.message) || err));
						setPhase('error');
						setCheckedAt(startedAt);
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

			const promptText = () => {
				const local = info && info.localVersion ? info.localVersion : '未知';
				const target = latest || '未知';
				return '请帮我升级 dsh（DeepSeek Harness）到最新版本：\n' +
					'1. 当前版本：' + local + '，最新版本：' + target + '\n' +
					'2. 官方更新方式：执行 npm install -g @deepseek-ai/dsh@latest\n' +
					'3. 升级完成后运行 dsh --version 验证输出为 ' + target + '\n' +
					'4. 验证后提醒我彻底重启 dsh web（关掉旧 node 进程再启动）使新版本生效\n' +
					'注意：升级只替换全局安装的 @deepseek-ai/dsh 包，不影响 $DSH_HOME（~/.dsh）下的配置、会话与插件数据';
			};

			const copyPrompt = () => {
				const text = promptText();
				const done = () => {
					setCopied(true);
					window.setTimeout(() => setCopied(false), 2000);
				};
				const fallback = () => {
					// clipboard API 不可用或被拒：退回 execCommand('copy')
					const el = document.querySelector('.vu-prompt');
					if (el) {
						try {
							el.select();
							if (document.execCommand && document.execCommand('copy')) { done(); return; }
						} catch (e) { /* fall through */ }
					}
					// 仍失败：至少让用户看到选中状态可手动 Ctrl+C
					try { if (el) el.select(); } catch (e) {}
				};
				if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text).then(done).catch(fallback);
				} else {
					fallback();
				}
			};

			const pending = info === null && !infoFailed;
			// 更新判定按 semver 语义比较；本地版本缺失或无法解析时（cmp ===
			// null）既不报"已是最新"也不报"发现新版本"，只显示中性提示——
			// 误报方向比漏报更伤（会给出错误的升级/降级建议）。
			const localVersion = info && typeof info.localVersion === 'string' && info.localVersion !== '' ? info.localVersion : null;
			const cmp = phase === 'done' && latest !== null && localVersion !== null ? compareVersions(latest, localVersion) : null;
			const showUpdate = cmp !== null && cmp > 0;
			const showUpToDate = cmp !== null && cmp <= 0;
			const showUnknownLocal = phase === 'done' && latest !== null && cmp === null;
			const debugText = info && typeof info.debug === 'string' && info.debug !== '' ? info.debug : null;

			return React.createElement('div', { className: 'vu-section' },
				React.createElement('h2', { className: 'vu-title' }, '版本与更新'),
				React.createElement('p', { className: 'vu-intro' },
					'查看当前 dsh 版本与环境信息，检查 npm 官方最新版本。发现新版本后可复制升级提示词，交给 DeepSeek 执行升级。'),

				React.createElement('div', { className: 'vu-card' },
					React.createElement('h3', { className: 'vu-cardTitle' }, '基本信息'),
					React.createElement(InfoRow, { label: 'dsh 版本', value: React.createElement('span', { className: 'vu-version' }, pending ? '获取中…' : (infoFailed ? '获取失败' : (info.localVersion || '未知'))) }),
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
							onClick: checkUpdate,
							disabled: phase === 'checking'
						}, phase === 'checking' ? '检查中…' : '检查更新'),
					),
					phase === 'idle' && React.createElement('p', { className: 'vu-meta' }, '点击「检查更新」查询 npm 官方最新版本（registry.npmjs.org）。'),
					phase === 'checking' && React.createElement('p', { className: 'vu-meta' }, '正在连接 npm registry …'),
					phase === 'error' && React.createElement('p', { className: 'vu-status vu-status-error' }, '检查失败：' + (error || '未知错误'), ' ',
						React.createElement('button', { className: 'vu-btn', onClick: checkUpdate }, '重试')),
					phase === 'done' && showUpToDate && React.createElement('p', { className: 'vu-status vu-status-ok' }, '当前已是最新版本 v' + latest),
					phase === 'done' && showUpdate && React.createElement('div', { className: 'vu-card', style: { borderColor: 'var(--dsw-alias-state-warn-primary)' } },
						React.createElement('p', { className: 'vu-status vu-status-update' }, '发现新版本 v' + latest + '（当前 v' + localVersion + '）'),
						React.createElement('p', { className: 'vu-promptLabel' }, '升级提示词（复制后粘贴给 DeepSeek）'),
						React.createElement('textarea', { className: 'vu-prompt', readOnly: true, value: promptText() }),
						React.createElement('div', { className: 'vu-actions' },
							React.createElement('button', { className: 'vu-btn vu-btn-primary', onClick: copyPrompt }, copied ? '已复制 ✓' : '复制提示词'),
						),
					),
					phase === 'done' && showUnknownLocal && React.createElement('p', { className: 'vu-meta' }, '已获取最新版本 v' + latest + '；本地版本未知，无法对比（见上方基本信息与诊断）。'),
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
					historyPhase === 'ready' && historyItems.length === 0 && React.createElement('p', { className: 'vu-meta' }, '暂无发布记录。'),
					historyPhase === 'ready' && historyItems.length > 0 && React.createElement('ul', { className: 'vu-list' },
						historyItems.map((item) => React.createElement('li', { key: item.version, className: 'vu-item' },
							React.createElement('div', { className: 'vu-row' },
								React.createElement('span', { className: 'vu-itemVersion' }, item.version),
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
					checkUpdate: () => call("checkUpdate"),
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
