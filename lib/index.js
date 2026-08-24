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

export function apply(ctx) {
  // TypertRemoteService registers `versionUpdate` in ctx.reflect.props and
  // sets `service.typertRemote`; the Gateway's source-mode discovery consumes
  // both.
  new VersionUpdateService(ctx)
}
