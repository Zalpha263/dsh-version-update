// dsh-version-update — Host-side dsh install probes (no Remote, no network).
//
// Extracted from lib/index.js so the Remote service and the HTTP code stay
// readable and this probe chain can be reviewed in one place. Nothing here
// throws to the caller: failures degrade to null fields plus a human-readable
// reason collected in `debug` and shown on the settings page.
//
// Probe order (first hit wins):
//   0. ctx.pluginPackages.packageOf('@deepseek-ai/dsh', import.meta.url) — the
//      0.2.1+ official resolver: resolves through the active runtime resolution,
//      so it reports the tree this process actually runs (desktop app.asar
//      included) without hard-coding a layout;
//   1. clientModules.clientPath('@deepseek-ai/dsh-client-modules') — the bundle
//      the Host actually serves lives under the running dsh install (npm global
//      layout, or a junction/symlink into it);
//   2. <resourcesPath>/app.asar/dsh/node_modules/@deepseek-ai/dsh — the Electron
//      desktop app bundles the CLI inside app.asar; this probe is the only
//      filesystem one that reports the version the desktop app really runs;
//   3. createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json') —
//      resolves when the profile hoists the runtime into its own tree;
//   4. npm root -g — the machine's npm-global dsh, which can differ from the
//      running runtime; `installSource` tells them apart.
//
// `installEnvironment` ("desktop" | "cli") is the normalized answer the Client
// half needs to generate the right update prompt: the desktop app is updated in
// the app, an npm-global tree with `npm install -g`.

import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EXEC_TIMEOUT_MS = 15000

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
  // Must return '' (never the null cache sentinel): callers path.join() this
  // result, and a null would throw and turn a missing npm into 「获取失败」 for
  // the whole panel. Degrade to the same '' contract as runCmd().
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

// Which updater applies to the tree found at `root`: the Electron desktop app
// owns process.resourcesPath and keeps its runtime below it (inside app.asar
// when packaged); anything else is an npm/CLI tree. The resources-prefix check
// also recognizes a development desktop build that runs unpacked.
function installEnvironmentOf(root) {
  const resources = typeof process.resourcesPath === 'string' && process.resourcesPath !== '' ? process.resourcesPath : null
  if (resources !== null && root.indexOf(resources) === 0) return 'desktop'
  if (/app\.asar/i.test(root)) return 'desktop'
  return 'cli'
}

async function findDshRoot(ctx, debug) {
  // (0) Official package resolver (0.2.1+). Feature-detected: 0.2.0-rc.2 has no
  // pluginPackages service, and an embedder may install it without a resolution.
  // A miss or a throw means "keep looking", not a fault — the filesystem probes
  // below still cover every older layout.
  try {
    const packages = ctx.get('pluginPackages')
    if (packages !== undefined && typeof packages.packageOf === 'function') {
      const pkg = packages.packageOf('@deepseek-ai/dsh', import.meta.url)
      if (pkg && typeof pkg.dir === 'string' && pkg.dir !== '' && typeof pkg.version === 'string' && pkg.version !== '') {
        return { root: pkg.dir + path.sep, source: 'pluginPackages', environment: installEnvironmentOf(pkg.dir) }
      }
    }
  } catch (err) {
    /* optional probe — silent by design */
  }
  // (1) served-bundle probe. On the desktop host this ALWAYS misses: walking up
  // from the client-modules bundle stops at app.asar/dsh, whose manifest is the
  // desktop runtime, not the CLI package. That is expected, so the miss stays
  // silent instead of putting a fake failure into 诊断; probe (2) is the
  // desktop path and probe (0) already handles 0.2.1+.
  try {
    const clientModules = ctx.get('clientModules')
    if (clientModules !== undefined) {
      const bundlePath = clientModules.clientPath('@deepseek-ai/dsh-client-modules')
      if (typeof bundlePath === 'string' && bundlePath !== '') {
        const root = packageRootFrom(bundlePath, '@deepseek-ai/dsh')
        if (root !== null) return { root, source: 'clientModules', environment: 'cli' }
      }
    }
  } catch (err) {
    /* expected miss — silent by design (see above) */
  }
  // (2) Electron desktop app.asar probe — the only filesystem probe that sees
  // the runtime the desktop application actually executes.
  try {
    const resources = process.resourcesPath
    if (typeof resources === 'string' && resources !== '') {
      const root = path.join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh') + path.sep
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
      if (pkg && typeof pkg.version === 'string' && pkg.version !== '') {
        return { root, source: 'desktopApp', environment: 'desktop' }
      }
      debug.push('desktop 探测未命中：' + root + 'package.json 无 version')
    } else {
      debug.push('desktop 探测跳过：process.resourcesPath 不可用')
    }
  } catch (err) {
    debug.push('desktop 探测失败：' + String((err && err.message) || err))
  }
  // (3) module-graph probe
  try {
    const resolved = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
    const pkgPath = fs.realpathSync(resolved)
    const root = packageRootFrom(path.dirname(pkgPath), '@deepseek-ai/dsh')
    if (root !== null) return { root, source: 'require', environment: installEnvironmentOf(root) }
    debug.push('require 探测未命中：' + pkgPath + ' 不是 @deepseek-ai/dsh 包')
  } catch (err) {
    debug.push('require 探测失败：' + String((err && err.message) || err))
  }
  // (4) npm root -g
  const root = await npmRoot()
  if (root !== '') return { root: path.join(root, '@deepseek-ai', 'dsh') + path.sep, source: 'npmRoot', environment: 'cli' }
  debug.push('npm root -g 失败')
  return { root: null, source: null, environment: null }
}

// All local facts in one pass. Failures degrade to null fields and collect a
// human-readable reason into `debug` (shown on the settings page).
async function readLocalInfo(ctx) {
  const debug = []
  let localVersion = null
  let installPath = null
  let installSource = null
  let installEnvironment = null
  const found = await findDshRoot(ctx, debug)
  if (found.root === null) {
    debug.push('未找到 dsh 安装目录')
  } else {
    installPath = found.root.replace(/[\\/]+$/, '')
    installSource = found.source
    installEnvironment = found.environment
    try {
      const pkgPath = path.join(found.root, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      localVersion = typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null
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
    installEnvironment,
    nodeVersion: typeof process.version === 'string' ? process.version : null,
    platform: typeof process.platform === 'string' ? process.platform : null,
    arch: typeof process.arch === 'string' ? process.arch : null,
    npmVersion: npmVer !== '' ? npmVer : null,
    dshHome: dshHome || null,
    debug: debug.join('；')
  }
}

export { findDshRoot, installEnvironmentOf, packageRootFrom, readLocalInfo }
