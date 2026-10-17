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
//   - info():        local dsh version / install path / install source and
//                    environment / Node / npm / platform / data dir, plus
//                    per-step diagnostics when something fails. The local facts
//                    and the probe chain live in lib/probe.js; `installSource`
//                    names the probe that answered and `installEnvironment`
//                    ("desktop" | "cli") tells the Client which updater the
//                    generated prompt must target. Both matter because more than
//                    one dsh tree can exist on a machine (npm-global CLI vs the
//                    Electron desktop app.asar).
//   - checkChannels(): query EVERY dist-tag of @deepseek-ai/dsh in one request
//                    and resolve each channel as its highest classified version
//                    — `latest` alone is NOT the stable channel: during a preview
//                    cycle npm keeps `latest` on the promoted stable release while
//                    the next stable line ships under another tag. One failing
//                    lookup never hides the other channel.
//   - releases():    official GitHub release notes for recent dsh versions
//
// IMPORTANT: the Gateway derives parameter wires from the method SOURCE
// (parameter names must be simple identifiers — no destructuring, defaults,
// or rest), and the client-side contribution matches them positionally.
// All three methods here take no parameters, so the wires stay empty.
//
// Performance: never run synchronous child processes on the Host event loop —
// execSync blocks every other plugin for up to its timeout. Local npm lookups
// are async and cached in lib/probe.js, and every outbound fetch below carries
// an AbortController timeout so a network black hole cannot leave the settings
// page stuck on "检查中…".

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readLocalInfo } from './probe.js'
import { resolveChannelResults } from './version.js'

const REGISTRY_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags'
const REGISTRY_DIST_TAG_URL = (tag) => 'https://registry.npmjs.org/@deepseek-ai/dsh/' + tag
const RELEASES_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=10'
const SUMMARY_MAX = 600
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
    // Release bodies are bilingual: the Chinese half starts at <h3 id="cn-…">
    // and ends where the English half begins. Older bodies separated the two
    // with a `---` rule; current ones (e.g. dsh-v0.2.0-rc.2) do not, so the
    // English heading is the fallback boundary. Without it the "section" runs
    // into the English text and the 600-char cut lands mid-sentence.
    let cnEnd = body.indexOf('\n---', cnStart)
    if (cnEnd < 0) cnEnd = body.indexOf('<h3 id="en-', cnStart)
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
//   { latest: '<stable>', next: '<stable>', alpha: '<alpha>' }   (shape, not values)
//
// Why all of them: a channel is a set of tags, not one tag. During a preview
// cycle npm keeps `latest` on the promoted stable release while the NEXT stable
// line ships under another tag, so reading only `latest` made "检查更新" report an
// older version than the release history (and reality) did — the exact
// inconsistency this panel exists to avoid.
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
   * Query BOTH release channels in one pass:
   *   stable → the HIGHEST version among all dist-tags classified stable
   *            (latest, next, …) — `latest` alone is not the stable channel
   *   alpha  → the highest version among dist-tags classified alpha (`alpha`)
   *
   * `sourceTag` / `latestVersion` report where the stable target came from, so
   * the panel can explain why it can differ from the `latest` tag. If the bulk
   * lookup fails the method degrades to the two legacy per-tag lookups instead
   * of failing the panel, and a channel with no resolvable version reports its
   * own error while the other still carries its version. `checkedAt` is set only
   * when at least one channel actually resolved.
   */
  async checkChannels() {
    let entries = null
    try {
      entries = await fetchDistTags()
    } catch (err) {
      // Degrade below: the two per-tag endpoints may still answer when the bulk
      // one does not (and vice versa). Each channel reports its own error, so
      // the bulk failure needs no separate field.
    }
    if (entries === null) {
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
        }
      }
    }
    const channels = resolveChannelResults(entries)
    return {
      checkedAt: channels.stable.version !== null || channels.alpha.version !== null ? Date.now() : null,
      channels: channels
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
  // NOTE: this manual decorator-context trick is coupled to the typert-protocol
  // internals; keep in sync when upgrading that package.
  Remote(method)(undefined, context)
  context.cb.call(Object.create(proto))
}
markRemote('info')
markRemote('checkChannels')
markRemote('releases')

export function apply(ctx) {
  // TypertRemoteService registers `versionUpdate` in ctx.reflect.props and
  // sets `service.typertRemote`; the Gateway's source-mode discovery consumes
  // both.
  new VersionUpdateService(ctx)
}
