// dsh-version-update — unit tests for the changelog data layer.
//
// Run: node --test test/    (the package is ESM; package.json declares "type":"module")
//
// Everything here is offline: the parser runs against trimmed real GitHub
// release bodies in test/fixtures, and the fetch/cache orchestration runs
// against an injected fetchImpl + a temp DSH_HOME.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	parseVersion,
	compareVersions,
	channelOf,
	sortReleases,
	kindOf,
	parseBody,
	parseRelease,
	parseReleases,
	rangeAggregate,
	searchReleases,
	localStanding,
	channelSummary,
	cacheFile,
	readCache,
	writeCache,
	loadChangelog,
	resetChangelogMemory,
	normalizeLang,
	countKinds,
	CACHE_TTL_MS
} from '../lib/changelog.js'

const here = path.dirname(fileURLToPath(import.meta.url))

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(here, 'fixtures', name), 'utf8'))
}
function fixture(name) {
	return parseRelease(loadFixture(name))
}
function tempHome(tag) {
	const dir = fs.mkdtempSync(path.join(here, '.tmp-' + tag + '-'))
	return dir
}
function cleanup(dir) {
	try { fs.rmSync(dir, { recursive: true, force: true }) } catch (err) { /* ignore */ }
}

const FIXTURES = [
	'release-0.2.2-rc.1.json',
	'release-0.2.2-alpha.3.json',
	'release-0.2.0-rc.1.json',
	'release-0.1.0-rc.7.json',
	'release-markdown-headings.json'
]
function fixtureReleases() {
	return FIXTURES.map(fixture)
}
function countsOf(release, lang) {
	const map = { added: 0, improved: 0, fixed: 0, other: 0 }
	for (const section of release[lang]) map[section.kind] += section.items.length
	return map
}

// --- Version helpers --------------------------------------------------------

test('parseVersion handles plain, v-prefixed and prerelease versions', () => {
	assert.deepEqual(parseVersion('0.2.2-rc.1'), { major: 0, minor: 2, patch: 2, prerelease: ['rc', '1'] })
	assert.deepEqual(parseVersion('v0.1.0'), parseVersion('0.1.0'))
	assert.equal(parseVersion('0.1.0').prerelease, null)
	assert.equal(parseVersion('0.2'), null)
	assert.equal(parseVersion('not-a-version'), null)
	assert.equal(parseVersion(null), null)
})

test('compareVersions follows semver precedence including prerelease order', () => {
	assert.equal(compareVersions('0.2.2-rc.1', '0.2.2-alpha.3'), 1)
	assert.equal(compareVersions('0.2.2-alpha.3', '0.2.2-alpha.2'), 1)
	assert.equal(compareVersions('0.2.2-rc.1', '0.2.2'), -1)
	assert.equal(compareVersions('0.2.2', '0.2.2-rc.1'), 1)
	assert.equal(compareVersions('0.1.0', '0.2.0'), -1)
	assert.equal(compareVersions('0.2.2', '0.2.2'), 0)
	assert.equal(compareVersions('bogus', '0.2.2'), null)
})

test('channelOf classifies alpha as alpha and rc/plain as stable', () => {
	assert.equal(channelOf('0.2.2-alpha.3'), 'alpha')
	assert.equal(channelOf('0.2.2-ALPHA.1'), 'alpha')
	assert.equal(channelOf('0.2.2-rc.1'), 'stable')
	assert.equal(channelOf('0.2.2'), 'stable')
	assert.equal(channelOf('bogus'), null)
})

test('sortReleases puts the newest version first and keeps both channels', () => {
	const sorted = sortReleases(fixtureReleases())
	assert.deepEqual(sorted.map((release) => release.version), [
		'0.2.2-rc.1',
		'0.2.2-alpha.3',
		'0.2.1-rc.3',
		'0.2.0-rc.1',
		'0.1.0-rc.7'
	])
	assert.deepEqual(channelSummary(sorted), {
		stable: { count: 4, latest: '0.2.2-rc.1' },
		alpha: { count: 1, latest: '0.2.2-alpha.3' }
	})
})

// --- Body parsing -----------------------------------------------------------

test('kindOf normalizes Chinese, English and emoji headings', () => {
	assert.equal(kindOf('新增功能'), 'added')
	assert.equal(kindOf('✨ 新增'), 'added')
	assert.equal(kindOf('New Features'), 'added')
	assert.equal(kindOf('体验优化'), 'improved')
	assert.equal(kindOf('🎨 Improvements'), 'improved')
	assert.equal(kindOf('问题修复'), 'fixed')
	assert.equal(kindOf('🐛 Bug Fixes'), 'fixed')
	assert.equal(kindOf('其他变更'), 'other')
	assert.equal(kindOf('⚠️ Chores'), 'other')
	assert.equal(kindOf('SDK'), 'other')
})

test('parser: newest bilingual body splits four categories and strips authors', () => {
	const release = fixture('release-0.2.2-rc.1.json')
	assert.equal(release.version, '0.2.2-rc.1')
	assert.equal(release.channel, 'stable')
	assert.equal(release.line, '0.2.2')
	assert.equal(release.compareUrl, 'https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.5...dsh-v0.2.2-rc.1')
	assert.match(release.intro, /^作为 0\.2\.2 系列的首个候选版本/)
	assert.deepEqual(release.zh.map((section) => section.kind), ['added', 'improved', 'fixed', 'other'])
	assert.deepEqual(countsOf(release, 'zh'), { added: 13, improved: 31, fixed: 53, other: 29 })
	assert.deepEqual(countsOf(release, 'en'), { added: 13, improved: 31, fixed: 53, other: 29 })
	const first = release.zh[0].items[0]
	assert.match(first.text, /^完善手机和平板适配/)
	assert.ok(!first.text.includes('@'), 'author handles are stripped from the rendered text')
	assert.deepEqual(first.authors, ['Stevring', 'turtle2099', 'LegGasai', 'EricMoin', 'Saafo'])
})

test('parser: alpha channel and emoji-prefixed headings normalize', () => {
	const alpha = fixture('release-0.2.2-alpha.3.json')
	assert.equal(alpha.channel, 'alpha')
	assert.deepEqual(countsOf(alpha, 'zh'), { added: 3, improved: 6, fixed: 9, other: 11 })
	const emoji = fixture('release-0.2.0-rc.1.json')
	assert.deepEqual(countsOf(emoji, 'zh'), { added: 0, improved: 10, fixed: 7, other: 2 })
	assert.match(emoji.zh[0].title, /^🎨 体验优化$/)
	assert.deepEqual(countsOf(emoji, 'en'), { added: 0, improved: 10, fixed: 7, other: 2 })
})

test('parser: markdown headings (###) are sections too', () => {
	const release = fixture('release-markdown-headings.json')
	assert.equal(release.version, '0.2.1-rc.3')
	assert.deepEqual(countsOf(release, 'zh'), { added: 0, improved: 2, fixed: 0, other: 1 })
	assert.deepEqual(countsOf(release, 'en'), { added: 0, improved: 2, fixed: 0, other: 1 })
})

test('parser: Chinese-only body does not leak English sections into zh', () => {
	const release = fixture('release-0.1.0-rc.7.json')
	assert.equal(release.intro, '')
	assert.deepEqual(countsOf(release, 'zh'), { added: 3, improved: 4, fixed: 5, other: 0 })
	assert.deepEqual(countsOf(release, 'en'), { added: 3, improved: 4, fixed: 5, other: 0 })
	assert.ok(release.zh.every((section) => /[\u3400-\u9fff]/.test(section.title)))
	assert.ok(release.en.every((section) => !/[\u3400-\u9fff]/.test(section.title)))
})

test('parser: h2 language containers (bare h3 headings) are honored', () => {
	const body = [
		'[中文](#chinese) | [English](#english)',
		'',
		'<h2 id="chinese">0.1.3-alpha.2 · 中文</h2>',
		'',
		'<h3>新增功能</h3>',
		'',
		'- 中文条目 @alice',
		'',
		'<h2 id="english">0.1.3-alpha.2 · English</h2>',
		'',
		'<h3>New Features</h3>',
		'',
		'- English item by @bob'
	].join('\n')
	const parsed = parseBody(body)
	assert.equal(parsed.intro, '')
	assert.deepEqual(parsed.zh.map((section) => section.kind), ['added'])
	assert.deepEqual(parsed.en.map((section) => section.kind), ['added'])
	assert.equal(parsed.zh[0].items[0].text, '中文条目')
	assert.deepEqual(parsed.zh[0].items[0].authors, ['alice'])
	assert.equal(parsed.en[0].items[0].text, 'English item')
	assert.deepEqual(parsed.en[0].items[0].authors, ['bob'])
})

test('parser: navigation line and compare link never leak into intro/items', () => {
	const body = '[中文](#cn) | [English](#en)\n\nIntro paragraph.\n\n<h3 id="cn">新增功能</h3>\n\n- item one\n\nFull Changelog: [a...b](https://example.com/compare)'
	const parsed = parseBody(body)
	assert.equal(parsed.intro, 'Intro paragraph.')
	assert.equal(parsed.zh[0].items.length, 1)
	assert.equal(parsed.zh[0].items[0].text, 'item one')
})

test('parseRelease rejects unusable payloads and keeps the tag fallback URL', () => {
	assert.equal(parseRelease(null), null)
	assert.equal(parseRelease({ tag_name: 'dsh-vnot-a-version' }), null)
	assert.equal(parseRelease({ tag_name: '' }), null)
	const release = parseRelease({ tag_name: 'dsh-v1.2.3-rc.1', body: '', published_at: null })
	assert.equal(release.version, '1.2.3-rc.1')
	assert.match(release.url, /releases\/tag\/dsh-v1\.2\.3-rc\.1$/)
	assert.deepEqual(release.zh, [])
	assert.deepEqual(release.en, [])
	assert.equal(parseReleases({ nope: true }).length, 0)
})

test('author stripping leaves clean bullet text', () => {
	const newest = fixture('release-0.2.2-rc.1.json')
	const english = newest.en.reduce((all, section) => all.concat(section.items), [])
	assert.ok(english.length > 0)
	for (const item of english) {
		assert.ok(!/\sby\$/i.test(item.text), 'dangling "by" in: ' + item.text)
		assert.ok(!/[（(—–-]\$/.test(item.text), 'dangling punctuation in: ' + item.text)
		assert.ok(item.authors.length > 0, 'English bullets keep their authors')
	}
	const chinese = newest.zh.reduce((all, section) => all.concat(section.items), [])
	for (const item of chinese) {
		assert.ok(!/[（(]\$/.test(item.text), 'dangling bracket in: ' + item.text)
	}
	// Older Chinese bodies use "— @author"; the dash must not survive either.
	const older = fixture('release-0.1.0-rc.7.json')
	for (const section of older.zh) {
		for (const item of section.items) {
			assert.ok(!/[—–-]\$/.test(item.text), 'dangling dash in: ' + item.text)
		}
	}
})

// --- Range / search / standing ---------------------------------------------

test('rangeAggregate is inclusive of the target, order-independent and localized', () => {
	const releases = sortReleases(fixtureReleases())
	const forward = rangeAggregate(releases, '0.2.0-rc.1', '0.2.2-rc.1', 'zh')
	assert.equal(forward.ok, true)
	assert.equal(forward.swapped, false)
	assert.deepEqual(forward.versions, ['0.2.2-rc.1', '0.2.2-alpha.3', '0.2.1-rc.3'])
	assert.deepEqual(forward.counts, { added: 16, improved: 39, fixed: 62, other: 41, total: 158 })
	assert.equal(forward.sections[0].kind, 'added')
	assert.ok(forward.sections[0].items.every((item) => item.version && item.channel))
	const backward = rangeAggregate(releases, '0.2.2-rc.1', '0.2.0-rc.1', 'zh')
	assert.equal(backward.ok, true)
	assert.equal(backward.swapped, true)
	assert.deepEqual(backward.versions, forward.versions)
	assert.deepEqual(rangeAggregate(releases, '0.2.2-rc.1', '0.2.2-rc.1', 'zh').counts, { added: 13, improved: 31, fixed: 53, other: 29, total: 126 })
	assert.equal(rangeAggregate(releases, 'bogus', '0.2.2-rc.1', 'zh').ok, false)
	const english = rangeAggregate(releases, '0.2.0-rc.1', '0.2.2-rc.1', 'en')
	assert.equal(english.ok, true)
	assert.ok(english.counts.total >= 150)
})

test('searchReleases groups matches by version and honors channel/kind filters', () => {
	const releases = sortReleases(fixtureReleases())
	const result = searchReleases(releases, '插件', null, null, 'zh')
	assert.equal(result.ok, true)
	assert.ok(result.total >= 20, 'fixture search should match many plugin mentions, got ' + result.total)
	assert.equal(result.groups[0].version, '0.2.2-rc.1')
	assert.ok(result.groups.every((group) => group.matches.length > 0 && group.matches.every((match) => match.items.length > 0)))
	const alphaOnly = searchReleases(releases, '插件', 'alpha', null, 'zh')
	assert.ok(alphaOnly.groups.every((group) => group.channel === 'alpha'))
	const addedOnly = searchReleases(releases, '插件', null, 'added', 'zh')
	assert.ok(addedOnly.groups.every((group) => group.matches.every((match) => match.kind === 'added')))
	assert.deepEqual(searchReleases(releases, '   ', null, null, 'zh'), { ok: true, query: '', total: 0, truncated: false, groups: [] })
	const english = searchReleases(releases, 'plugin', null, null, 'zh')
	assert.ok(english.total > 0, 'English queries must match English bodies while the UI is Chinese')
	assert.equal(normalizeLang('zh-CN'), 'zh')
	assert.equal(normalizeLang('en-US'), 'en')
	assert.equal(normalizeLang(undefined), 'en')
})

test('localStanding reports the running version position per channel', () => {
	const releases = sortReleases(fixtureReleases())
	const behind = localStanding(releases, '0.2.1-rc.3', 'zh')
	assert.equal(behind.known, true)
	assert.equal(behind.channel, 'stable')
	assert.equal(behind.versionsAhead, 1)
	assert.equal(behind.versionsAheadAll, 2)
	assert.equal(behind.newestSame, '0.2.2-rc.1')
	assert.deepEqual(behind.counts, { added: 13, improved: 31, fixed: 53, other: 29, total: 126 })
	assert.equal(behind.latestStable, '0.2.2-rc.1')
	assert.equal(behind.latestAlpha, '0.2.2-alpha.3')
	const current = localStanding(releases, '0.2.2-rc.1', 'zh')
	assert.equal(current.known, true)
	assert.equal(current.versionsAhead, 0)
	assert.equal(current.newestSame, null)
	const unknown = localStanding(releases, 'not-a-version', 'zh')
	assert.equal(unknown.known, false)
	assert.equal(unknown.version, 'not-a-version')
	assert.equal(unknown.counts.total, 0)
})

test('countKinds matches the per-language section totals', () => {
	const release = fixture('release-0.2.2-rc.1.json')
	assert.deepEqual(countKinds(release, 'zh'), { added: 13, improved: 31, fixed: 53, other: 29, total: 126 })
	assert.deepEqual(countKinds(release, 'en'), { added: 13, improved: 31, fixed: 53, other: 29, total: 126 })
})

// --- Cache + orchestration --------------------------------------------------

test('cache round-trips, rejects corrupt/schema-mismatched files', () => {
	const home = tempHome('cache')
	try {
		const file = cacheFile(home)
		assert.equal(file, path.join(home, 'cache', 'dsh-version-update', 'releases-v1.json'))
		assert.equal(readCache(file), null)
		const entry = { schemaVersion: 1, fetchedAt: 1000, checkedAt: 1000, etag: 'etag-1', releases: [fixture('release-0.2.2-rc.1.json')] }
		assert.equal(writeCache(file, entry), true)
		const loaded = readCache(file)
		assert.equal(loaded.etag, 'etag-1')
		assert.equal(loaded.fetchedAt, 1000)
		assert.equal(loaded.releases.length, 1)
		fs.writeFileSync(file, '{ not json')
		assert.equal(readCache(file), null)
		fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, fetchedAt: 1, checkedAt: 1, releases: [{ version: '1.0.0' }] }))
		assert.equal(readCache(file), null)
	} finally {
		cleanup(home)
	}
})

test('loadChangelog: network -> cache -> TTL -> 304 -> rate-limit degradation', async () => {
	const home = tempHome('load')
	const payload = [loadFixture('release-0.2.2-rc.1.json'), loadFixture('release-0.2.2-alpha.3.json')]
	const response = (status, body, etag) => ({
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (name) => (name === 'etag' ? etag || null : null) },
		json: async () => body
	})
	try {
		resetChangelogMemory()
		let calls = 0
		let clock = 1000
		const fetchImpl = async () => { calls += 1; return response(200, payload, 'etag-a') }
		const now = () => clock
		const first = await loadChangelog({ dshHome: home, fetchImpl, now })
		assert.equal(calls, 1)
		assert.equal(first.releases.length, 2)
		assert.equal(first.fetchedAt, 1000)
		assert.equal(first.checkedAt, 1000)
		assert.equal(first.stale, false)
		assert.equal(first.error, null)
		assert.equal(fs.existsSync(cacheFile(home)), true)

		// Within TTL: served from memory, no network.
		clock = 1000 + Math.floor(CACHE_TTL_MS / 2)
		const cached = await loadChangelog({ dshHome: home, fetchImpl, now })
		assert.equal(calls, 1)
		assert.equal(cached.releases.length, 2)

		// Expired TTL + 304: releases and fetchedAt stay, checkedAt advances.
		clock = 1000 + CACHE_TTL_MS + 1
		const notModifiedImpl = async () => { calls += 1; return { status: 304, ok: false, headers: { get: () => null }, json: async () => null } }
		const unchanged = await loadChangelog({ dshHome: home, fetchImpl: notModifiedImpl, now })
		assert.equal(calls, 2)
		assert.equal(unchanged.fetchedAt, 1000)
		assert.equal(unchanged.checkedAt, clock)
		assert.equal(unchanged.error, null)

		// Forced refresh + rate limit: cached body survives with a stale flag.
		clock += 10
		const limitedImpl = async () => { calls += 1; return response(403, { message: 'rate limited' }) }
		const stale = await loadChangelog({ dshHome: home, refresh: true, fetchImpl: limitedImpl, now })
		assert.equal(calls, 3)
		assert.equal(stale.releases.length, 2)
		assert.equal(stale.stale, true)
		assert.deepEqual(stale.error, { code: 'rate-limit', status: 403 })
	} finally {
		cleanup(home)
	}
})

test('loadChangelog: no cache + network failure yields an empty, error-tagged result', async () => {
	const home = tempHome('empty')
	try {
		resetChangelogMemory()
		const broken = async () => { throw new Error('offline') }
		const result = await loadChangelog({ dshHome: home, fetchImpl: broken })
		assert.deepEqual(result.releases, [])
		assert.equal(result.fetchedAt, null)
		assert.deepEqual(result.error, { code: 'network', status: null })
		resetChangelogMemory()
		const notFound = async () => ({ status: 500, ok: false, headers: { get: () => null }, json: async () => ({}) })
		const second = await loadChangelog({ dshHome: home, fetchImpl: notFound })
		assert.equal(second.error.code, 'http')
		assert.equal(second.error.status, 500)
		resetChangelogMemory()
		const empty = async () => ({ status: 200, ok: true, headers: { get: () => 'x' }, json: async () => [] })
		const third = await loadChangelog({ dshHome: home, fetchImpl: empty })
		assert.equal(third.error.code, 'parse')
	} finally {
		cleanup(home)
	}
})
