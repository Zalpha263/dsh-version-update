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
//
// IMPORTANT: the Gateway derives parameter wires from the method SOURCE
// (parameter names must be simple identifiers — no destructuring, defaults,
// or rest), and the client-side contribution matches them positionally.
// Both methods here take no parameters, so the wires stay empty.

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
const RELEASES_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=10'
const SUMMARY_MAX = 600

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
  if (text.length > SUMMARY_MAX) text = text.slice(0, SUMMARY_MAX) + '…'
  return text
}

async function fetchReleases() {
  const res = await fetch(RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-version-update'
    }
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('响应格式异常')
  const items = []
  for (const release of data) {
    if (!release || typeof release !== 'object') continue
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    if (tag === '') continue
    items.push({
      version: tag.startsWith('dsh-v') ? tag.slice(4) : tag,
      name: typeof release.name === 'string' && release.name !== '' ? release.name : tag,
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
      url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/' + encodeURIComponent(tag),
      summary: summarizeBody(release.body)
    })
  }
  return items
}

// --- Local facts ------------------------------------------------------------

// Find the dsh install root. Primary: `clientModules.clientPath` points at a
// shipped bundle, which always lives under
// <npmRoot>/node_modules/@deepseek-ai/dsh/. Fallback: `npm root -g`.
// Returns the root with a trailing separator, or null when both fail.
function findDshRoot(ctx) {
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
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', timeout: 15000 }).trim()
    if (root !== '') return path.join(root, '@deepseek-ai', 'dsh') + path.sep
  } catch (err) {
    /* no more fallbacks */
  }
  return null
}

// All local facts in one pass. Failures degrade to null fields and collect a
// human-readable reason into `debug` (shown on the settings page).
function readLocalInfo(ctx) {
  const debug = []
  let localVersion = null
  let installPath = null
  const root = findDshRoot(ctx)
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
  let npmVersion = null
  try {
    const v = execSync('npm -v', { encoding: 'utf8', timeout: 15000 }).trim()
    if (v !== '') npmVersion = v
  } catch (err) {
    debug.push('npm -v 失败：' + String((err && err.message) || err))
  }
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
    npmVersion,
    dshHome: dshHome || null,
    debug: debug.join('；')
  }
}

// Query the official npm registry dist-tag `latest` (Node >= 18 global fetch).
async function fetchLatest() {
  const res = await fetch(REGISTRY_URL)
  if (!res.ok) throw new Error('HTTP ' + res.status)
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
  info() {
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
      return { items: [], error: 'GitHub API 请求失败：' + String((err && err.message) || err) }
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
