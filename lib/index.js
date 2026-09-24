// dsh-version-update — Host half (persistent).
//
// Registers the `versionUpdate` Remote service for the web Client half:
//   1. the TypertRemoteService superclass registers the service via
//      `ctx.reflect.provide` with the wire binding { service, serviceKey,
//      namespace };
//   2. the Remote markers below are applied WITHOUT decorator syntax
//      (Node 24 rejects stage-3 decorators by default) through the manual
//      decorator-context trick, equivalent to `@Remote('name')`.
//
// Methods:
//   - info():        local dsh version / install path / Node / npm / platform /
//                    data dir, plus per-step diagnostics when something fails
//   - checkUpdate(): query the official npm registry dist-tag `latest` for
//                    @deepseek-ai/dsh (kept for older cached client bundles;
//                    the current client calls checkChannels)
//   - checkChannels(): query EVERY dist-tag of @deepseek-ai/dsh in one request
//                    and resolve each channel as its highest classified version
//                    — `latest` alone is NOT the stable channel (during a
//                    preview cycle latest stays on 0.1.5-rc.3 while the next
//                    stable line ships as `next` = 0.1.7-rc.1). One failing
//                    lookup never hides the other channel.
//   - releases():    official GitHub release notes for recent dsh versions
//
// IMPORTANT: the Gateway derives parameter wires from the method SOURCE
// (parameter names must be simple identifiers — no destructuring, defaults,
// or rest), and the client-side contribution matches them positionally.
// All three methods here take no parameters, so the wires stay empty.
//
// Performance notes (audit v1.1.1):
//   - Never run synchronous child processes on the Host event loop:
//     execSync blocks every other plugin for up to its timeout. All
//     command lookups here are async (execFile) and cached per process.
//   - Every outbound fetch carries an AbortController timeout so a network
//     black hole cannot leave the settings page stuck on "检查中…".
//
// Windows note (fix v1.1.2): npm/pnpm on Windows are `.cmd` batch shims and
// `execFile` (CreateProcess, shell:false) cannot launch them — spawning
// `npm` fails with ENOENT and `npm.cmd` with EINVAL. All npm invocations
// therefore run through cmd.exe via `shell: true` on win32. The argument
// lists here are static constants (no user input), so the shell path adds
// no injection surface.

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveChannelResults } from './version.js'

const REGISTRY_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags'
const REGISTRY_DIST_TAG_URL = (tag) => 'https://registry.npmjs.org/@deepseek-ai/dsh/' + tag
const RELEASES_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=10'
const SUMMARY_MAX = 600
const EXEC_TIMEOUT_MS = 15000
const FETCH_TIMEOUT_MS = 15000

// --- Release notes -----------------------------------------------------------

// Turn an official release body into a plain-text summary. The official bodies
// are bilingual `[中文] | [English]` markdown: prefer the Chinese section (from
// the first `<h3 id="cn-...">` heading up to the `---` before the English
// part), strip HTML and markdown markers, then truncate. Bodies without the
// bilingual structure fall back to the whole text through the same pipeline.
// The result is plain text ONLY — never inserted as HTML.
function summarizeBody(body) {
  if (typeof body !== 'string' || body === '') return ''
  let section = body
  const cnStart = body.indexOf('<h3 id="cn-')
  if (cnStart >= 0) {
    const cnEnd = body.indexOf('\n---', cnStart)
    section = cnEnd >= 0 ? body.slice(cnStart, cnEnd) : body.slice(cnStart)
  }
  const lines = []
  for (const raw of section.split(/\r?\n/)) {
    let line = raw.replace(/<[^>]+>/g, '').trim()
    if (line === '') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
      continue
    }
    line = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim()
    // drop the [中文] | [English] navigation line when the fallback path kept it
    if (/^中文\s*\|/.test(line) || /^English\s*\|/.test(line)) continue
    lines.push(line)
  }
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  // Avoid splitting a UTF-16 surrogate pair at the truncation boundary.
  if (text.length > SUMMARY_MAX) {
    let end = SUMMARY_MAX
    const code = text.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end -= 1
    text = text.slice(0, end) + '…'
  }
  return text
}

// --- Outbound fetch with timeout ---------------------------------------------

/** fetch with an AbortController timeout; rejects on timeout. */
async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, Object.assign({}, init, { signal: controller.signal }))
  } finally {
    clearTimeout(timer)
  }
}

/** Build a readable error for a non-2xx response (GitHub 403 = rate limit). */
async function httpError(res, label) {
  let detail = ''
  try {
    const body = await res.json()
    if (body && typeof body.message === 'string') detail = body.message
  } catch (err) { /* non-JSON body */ }
  if (res.status === 403 || res.status === 429) {
    return label + '：请求过于频繁（GitHub API 限流），请稍后再试' + (detail ? '：' + detail : '')
  }
  return label + '：HTTP ' + res.status + (detail ? '（' + detail + '）' : '')
}

async function fetchReleases() {
  const res = await fetchWithTimeout(RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-version-update'
    }
  })
  if (!res.ok) throw new Error(await httpError(res, 'GitHub API 请求失败'))
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('响应格式异常')
  const items = []
  for (const release of data) {
    if (!release || typeof release !== 'object') continue
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    if (tag === '') continue
    items.push({
      version: tag.startsWith('dsh-v') ? tag.slice(4) : tag,
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
      url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/' + encodeURIComponent(tag),
      summary: summarizeBody(release.body)
    })
  }
  return items
}

// --- Local facts (async, cached) ---------------------------------------------

// npm facts cache: `npm -v` / `npm root -g` are expensive (spawn a process);
// cache per process so repeated settings-page loads don't re-spawn. Only
// successful (non-empty) results are cached — a transient failure must be
// retried on the next load instead of poisoning the process lifetime.
let npmVersionCache = null
let npmRootCache = null

/** Run a command async; resolve stdout trimmed; resolve '' on any failure. */
function runCmd(command, args) {
  return new Promise((resolve) => {
    // A blocking sandbox throws SYNCHRONOUSLY out of execFile (EPERM at spawn).
    // Inside a promise executor that throw becomes a rejection, which would
    // take down the whole info() call — the panel then shows 获取失败 instead
    // of 「版本未知 + 诊断」. Honour this function's contract: never throw.
    try {
      execFile(command, args, {
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
        // Windows: npm/pnpm exist only as .cmd batch shims; CreateProcess
        // cannot run them, so route through cmd.exe. Args are static here.
        shell: process.platform === 'win32'
      }, (error, stdout) => {
        if (error) { resolve(''); return }
        resolve(String(stdout || '').trim())
      })
    } catch (err) {
      resolve('')
    }
  })
}

async function npmVersion() {
  if (npmVersionCache === null) {
    const v = await runCmd('npm', ['-v'])
    if (v !== '') npmVersionCache = v
  }
  // '' (never null) on failure: callers compare against '' and treat null as a
  // separate state, and the null cache sentinel must not leak out.
  return npmVersionCache === null ? '' : npmVersionCache
}

async function npmRoot() {
  if (npmRootCache === null) {
    const root = await runCmd('npm', ['root', '-g'])
    if (root !== '') npmRootCache = root
  }
  // Returning the null sentinel here used to reach path.join(null, …) inside
  // findDshRoot and throw, turning a missing npm into 「获取失败」 for the whole
  // panel. Degrade to the same '' contract as runCmd().
  return npmRootCache === null ? '' : npmRootCache
}

// Walk up from a path inside a package tree and return the first ancestor
// directory whose package.json declares `name` (trailing separator), or null.
// Layout-independent: handles npm's nested node_modules, pnpm store paths,
// junctions/symlinks (realpath first), and dev checkouts.
function packageRootFrom(startPath, name) {
  let dir
  try {
    dir = fs.realpathSync(startPath)
  } catch (err) {
    return null
  }
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir)
  } catch (err) {
    return null
  }
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      if (pkg && pkg.name === name) return dir + path.sep
    } catch (err) {
      /* not a package directory — keep walking up */
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// Find the dsh install root. Three probes, in order; every failed step is
// recorded in `debug` so the settings page can say exactly what went wrong:
//   a) clientModules.clientPath('@deepseek-ai/dsh-client-modules') — the
//      bundle the Host actually serves lives under the running dsh install
//      (npm global layout, or a junction/symlink into it), so the package
//      root found by walking up from that file is the dsh code being
//      executed. dsh-client-modules is the module-system bootstrap and is
//      present in every dsh web deployment.
//   b) createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
//      — the dsh CLI package is a dependency of every profile, so it
//      resolves from the plugin's own module graph.
//   c) `npm root -g` (shell on Windows) — the classic global-install
//      location.
async function findDshRoot(ctx, debug) {
  // (a) served-bundle probe
  try {
    const clientModules = ctx.get('clientModules')
    if (clientModules !== undefined) {
      const bundlePath = clientModules.clientPath('@deepseek-ai/dsh-client-modules')
      if (typeof bundlePath === 'string' && bundlePath !== '') {
        const root = packageRootFrom(bundlePath, '@deepseek-ai/dsh')
        if (root !== null) return { root, source: 'clientModules' }
        debug.push('clientModules 探测未命中：bundle 路径不含 @deepseek-ai/dsh 祖先')
      } else {
        debug.push('clientModules 探测未命中：clientPath 无结果')
      }
    } else {
      debug.push('clientModules 服务不可用')
    }
  } catch (err) {
    debug.push('clientModules 探测异常：' + String((err && err.message) || err))
  }
  // (b) module-graph probe
  try {
    const resolved = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
    const pkgPath = fs.realpathSync(resolved)
    const root = packageRootFrom(path.dirname(pkgPath), '@deepseek-ai/dsh')
    if (root !== null) return { root, source: 'require' }
    debug.push('require 探测未命中：' + pkgPath + ' 不是 @deepseek-ai/dsh 包')
  } catch (err) {
    debug.push('require 探测失败：' + String((err && err.message) || err))
  }
  // (c) npm root -g
  const root = await npmRoot()
  if (root !== '') return { root: path.join(root, '@deepseek-ai', 'dsh') + path.sep, source: 'npmRoot' }
  debug.push('npm root -g 失败')
  return { root: null, source: null }
}

// All local facts in one pass. Failures degrade to null fields and collect a
// human-readable reason into `debug` (shown on the settings page).
async function readLocalInfo(ctx) {
  const debug = []
  let localVersion = null
  let installPath = null
  let installSource = null
  const found = await findDshRoot(ctx, debug)
  if (found.root === null) {
    debug.push('未找到 dsh 安装目录')
  } else {
    try {
      const pkgPath = path.join(found.root, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      localVersion = typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null
      installPath = found.root.replace(/[\\/]+$/, '')
      installSource = found.source
    } catch (err) {
      debug.push('读取 package.json 失败：' + String((err && err.message) || err))
    }
  }
  const npmVer = await npmVersion()
  let dshHome = process.env.DSH_HOME
  if (!dshHome) {
    try {
      dshHome = path.join(os.homedir(), '.dsh')
    } catch (err) {
      /* keep null */
    }
  }
  return {
    localVersion,
    installPath,
    installSource,
    nodeVersion: typeof process.version === 'string' ? process.version : null,
    platform: typeof process.platform === 'string' ? process.platform : null,
    arch: typeof process.arch === 'string' ? process.arch : null,
    npmVersion: npmVer !== '' ? npmVer : null,
    dshHome: dshHome || null,
    debug: debug.join('；')
  }
}

// Query one npm dist-tag of @deepseek-ai/dsh (Node >= 18 global fetch).
// The registry accepts a dist-tag in the version slot:
//   /@deepseek-ai/dsh/latest  /@deepseek-ai/dsh/alpha
// `label` only shapes the error text so the panel can say which channel failed.
async function fetchDistTag(tag, label) {
  const res = await fetchWithTimeout(REGISTRY_DIST_TAG_URL(tag))
  if (!res.ok) throw new Error(await httpError(res, label))
  const data = await res.json()
  const version = data && typeof data.version === 'string' ? data.version : null
  if (!version) throw new Error('响应中缺少版本号')
  return version
}

/** Resolve one channel to { tag, version, error }; never throws. */
async function channelResult(tag, label) {
  try {
    return { tag: tag, version: await fetchDistTag(tag, label), error: null }
  } catch (err) {
    return { tag: tag, version: null, error: String((err && err.message) || err) }
  }
}

// Every dist-tag of the package in ONE request:
//   { latest: '0.1.5-rc.3', next: '0.1.7-rc.1', alpha: '0.1.7-alpha.2' }
//
// Why all of them: a channel is a set of tags, not one tag. During a preview
// cycle npm keeps `latest` on the promoted stable release while the NEXT stable
// line ships as `next`, so reading only `latest` made "检查更新" report
// v0.1.5-rc.3 while the release history (and reality) said v0.1.7-rc.1 —
// the exact inconsistency this panel exists to avoid.
async function fetchDistTags() {
  const res = await fetchWithTimeout(REGISTRY_DIST_TAGS_URL)
  if (!res.ok) throw new Error(await httpError(res, 'npm registry dist-tags 请求失败'))
  const data = await res.json()
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('响应格式异常')
  const entries = []
  for (const tag of Object.keys(data)) {
    const version = data[tag]
    if (typeof version === 'string' && version !== '') entries.push({ tag: tag, version: version })
  }
  if (entries.length === 0) throw new Error('响应中缺少 dist-tag 版本号')
  return entries
}

class VersionUpdateService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'versionUpdate')
    this.ctx = ctx
  }

  /** One settings-page load: all local version/environment facts. */
  async info() {
    return readLocalInfo(this.ctx)
  }

  /**
   * LEGACY (for pre-1.3.0 client bundles only): the raw npm `latest` dist-tag.
   * Deliberately left at its documented meaning — `latest` is NOT the stable
   * line (see checkChannels/fetchDistTags); the current client never calls it.
   */
  async checkUpdate() {
    try {
      const latest = await fetchDistTag('latest', 'npm registry 请求失败')
      return { latest, error: null }
    } catch (err) {
      return { latest: null, error: String((err && err.message) || err) }
    }
  }

  /**
   * Query BOTH release channels in one pass:
   *   stable → the HIGHEST version among all dist-tags classified stable
   *            (latest, next, …) — `latest` alone is not the stable channel
   *   alpha  → the highest version among dist-tags classified alpha (`alpha`)
   *
   * `sourceTag` / `latestVersion` report where the stable target came from, so
   * the panel can explain why it can differ from the `latest` tag; `distTags`
   * carries the raw map for diagnostics. If the bulk lookup fails the method
   * degrades to the two legacy per-tag lookups instead of failing the panel,
   * and a channel with no resolvable version reports its own error while the
   * other still carries its version. `checkedAt` is set only when at least one
   * channel actually resolved.
   */
  async checkChannels() {
    let entries = null
    let distTagsError = null
    try {
      entries = await fetchDistTags()
    } catch (err) {
      distTagsError = String((err && err.message) || err)
    }
    if (entries === null) {
      // Degrade: the two per-tag endpoints may still answer when the bulk one
      // does not (and vice versa).
      const results = await Promise.all([
        channelResult('latest', '官方正式版（latest 标签）查询失败'),
        channelResult('alpha', 'Alpha 预览版（alpha 标签）查询失败')
      ])
      const stable = results[0]
      const alpha = results[1]
      return {
        checkedAt: stable.version !== null || alpha.version !== null ? Date.now() : null,
        channels: {
          stable: {
            tag: 'stable',
            version: stable.version,
            sourceTag: stable.version !== null ? 'latest' : null,
            latestVersion: stable.version,
            error: stable.error
          },
          alpha: {
            tag: 'alpha',
            version: alpha.version,
            sourceTag: alpha.version !== null ? 'alpha' : null,
            latestVersion: null,
            error: alpha.error
          }
        },
        distTags: null,
        distTagsError: distTagsError
      }
    }
    const channels = resolveChannelResults(entries)
    const distTags = {}
    for (const entry of entries) distTags[entry.tag] = entry.version
    return {
      checkedAt: channels.stable.version !== null || channels.alpha.version !== null ? Date.now() : null,
      channels: channels,
      distTags: distTags,
      distTagsError: null
    }
  }

  /** Official GitHub release notes for recent dsh versions. */
  async releases() {
    try {
      const items = await fetchReleases()
      return { items, error: null }
    } catch (err) {
      return { items: [], error: String((err && err.message) || err) }
    }
  }
}

// --- Manual Remote markers (decorator-syntax-free) ---
const proto = VersionUpdateService.prototype
function markRemote(method) {
  const context = {
    private: false,
    static: false,
    name: method,
    addInitializer(cb) { this.cb = cb }
  }
  // Equivalent to `@Remote(method)` on the class method.
  // NOTE (audit): this manual decorator-context trick is coupled to the
  // typert-protocol internals; keep in sync when upgrading that package.
  Remote(method)(undefined, context)
  context.cb.call(Object.create(proto))
}
markRemote('info')
markRemote('checkUpdate')
markRemote('checkChannels')
markRemote('releases')

export function apply(ctx) {
  // TypertRemoteService registers `versionUpdate` in ctx.reflect.props and
  // sets `service.typertRemote`; the Gateway's source-mode discovery consumes
  // both.
  new VersionUpdateService(ctx)
}
