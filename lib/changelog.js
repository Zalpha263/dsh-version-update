// dsh-version-update — changelog data layer (Host half, persistent).
//
// This module owns everything between GitHub and the settings page:
//   1. fetch the official release list from the GitHub Releases API;
//   2. parse the bilingual release bodies into a structured changelog
//      (channel / version line / categories / bullets / authors);
//   3. cache the parsed result under $DSH_HOME/cache/dsh-version-update so a
//      refresh is cheap, offline reloads keep working, and the unauthenticated
//      GitHub rate limit (60/h) cannot brick the panel;
//   4. answer the pure questions the UI asks: range aggregation, search, and
//      "where does the running version sit?".
//
// parseRelease(), rangeAggregate(), searchReleases(), localStanding() and the
// cache helpers are pure/data-only and are covered by test/changelog.test.mjs.
// fetchReleases() and loadChangelog() are the only network/disk entry points;
// both accept test seams (fetchImpl / dshHome) so tests never touch the net.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const RELEASES_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100'
export const CACHE_SCHEMA = 1
export const CACHE_TTL_MS = 15 * 60 * 1000
export const FETCH_TIMEOUT_MS = 15000
export const KINDS = ['added', 'improved', 'fixed', 'other']

const INTRO_MAX = 400
const MAX_SEARCH_MATCHES = 200
const USER_AGENT = 'dsh-version-update'

// --- Version helpers (kept dependency-free: the Host has no semver package) ---

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = SEMVER_RE.exec(value.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? null : match[4].split('.')
  }
}

/** Semver precedence (-1 / 0 / 1), or null when either side cannot parse. */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa === null || pb === null) return null
  const keys = ['major', 'minor', 'patch']
  for (const key of keys) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.prerelease === null && pb.prerelease === null) return 0
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1
  const max = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < max; i += 1) {
    const x = pa.prerelease[i]
    const y = pb.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1
    if (xn) return -1
    if (yn) return 1
    return x < y ? -1 : 1
  }
  return 0
}

/**
 * The release channel of a version, derived from the version STRING only.
 * GitHub marks every release in this repository as prerelease=true (rc included),
 * so the API flag is useless here. "alpha" in the prerelease tag = Alpha channel;
 * everything else (plain releases and rc candidates) is the stable/RC line.
 */
export function channelOf(version) {
  const parsed = parseVersion(version)
  if (parsed === null) return null
  if (parsed.prerelease === null) return 'stable'
  for (const part of parsed.prerelease) {
    if (/alpha/i.test(part)) return 'alpha'
  }
  return 'stable'
}

export function sortReleases(releases) {
  return releases.slice().sort((a, b) => {
    const cmp = compareVersions(b.version, a.version)
    return cmp === null ? 0 : cmp
  })
}

// --- Body parsing -----------------------------------------------------------

/** Strip HTML tags, markdown links/emphasis/inline code, collapse whitespace. */
function cleanInline(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\u0060([^\u0060]*)\u0060/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Category key from a section heading, tolerant to emoji and EN/ZH wording. */
export function kindOf(title) {
  const text = cleanInline(title)
  if (/新增|新功能|features?\b/i.test(text)) return 'added'
  if (/优化|体验|改进|improvements?\b/i.test(text)) return 'improved'
  if (/修复|修正|bug\s*fixes?|fixes?\b/i.test(text)) return 'fixed'
  return 'other'
}

// "@handle" preceded by whitespace/punctuation, and not part of an email or a
// scoped package name (@deepseek-ai/dsh has a "/" after the handle).
const AUTHOR_TOKEN = /(^|[\s,，、/(（])@([A-Za-z0-9][A-Za-z0-9_.-]{0,38})(?=$|[\s,，、/)）])/g

function tidyText(value) {
  // Author tokens are removed with their lead separator, which can leave
  // "accessible. by , ," behind. Trim punctuation first so the dangling
  // English connector is actually at the end, then repeat for brackets.
  let text = value
  text = text.replace(/^[\s,，、;；:：]+/, '')
  text = text.replace(/[\s,，、;；:：—–-]+$/, '')
  text = text.replace(/\s+by$/i, '')
  text = text.replace(/[（(]+$/, '')
  text = text.replace(/[\s,，、;；:：—–-]+$/, '')
  text = text.replace(/[（(]+$/, '')
  return text.replace(/\s{2,}/g, ' ').trim()
}

/** Split trailing "@author, @author" handles out of a bullet. */
function splitAuthors(value) {
  const authors = []
  const stripped = value.replace(AUTHOR_TOKEN, (match, lead, handle) => {
    authors.push(handle)
    return lead
  })
  return { text: tidyText(cleanInline(stripped)), authors }
}

function isNoiseLine(line) {
  const text = line.trim()
  if (text === '') return false
  return /^Full Changelog/i.test(text) || /^---+$/.test(text)
}

function parseItems(raw) {
  const items = []
  let current = null
  const flush = () => {
    if (current === null) return
    const { text, authors } = splitAuthors(current)
    if (text !== '') items.push({ text, authors })
    current = null
  }
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*[-*]\s+/.test(line)) {
      flush()
      current = line.replace(/^\s*[-*]\s+/, '')
      continue
    }
    const trimmed = line.trim()
    if (current === null) continue
    if (trimmed === '' || isNoiseLine(line)) {
      flush()
      continue
    }
    current += ' ' + trimmed
  }
  flush()
  return items
}

/** Language hint from an anchor id and/or the heading text. */
function languageHint(id, title) {
  const anchor = typeof id === 'string' ? id : ''
  if (/^(cn|chinese|zh)(?:$|[-_])/i.test(anchor) || /中文/.test(title)) return 'zh'
  if (/^(en|english)(?:$|[-_])/i.test(anchor)) return 'en'
  if (/[\u3400-\u9fff]/.test(title)) return 'zh'
  if (title !== '') return 'en'
  return null
}

function safeIntro(value) {
  if (value.length <= INTRO_MAX) return value
  let end = INTRO_MAX
  const code = value.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return value.slice(0, end) + '…'
}

/**
 * Split a bilingual release body into { intro, zh, en }.
 *
 * The body is scanned ONCE as one heading stream instead of being cut into a
 * Chinese half and an English half. That matters because the repository mixes
 * two heading shapes inside the same half:
 *   <h3 id="cn-v0.2.2-rc.1-5">新增功能</h3>   (anchor, language known)
 *   ### 体验优化 / ### Improvements            (markdown, language from script)
 * Cutting at the first "<h3 id=\"en-\"" would drag English "### " headings into
 * the Chinese half of a Chinese-only body (no en anchor at all).
 */
export function parseBody(body) {
  if (typeof body !== 'string' || body === '') return { intro: '', zh: [], en: [] }
  const headings = []
  // One pass over every heading shape; language context carries forward.
  const pattern = /<h([1-4])(?:\s+id="([^"]*)")?[^>]*>([\s\S]*?)<\/h\1>|^###\s+(.+)$/gm
  let context = null
  let match
  while ((match = pattern.exec(body)) !== null) {
    const level = match[1] === undefined ? 3 : Number(match[1])
    const id = match[2] === undefined ? null : match[2]
    const title = cleanInline(match[3] !== undefined ? match[3] : match[4])
    const hint = languageHint(id, title)
    const heading = {
      index: match.index,
      contentStart: match.index + match[0].length,
      title: title,
      container: level <= 2,
      lang: null
    }
    if (heading.container) {
      if (hint !== null) context = hint
    } else {
      heading.lang = hint || context || 'en'
      context = heading.lang
    }
    headings.push(heading)
  }
  const firstIndex = headings.length > 0 ? headings[0].index : body.length
  const headLines = []
  for (const rawLine of body.slice(0, firstIndex).split(/\r?\n/)) {
    const text = cleanInline(rawLine)
    // Drop the "[中文](#…) | [English](#…)" navigation line (cleaned to "中文 | English").
    if (text === '' || /^中文\s*\|\s*English$/.test(text)) continue
    headLines.push(text)
  }
  const buckets = { zh: [], en: [] }
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i]
    if (heading.container) continue
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length
    const items = parseItems(body.slice(heading.contentStart, end))
    if (items.length > 0) {
      buckets[heading.lang].push({ kind: kindOf(heading.title), title: heading.title, items: items })
    }
  }
  return { intro: safeIntro(headLines.join(' ')), zh: buckets.zh, en: buckets.en }
}

/** Parse one GitHub release object; returns null for anything unusable. */
export function parseRelease(release) {
  if (release === null || typeof release !== 'object') return null
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  const version = tag.replace(/^dsh-v/, '').replace(/^v/, '')
  if (version === '' || parseVersion(version) === null) return null
  const body = typeof release.body === 'string' ? release.body : ''
  const parsed = parseBody(body)
  // The compare link appears both as [text](url) and as a bare URL.
  const compareMatch = /Full Changelog:?\s*(?:\[[^\]]*\]\()?(https?:\/\/[^)\s]+)/i.exec(body)
  const htmlUrl = typeof release.html_url === 'string' && release.html_url !== ''
    ? release.html_url
    : 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/' + encodeURIComponent(tag)
  return {
    version: version,
    channel: channelOf(version),
    line: version.replace(/-.*$/, ''),
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    url: htmlUrl,
    compareUrl: compareMatch === null ? null : compareMatch[1],
    intro: parsed.intro,
    zh: parsed.zh,
    en: parsed.en
  }
}

/** Turn the GitHub payload into the stored release list (newest first). */
export function parseReleases(payload) {
  if (!Array.isArray(payload)) return []
  const releases = []
  for (const item of payload) {
    const release = parseRelease(item)
    if (release !== null) releases.push(release)
  }
  return sortReleases(releases)
}

// --- Localization helpers ---------------------------------------------------

export function normalizeLang(lang) {
  return typeof lang === 'string' && lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * kind -> items for one release in the preferred language, falling back per
 * category to the other language when the preferred half is missing.
 */
export function localizedKinds(release, lang) {
  const preferred = normalizeLang(lang)
  const other = preferred === 'zh' ? 'en' : 'zh'
  const primary = Array.isArray(release[preferred]) ? release[preferred] : []
  const secondary = Array.isArray(release[other]) ? release[other] : []
  const map = new Map()
  for (const section of primary) {
    if (!map.has(section.kind)) map.set(section.kind, [])
    map.get(section.kind).push(...section.items)
  }
  for (const section of secondary) {
    if (!map.has(section.kind) || map.get(section.kind).length === 0) {
      map.set(section.kind, section.items.slice())
    }
  }
  return map
}

export function countKinds(release, lang) {
  const map = localizedKinds(release, lang)
  const counts = { added: 0, improved: 0, fixed: 0, other: 0, total: 0 }
  for (const kind of KINDS) {
    const size = map.has(kind) ? map.get(kind).length : 0
    counts[kind] = size
    counts.total += size
  }
  return counts
}

// --- Query helpers (range / search / standing) ------------------------------

function emptyCounts() {
  return { added: 0, improved: 0, fixed: 0, other: 0, total: 0 }
}

/**
 * Aggregate everything published in (from, to] — the "what do I get if I move
 * from A to B" view. Endpoints are inclusive of `to`; a reversed pair is
 * swapped and flagged instead of failing.
 */
export function rangeAggregate(releases, from, to, lang) {
  const list = Array.isArray(releases) ? releases : []
  if (parseVersion(from) === null || parseVersion(to) === null) {
    return { ok: false, code: 'uncomparable' }
  }
  let start = from
  let end = to
  let swapped = false
  const cmp = compareVersions(from, to)
  if (cmp === null) return { ok: false, code: 'uncomparable' }
  if (cmp > 0) {
    start = to
    end = from
    swapped = true
  }
  const inRange = []
  for (const release of list) {
    const toEnd = compareVersions(release.version, end)
    const toStart = compareVersions(release.version, start)
    if (toEnd === null || toStart === null) continue
    if (cmp === 0) {
      if (toStart === 0) inRange.push(release)
      continue
    }
    if (toEnd <= 0 && toStart > 0) inRange.push(release)
  }
  const buckets = new Map(KINDS.map((kind) => [kind, []]))
  const counts = emptyCounts()
  for (const release of inRange) {
    const map = localizedKinds(release, lang)
    for (const kind of KINDS) {
      const items = map.has(kind) ? map.get(kind) : []
      for (const item of items) {
        buckets.get(kind).push({ text: item.text, authors: item.authors, version: release.version, channel: release.channel })
        counts[kind] += 1
        counts.total += 1
      }
    }
  }
  return {
    ok: true,
    from: start,
    to: end,
    swapped: swapped,
    versions: inRange.map((release) => release.version),
    counts: counts,
    sections: KINDS.filter((kind) => buckets.get(kind).length > 0)
      .map((kind) => ({ kind: kind, items: buckets.get(kind) }))
  }
}

/**
 * Case-insensitive full-text search across both language halves, grouped by
 * release. A category is returned in the preferred language when that language
 * has a hit there, otherwise in the other language (so an English query still
 * finds items while the UI is Chinese).
 */
export function searchReleases(releases, query, channel, kind, lang) {
  const list = Array.isArray(releases) ? releases : []
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const channelFilter = channel === 'alpha' || channel === 'stable' ? channel : null
  const kindFilter = KINDS.includes(kind) ? kind : null
  if (needle === '') return { ok: true, query: '', total: 0, truncated: false, groups: [] }
  const preferred = normalizeLang(lang)
  const other = preferred === 'zh' ? 'en' : 'zh'
  const groups = []
  let total = 0
  let truncated = false
  for (const release of list) {
    if (channelFilter !== null && release.channel !== channelFilter) continue
    const matches = []
    for (const kindKey of KINDS) {
      if (kindFilter !== null && kindKey !== kindFilter) continue
      const preferredSections = (release[preferred] || []).filter((section) => section.kind === kindKey)
      const otherSections = (release[other] || []).filter((section) => section.kind === kindKey)
      const preferredHits = []
      for (const section of preferredSections) {
        for (const item of section.items) {
          if (item.text.toLowerCase().indexOf(needle) >= 0) preferredHits.push(item)
        }
      }
      const otherHits = []
      for (const section of otherSections) {
        for (const item of section.items) {
          if (item.text.toLowerCase().indexOf(needle) >= 0) otherHits.push(item)
        }
      }
      const hits = preferredHits.length > 0 ? preferredHits : otherHits
      if (hits.length === 0) continue
      if (total + hits.length > MAX_SEARCH_MATCHES) {
        const room = MAX_SEARCH_MATCHES - total
        if (room > 0) {
          matches.push({ kind: kindKey, items: hits.slice(0, room).map((item) => ({ text: item.text, authors: item.authors })) })
          total += room
        }
        truncated = true
        break
      }
      matches.push({ kind: kindKey, items: hits.map((item) => ({ text: item.text, authors: item.authors })) })
      total += hits.length
    }
    if (matches.length > 0) {
      groups.push({
        version: release.version,
        channel: release.channel,
        publishedAt: release.publishedAt,
        url: release.url,
        matches: matches
      })
    }
    if (truncated) break
  }
  return { ok: true, query: query.trim(), total: total, truncated: truncated, groups: groups }
}

/** Where the running version sits relative to the published changelog. */
export function localStanding(releases, localVersion, lang) {
  const list = Array.isArray(releases) ? releases : []
  const counts = emptyCounts()
  const latestStable = list.find((release) => release.channel === 'stable') || null
  const latestAlpha = list.find((release) => release.channel === 'alpha') || null
  const summary = {
    latest: list.length > 0 ? list[0].version : null,
    latestStable: latestStable === null ? null : latestStable.version,
    latestAlpha: latestAlpha === null ? null : latestAlpha.version
  }
  const parsed = parseVersion(localVersion)
  if (parsed === null) {
    return {
      known: false,
      version: typeof localVersion === 'string' && localVersion !== '' ? localVersion : null,
      channel: null,
      versionsAhead: 0,
      versionsAheadAll: 0,
      newestSame: null,
      counts: counts,
      latest: summary.latest,
      latestStable: summary.latestStable,
      latestAlpha: summary.latestAlpha
    }
  }
  const channel = channelOf(localVersion)
  const aheadAll = []
  const aheadSame = []
  for (const release of list) {
    const cmp = compareVersions(release.version, localVersion)
    if (cmp === null || cmp <= 0) continue
    aheadAll.push(release)
    if (release.channel === channel) aheadSame.push(release)
  }
  for (const release of aheadSame) {
    const releaseCounts = countKinds(release, lang)
    for (const kind of KINDS) counts[kind] += releaseCounts[kind]
    counts.total += releaseCounts.total
  }
  return {
    known: true,
    version: localVersion,
    channel: channel,
    versionsAhead: aheadSame.length,
    versionsAheadAll: aheadAll.length,
    newestSame: aheadSame.length > 0 ? aheadSame[0].version : null,
    counts: counts,
    latest: summary.latest,
    latestStable: summary.latestStable,
    latestAlpha: summary.latestAlpha
  }
}

/** Per-channel totals + newest version, for the collapsed group headers. */
export function channelSummary(releases) {
  const list = Array.isArray(releases) ? releases : []
  const summary = {
    stable: { count: 0, latest: null },
    alpha: { count: 0, latest: null }
  }
  for (const release of list) {
    const channel = release.channel
    if (channel !== 'stable' && channel !== 'alpha') continue
    summary[channel].count += 1
    if (summary[channel].latest === null) summary[channel].latest = release.version
  }
  return summary
}

// --- Cache ------------------------------------------------------------------

export function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured !== '') return configured
  try {
    return path.join(os.homedir(), '.dsh')
  } catch (err) {
    return null
  }
}

export function cacheFile(dshHomePath) {
  const base = typeof dshHomePath === 'string' && dshHomePath !== '' ? dshHomePath : dshHome()
  if (base === null) return null
  return path.join(base, 'cache', 'dsh-version-update', 'releases-v1.json')
}

export function readCache(file) {
  if (typeof file !== 'string' || file === '') return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    if (parsed.schemaVersion !== CACHE_SCHEMA) return null
    if (!Array.isArray(parsed.releases) || parsed.releases.length === 0) return null
    if (typeof parsed.fetchedAt !== 'number' || typeof parsed.checkedAt !== 'number') return null
    return {
      schemaVersion: CACHE_SCHEMA,
      fetchedAt: parsed.fetchedAt,
      checkedAt: parsed.checkedAt,
      etag: typeof parsed.etag === 'string' ? parsed.etag : null,
      releases: parsed.releases
    }
  } catch (err) {
    return null
  }
}

/** Best-effort atomic write: temp file + rename; cache failures never throw. */
export function writeCache(file, entry) {
  if (typeof file !== 'string' || file === '') return false
  const payload = {
    schemaVersion: CACHE_SCHEMA,
    fetchedAt: entry.fetchedAt,
    checkedAt: entry.checkedAt,
    etag: entry.etag === undefined ? null : entry.etag,
    releases: entry.releases
  }
  const temp = file + '.' + String(process.pid) + '.tmp'
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify(payload))
    fs.renameSync(temp, file)
    return true
  } catch (err) {
    try { fs.rmSync(temp, { force: true }) } catch (cleanupError) { /* ignore */ }
    return false
  }
}

// --- Network ----------------------------------------------------------------

export class ChangelogError extends Error {
  constructor(code, status) {
    super(code)
    this.name = 'ChangelogError'
    this.code = code
    this.status = typeof status === 'number' ? status : null
  }
}

async function readJson(response) {
  try {
    return await response.json()
  } catch (err) {
    throw new ChangelogError('parse')
  }
}

/**
 * Fetch + parse the release list. Resolves { notModified, etag, releases }.
 * A 304 is a success path (the cached body is still current); HTTP 403/429 are
 * reported as rate-limit, everything else as http/network/parse.
 */
export async function fetchReleases(options) {
  const settings = options || {}
  const doFetch = typeof settings.fetchImpl === 'function' ? settings.fetchImpl : fetch
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT
  }
  if (typeof settings.etag === 'string' && settings.etag !== '') headers['If-None-Match'] = settings.etag
  const token = process.env.GITHUB_TOKEN
  if (typeof token === 'string' && token !== '') headers.Authorization = 'Bearer ' + token

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response
  try {
    response = await doFetch(RELEASES_URL, { headers: headers, signal: controller.signal })
  } catch (err) {
    throw new ChangelogError('network')
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 304) return { notModified: true, etag: typeof settings.etag === 'string' ? settings.etag : null }
  if (response.status === 403 || response.status === 429) throw new ChangelogError('rate-limit', response.status)
  if (response.ok !== true) throw new ChangelogError('http', response.status)
  const payload = await readJson(response)
  const releases = parseReleases(payload)
  if (releases.length === 0) throw new ChangelogError('parse')
  const etag = response.headers && typeof response.headers.get === 'function' ? response.headers.get('etag') : null
  return { notModified: false, etag: etag, releases: releases }
}

// --- Orchestration (fetch -> cache -> present) ------------------------------

let memory = { file: null, entry: null }

function present(entry, error, stale) {
  return {
    releases: entry.releases,
    fetchedAt: entry.fetchedAt,
    checkedAt: entry.checkedAt,
    stale: stale === true,
    error: error === null ? null : {
      code: error.code,
      status: error.status === undefined ? null : error.status
    }
  }
}

/**
 * One settings-page load: cache first, network only when the TTL expired or
 * "refresh" was requested. A failed refresh degrades to the cached body with
 * stale: true instead of blanking the panel.
 */
export async function loadChangelog(options) {
  const settings = options || {}
  const force = settings.refresh === true
  const file = cacheFile(settings.dshHome)
  if (memory.file !== file && file !== null) {
    memory = { file: file, entry: readCache(file) }
  }
  const entry = memory.entry
  const now = typeof settings.now === 'function' ? settings.now() : Date.now()
  if (!force && entry !== null && now - entry.checkedAt < CACHE_TTL_MS) {
    return present(entry, null, false)
  }
  let fetched
  try {
    fetched = await fetchReleases({ etag: entry === null ? null : entry.etag, fetchImpl: settings.fetchImpl })
  } catch (err) {
    const error = err instanceof ChangelogError ? err : new ChangelogError('network')
    if (entry !== null) return present(entry, error, true)
    return { releases: [], fetchedAt: null, checkedAt: null, stale: false, error: { code: error.code, status: error.status } }
  }
  if (fetched.notModified && entry !== null) {
    const next = {
      schemaVersion: CACHE_SCHEMA,
      fetchedAt: entry.fetchedAt,
      checkedAt: now,
      etag: fetched.etag || entry.etag,
      releases: entry.releases
    }
    memory = { file: file, entry: next }
    if (file !== null) writeCache(file, next)
    return present(next, null, false)
  }
  if (fetched.notModified) {
    // A 304 without a cached body is not a usable state; report a parse failure
    // instead of dereferencing undefined releases.
    return { releases: [], fetchedAt: null, checkedAt: null, stale: false, error: { code: 'parse', status: null } }
  }
  const next = {
    schemaVersion: CACHE_SCHEMA,
    fetchedAt: now,
    checkedAt: now,
    etag: fetched.etag,
    releases: fetched.releases
  }
  memory = { file: file, entry: next }
  if (file !== null) writeCache(file, next)
  return present(next, null, false)
}

/** Test seam: drop the process-level memo so each test starts clean. */
export function resetChangelogMemory() {
  memory = { file: null, entry: null }
}
