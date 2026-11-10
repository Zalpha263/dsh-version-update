// dsh-version-update — client bundle smoke test.
//
// The DSH client module loader hands the bundle a classic-script wrapper and a
// single synchronous require (react only), so the bundle is not a normal ESM
// module. This test executes it the way the loader does, with stubbed React and
// DOM, and asserts the registration contract without a browser:
//   - module-loader shape and package id
//   - Remote contribution: 4 methods and their parameter wires
//   - locale dictionaries and the settings.section entry (localized label)
//   - one render of the root component with empty data (must not throw)
// It also pins the package layout and the fact that the old update-prompt
// machinery is gone.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'lib', 'client.js')
const clientSource = fs.readFileSync(clientPath, 'utf8')

function createHarness() {
	const captured = { definition: null }
	const styles = []
	const documentStub = {
		contains: () => true,
		head: { appendChild: (node) => { styles.push(node) } },
		createElement: (tag) => {
			const node = {
				tagName: tag,
				attrs: {},
				children: [],
				setAttribute(name, value) { this.attrs[name] = value },
				appendChild(child) { this.children.push(child); return child },
				removeChild() {}
			}
			return node
		},
		createTextNode: (text) => ({ text: text })
	}
	const windowStub = {
		__ModuleLoader__: { load: (definition) => { captured.definition = definition } },
		setTimeout: () => 0,
		clearTimeout: () => {}
	}
	const React = {
		createElement: (type, props, ...children) => ({ type: type, props: Object.assign({}, props || {}, { children: children }), children: children }),
		useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
		useEffect: () => {},
		useRef: (value) => ({ current: value }),
		useCallback: (fn) => fn,
		useMemo: (fn) => fn(),
		useSyncExternalStore: () => null
	}
	const registered = []
	const effects = []
	const dictionaries = {}
	let mounted = null
	const locale = {
		register: (namespace, dicts) => {
			dictionaries[namespace] = dicts
			return () => {}
		},
		bind: (namespace) => {
			return (key, params) => {
				const dict = dictionaries[namespace] && dictionaries[namespace].zh ? dictionaries[namespace].zh : {}
				let template = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
				if (params) {
					template = template.replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
				}
				return template
			}
		},
		getSnapshot: () => ({ active: 'zh-CN', revision: 0 }),
		subscribe: () => () => {}
	}
	const namespace = {
		info: async () => ({ ok: true, value: {} }),
		changelog: async () => ({ ok: true, value: {} }),
		range: async () => ({ ok: true, value: {} }),
		search: async () => ({ ok: true, value: {} })
	}
	const slots = {
		inject: (name, fn) => {
			const disposer = fn()
			return typeof disposer === 'function' ? disposer : () => {}
		},
		register: (options, render) => {
			registered.push({ options: options, render: render })
			return () => {}
		}
	}
	const ctx = {
		locale: locale,
		get: (key) => {
			if (key === 'slots') return slots
			if (key === 'remote.versionUpdate') return namespace
			return undefined
		},
		remote: {
			$mount: async (contribution) => {
				mounted = contribution
				return async () => {}
			}
		},
		effect: (fn) => {
			const disposer = fn()
			effects.push(disposer)
		}
	}
	return {
		captured: captured,
		documentStub: documentStub,
		windowStub: windowStub,
		React: React,
		ctx: ctx,
		registered: registered,
		effects: effects,
		styles: styles,
		dictionaries: dictionaries,
		getMounted: () => mounted
	}
}

function loadBundle() {
	const harness = createHarness()
	const requireStub = (specifier) => {
		if (specifier === 'react') return harness.React
		throw new Error('unexpected require: ' + specifier)
	}
	const execute = new Function('window', 'document', 'require', clientSource)
	execute(harness.windowStub, harness.documentStub, requireStub)
	assert.ok(harness.captured.definition !== null, 'the bundle must call window.__ModuleLoader__.load')
	const exports = harness.captured.definition.factory(requireStub)
	return { harness: harness, exports: exports }
}

test('bundle shape: module loader, package id, no update-prompt leftovers', () => {
	assert.match(clientSource, /window\.__ModuleLoader__\.load\(/)
	assert.match(clientSource, /id: "dsh-version-update"/)
	assert.match(clientSource, /settings\.section/)
	assert.match(clientSource, /ctx\.locale\.register/)
	assert.ok(!clientSource.includes('checkChannels'), 'the npm dist-tag update check is gone')
	assert.ok(!clientSource.includes('buildStablePrompt'), 'update prompt templates are gone')
	assert.ok(!clientSource.includes('升级提示词'), 'no update-prompt copy remains')
	assert.ok(!clientSource.includes('npm install -g @deepseek-ai/dsh'), 'the plugin no longer instructs npm upgrades')
})

test('apply mounts the remote contribution, dictionaries and settings section', async () => {
	const loaded = loadBundle()
	const exports = loaded.exports
	const harness = loaded.harness
	assert.equal(typeof exports.apply, 'function')
	assert.deepEqual(exports.inject, ['slots', 'remote', 'locale'])
	await exports.apply(harness.ctx)

	const contribution = harness.getMounted()
	assert.ok(contribution !== null, 'remote namespace must be mounted')
	assert.equal(contribution.package, 'dsh-version-update')
	assert.deepEqual(contribution.descriptors.map((item) => item.method), ['info', 'changelog', 'range', 'search'])
	const changelog = contribution.descriptors.find((item) => item.method === 'changelog')
	assert.deepEqual(changelog.parameters.map((item) => item.name), ['refresh', 'lang'])
	assert.ok(changelog.parameters.every((item) => item.acceptsUndefined === true))
	const range = contribution.descriptors.find((item) => item.method === 'range')
	assert.deepEqual(range.parameters.map((item) => item.name), ['from', 'to', 'lang'])
	assert.equal(range.parameters[2].acceptsUndefined, true)
	assert.ok(!range.parameters[0].acceptsUndefined)

	const dicts = harness.dictionaries.versionUpdate
	assert.ok(dicts && dicts.zh && dicts.en, 'zh/en dictionaries must be registered')
	assert.equal(dicts.zh.nav, '更新日志')
	assert.equal(dicts.en.nav, 'Changelog')
	for (const key of ['title', 'intro', 'kind.added', 'kind.improved', 'kind.fixed', 'kind.other', 'search.result', 'range.total', 'standing.ahead']) {
		assert.ok(Object.prototype.hasOwnProperty.call(dicts.zh, key), 'zh dictionary missing ' + key)
		assert.ok(Object.prototype.hasOwnProperty.call(dicts.en, key), 'en dictionary missing ' + key)
	}

	assert.equal(harness.registered.length, 1)
	const entry = harness.registered[0]
	assert.equal(entry.options.name, 'settings.section')
	assert.equal(entry.options.id, 'version-update')
	assert.equal(entry.options.order, 30)
	assert.equal(typeof entry.options.label, 'function')
	assert.equal(entry.options.label(), '更新日志')

	assert.equal(harness.styles.length, 1)
	assert.equal(harness.styles[0].attrs['data-plugin'], 'dsh-version-update')
	assert.match(harness.styles[0].children[0].text, /\.vu-section\{/)
})

test('package layout matches the changelog viewer contract', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
	assert.equal(pkg.name, 'dsh-version-update')
	assert.equal(pkg.version, '2.0.0')
	assert.equal(pkg.engines && pkg.engines.dsh, '>=0.2.0-rc.1 <0.3.0-0')
	assert.ok(pkg.peerDependencies && pkg.peerDependencies['@deepseek-ai/dsh-typert-protocol'], 'typert peer stays declared')
	assert.ok(pkg.exports && pkg.exports['./client'], 'the client entry is exported')
	assert.equal(pkg.exports['./version'], undefined, 'the old pure-logic export is gone')
	assert.equal(fs.existsSync(path.join(here, '..', 'lib', 'version.js')), false)
	assert.ok(Array.isArray(pkg.files) && pkg.files.includes('lib') && pkg.files.includes('icon.svg'))
	const icon = fs.readFileSync(path.join(here, '..', 'icon.svg'), 'utf8')
	assert.match(icon, /viewBox="0 0 16 16"/)
	assert.match(icon, /stroke="currentColor"/)
	const host = fs.readFileSync(path.join(here, '..', 'lib', 'index.js'), 'utf8')
	assert.match(host, /super\(ctx, 'versionUpdate'\)/)
	for (const method of ['info', 'changelog', 'range', 'search']) {
		assert.ok(host.includes("markRemote('" + method + "')"), 'host must mark ' + method + ' as Remote')
	}
	assert.ok(!host.includes('checkChannels'), 'the host no longer exposes the npm update check')
});

test('root component renders with empty data without throwing', async () => {
	const loaded = loadBundle()
	await loaded.exports.apply(loaded.harness.ctx)
	const entry = loaded.harness.registered[0]
	const element = entry.render({})
	assert.equal(typeof element.type, 'function')
	const tree = element.type(element.props)
	assert.equal(tree.type, 'section')
	assert.equal(tree.props.className, 'vu-section')
	const classNames = []
	const walk = (node) => {
		if (node === null || typeof node !== 'object') return
		// Function elements are pure renderers here (only the root uses hooks),
		// so expand them instead of stopping at the element descriptor.
		if (typeof node.type === 'function') {
			walk(node.type(node.props))
			return
		}
		if (node.props && typeof node.props.className === 'string') classNames.push(node.props.className)
		const children = Array.isArray(node.children) ? node.children : []
		for (const child of children) walk(child)
	}
	walk(tree)
	assert.ok(classNames.includes('vu-card'), 'environment card renders')
	assert.ok(classNames.includes('vu-toolbar'), 'toolbar renders')
	assert.ok(classNames.includes('vu-status'), 'loading status renders')
})
