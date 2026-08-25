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
//                    @deepseek-ai/dsh
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

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
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
// cache per process so repeated settings-page loads don't re-spawn.
let npmVersionCache = null
let npmRootCache = null

/** Run a command async; resolve stdout trimmed; resolve '' on any failure. */
function runCmd(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', timeout: EXEC_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) { resolve(''); return }
      resolve(String(stdout || '').trim())
    })
  })
}

async function npmVersion() {
  if (npmVersionCache === null) npmVersionCache = await runCmd('npm', ['-v'])
  return npmVersionCache
}

async function npmRoot() {
  if (npmRootCache === null) npmRootCache = await runCmd('npm', ['root', '-g'])
  return npmRootCache
}

// Find the dsh install root. Primary: `clientModules.clientPath` points at a
// shipped bundle, which always lives under
// <npmRoot>/node_modules/@deepseek-ai/dsh/. Fallback: `npm root -g` (async).
async function findDshRoot(ctx) {
  try {
    const clientModules = ctx.get('clientModules')
    if (clientModules !== undefined) {
      const bundlePath = clientModules.clientPath('@deepseek-ai/dsh-web-app')
      if (typeof bundlePath === 'string' && bundlePath !== '') {
        const m = bundlePath.match(/node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]/)
        if (m) return bundlePath.slice(0, m.index + m[0].length)
      }
    }
  } catch (err) {
    /* fall through to npm root -g */
  }
  const root = await npmRoot()
  if (root !== '') return path.join(root, '@deepseek-ai', 'dsh') + path.sep
  return null
}

// All local facts in one pass. Failures degrade to null fields and collect a
// human-readable reason into `debug` (shown on the settings page).
async function readLocalInfo(ctx) {
  const debug = []
  let localVersion = null
  let installPath = null
  const root = await findDshRoot(ctx)
  if (root === null) {
    debug.push('未找到 dsh 安装目录')
  } else {
    try {
      const pkgPath = path.join(root, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      localVersion = typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null
      installPath = root.replace(/[\\/]+$/, '')
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
    nodeVersion: typeof process.version === 'string' ? process.version : null,
    platform: typeof process.platform === 'string' ? process.platform : null,
    arch: typeof process.arch === 'string' ? process.arch : null,
    npmVersion: npmVer !== '' ? npmVer : null,
    dshHome: dshHome || null,
    debug: debug.join('；')
  }
}

// Query the official npm registry dist-tag `latest` (Node >= 18 global fetch).
async function fetchLatest() {
  const res = await fetchWithTimeout(REGISTRY_URL)
  if (!res.ok) throw new Error(await httpError(res, 'npm registry 请求失败'))
  const data = await res.json()
  const version = data && typeof data.version === 'string' ? data.version : null
  if (!version) throw new Error('响应中缺少版本号')
  return version
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

  /** Query the official npm registry for the latest published version. */
  async checkUpdate() {
    try {
      const latest = await fetchLatest()
      return { latest, error: null }
    } catch (err) {
      return { latest: null, error: String((err && err.message) || err) }
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
markRemote('releases')

export function apply(ctx) {
  // TypertRemoteService registers `versionUpdate` in ctx.reflect.props and
  // sets `service.typertRemote`; the Gateway's source-mode discovery consumes
  // both.
  new VersionUpdateService(ctx)
}
