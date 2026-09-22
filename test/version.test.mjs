// dsh-version-update — unit tests for the pure version/channel/prompt logic.
//
// Run: node --test test/     (module is ESM; package.json declares "type":"module")
//
// Two families of assertions:
//   1. BEHAVIOR — exercise lib/version.js (the testable copy of the logic).
//   2. DRIFT GUARD — the DSH client module loader cannot resolve "./version.js"
//      at runtime, so the same region is duplicated inside lib/client.js. This
//      suite extracts that region and fails when the two copies diverge, which
//      turns a silent drift into a red test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
	parseVersion,
	compareVersions,
	channelOf,
	channelLabel,
	decideChannel,
	chooseChannel,
	buildStablePrompt,
	buildAlphaPrompt,
	buildRollbackPrompt,
	channelView
} from '../lib/version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');
const versionSource = readFileSync(path.join(here, '..', 'lib', 'version.js'), 'utf8');

const BEGIN = '/*__VERSION_BEGIN__*/';
const END = '/*__VERSION_END__*/';

/** Extract the delimited pure-logic region from a source file. */
function regionOf(source, label) {
	const start = source.indexOf(BEGIN);
	const end = source.indexOf(END);
	assert.notEqual(start, -1, label + ' is missing the ' + BEGIN + ' marker');
	assert.notEqual(end, -1, label + ' is missing the ' + END + ' marker');
	assert.ok(end > start, label + ' has its region markers out of order');
	return source.slice(start + BEGIN.length, end);
}

/** Compare two regions ignoring leading/trailing blank lines and trailing spaces. */
function canonical(region) {
	return region
		.split(/\r?\n/)
		.map((line) => line.replace(/[ \t]+$/, ''))
		.join('\n')
		.replace(/^\n+/, '')
		.replace(/\n+$/, '');
}

/** Collect the top-level names a region declares (function / var). */
function declaredNames(region) {
	const names = new Set();
	for (const m of region.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
	for (const m of region.matchAll(/^var\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
	return names;
}

test('drift guard: the pure region is identical in client.js and version.js', () => {
	const fromClient = regionOf(clientSource, 'lib/client.js');
	const fromVersion = regionOf(versionSource, 'lib/version.js');
	assert.equal(
		canonical(fromClient),
		canonical(fromVersion),
		'the inline region in lib/client.js and lib/version.js have diverged — update both'
	);
	const namesClient = declaredNames(fromClient);
	const namesVersion = declaredNames(fromVersion);
	assert.deepEqual([...namesClient].sort(), [...namesVersion].sort(), 'declared names differ between the two copies');
	assert.ok(namesClient.has('parseVersion') && namesClient.has('channelView'), 'region lost expected declarations');
});

test('drift guard: the region stays pure (no imports, no template literals)', () => {
	const region = regionOf(clientSource, 'lib/client.js');
	assert.ok(!/^\s*import\s/m.test(region), 'region must not contain import statements');
	assert.ok(!/\bok\b\s*\(/.test(region) && !/expect\(/.test(region), 'region must not contain assertions');
	assert.ok(region.indexOf(String.fromCharCode(96)) === -1, 'region must not contain template literals or backticks');
});

test('parseVersion accepts plain, v-prefixed and prerelease versions', () => {
	assert.deepEqual(parseVersion('0.1.5-rc.2'), { major: 0, minor: 1, patch: 5, prerelease: ['rc', '2'] });
	assert.deepEqual(parseVersion('v0.1.5'), { major: 0, minor: 1, patch: 5, prerelease: null });
	assert.deepEqual(parseVersion(' 0.1.7-alpha.1 '), { major: 0, minor: 1, patch: 7, prerelease: ['alpha', '1'] });
	assert.equal(parseVersion('0.1'), null);
	assert.equal(parseVersion('latest'), null);
	assert.equal(parseVersion(''), null);
	assert.equal(parseVersion(null), null);
	assert.equal(parseVersion(undefined), null);
	assert.equal(parseVersion(5), null);
});

test('compareVersions follows semver ordering', () => {
	assert.equal(compareVersions('0.1.7-alpha.1', '0.1.5-rc.2'), 1);
	assert.equal(compareVersions('0.1.5-rc.2', '0.1.7-alpha.1'), -1);
	assert.equal(compareVersions('0.1.5-rc.2', '0.1.5'), -1);
	assert.equal(compareVersions('0.1.5', '0.1.5-rc.2'), 1);
	assert.equal(compareVersions('0.1.6-alpha.2', '0.1.7-alpha.1'), -1);
	assert.equal(compareVersions('0.1.7-alpha.1', '0.1.7-alpha.1'), 0);
	assert.equal(compareVersions('0.1.2-alpha.10', '0.1.2-alpha.9'), 1);
	assert.equal(compareVersions('0.1.2-alpha.2', '0.1.2-alpha.a'), -1);
	assert.equal(compareVersions('0.1.5-rc.2', '0.1.5-rc.2'), 0);
	assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
	assert.equal(compareVersions('0.1.5-rc.2', 'nonsense'), null);
	assert.equal(compareVersions(null, '0.1.5'), null);
});

test('channelOf classifies rc as stable and alpha as alpha', () => {
	assert.equal(channelOf('0.1.7-alpha.1'), 'alpha');
	assert.equal(channelOf('0.1.2-alpha.10'), 'alpha');
	assert.equal(channelOf('0.1.5-rc.2'), 'stable');
	assert.equal(channelOf('0.1.5'), 'stable');
	assert.equal(channelOf('v0.1.5-rc.3'), 'stable');
	assert.equal(channelOf(''), null);
	assert.equal(channelOf(null), null);
	assert.equal(channelOf('garbage'), null);
	assert.equal(channelLabel('alpha'), 'Alpha 预览版');
	assert.equal(channelLabel('stable'), '官方正式版');
	assert.equal(channelLabel(null), '未知渠道');
});

test('decideChannel: same-channel updates', () => {
	assert.equal(decideChannel({ localVersion: '0.1.5-rc.2', localChannel: 'stable', channel: 'stable', target: '0.1.7-rc.1' }).kind, 'update');
	assert.equal(decideChannel({ localVersion: '0.1.5-rc.2', localChannel: 'stable', channel: 'stable', target: '0.1.5-rc.2' }).kind, 'current');
	assert.equal(decideChannel({ localVersion: '0.1.5-rc.2', localChannel: 'stable', channel: 'alpha', target: '0.1.7-alpha.1' }).kind, 'update');
	assert.equal(decideChannel({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', channel: 'alpha', target: '0.1.7-alpha.1' }).kind, 'current');
	assert.equal(decideChannel({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', channel: 'alpha', target: '0.1.6-alpha.2' }).kind, 'ahead');
	assert.equal(decideChannel({ localVersion: '0.1.9-alpha.1', localChannel: 'alpha', channel: 'alpha', target: '0.1.7-alpha.1' }).kind, 'ahead');
});

test('decideChannel: an alpha install is never told to downgrade to the stable line', () => {
	// Same core, or an older core: not an update, and never a prompt.
	const noDowngrade = ['0.1.7-rc.2', '0.1.7', '0.1.5-rc.2', '0.1.6-rc.1'];
	for (const stableTarget of noDowngrade) {
		const decision = decideChannel({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', channel: 'stable', target: stableTarget });
		assert.equal(decision.kind, 'ahead', 'stable ' + stableTarget + ' must not be an update for 0.1.7-alpha.1');
		assert.equal(decision.canPrompt, false, 'no downgrade prompt for stable ' + stableTarget);
	}
	// Higher cores and a higher minor line ARE newer stable releases, so they
	// legitimately offer the switch back to the stable line.
	const newerSameMinor = decideChannel({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', channel: 'stable', target: '0.1.8-rc.1' });
	assert.equal(newerSameMinor.kind, 'update');
	assert.equal(newerSameMinor.canPrompt, true);
	const higherMinor = decideChannel({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', channel: 'stable', target: '0.2.0-rc.1' });
	assert.equal(higherMinor.kind, 'update');
	const higherCore = decideChannel({ localVersion: '0.1.2-alpha.1', localChannel: 'alpha', channel: 'stable', target: '0.1.7-rc.2' });
	assert.equal(higherCore.kind, 'update');
	assert.equal(higherCore.canPrompt, true);
});

test('decideChannel: never guesses from missing or unparseable versions', () => {
	assert.equal(decideChannel({ localVersion: null, localChannel: null, channel: 'stable', target: '0.1.5-rc.2' }).kind, 'uncomparable');
	assert.equal(decideChannel({ localVersion: 'garbage', localChannel: null, channel: 'stable', target: '0.1.5-rc.2' }).kind, 'uncomparable');
	assert.equal(decideChannel({ localVersion: '0.1.5-rc.2', localChannel: 'stable', channel: 'stable', target: null }).kind, 'uncomparable');
	assert.equal(decideChannel({ localVersion: '0.1.5-rc.2', localChannel: 'stable', channel: 'alpha', target: '' }).kind, 'uncomparable');
	assert.equal(decideChannel({ localVersion: '0.1.5-rc.2', localChannel: 'stable', channel: 'alpha', target: 'nope' }).kind, 'uncomparable');
});

test('chooseChannel prefers an explicit channel and infers from the version otherwise', () => {
	assert.equal(chooseChannel('alpha', '0.1.5-rc.2'), 'alpha');
	assert.equal(chooseChannel('stable', '0.1.7-alpha.1'), 'stable');
	assert.equal(chooseChannel(undefined, '0.1.7-alpha.1'), 'alpha');
	assert.equal(chooseChannel(undefined, '0.1.5-rc.2'), 'stable');
	assert.equal(chooseChannel(undefined, null), 'stable');
});

test('buildStablePrompt pins the exact target and carries a rollback command', () => {
	const prompt = buildStablePrompt({ localVersion: '0.1.5-rc.2', localChannel: 'stable', target: '0.1.7-rc.1' });
	assert.match(prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.7-rc\.1/);
	assert.match(prompt, /dsh --version/);
	assert.match(prompt, /回退命令：npm install -g @deepseek-ai\/dsh@0\.1\.5-rc\.2/);
	assert.match(prompt, /\$DSH_HOME/);
	assert.match(prompt, /不要用 @latest/);
	assert.ok(!/开发者预览通道/.test(prompt), 'the stable prompt must not claim the alpha preview warning');
	assert.ok(!/@alpha/.test(prompt));
});

test('buildStablePrompt marks a stable install as a rollback when the local build is alpha', () => {
	const prompt = buildStablePrompt({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', target: '0.1.7-rc.2' });
	assert.match(prompt, /降级\/回退操作/);
	assert.match(prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.7-rc\.2/);
	assert.match(prompt, /回退命令：npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
});

test('buildAlphaPrompt warns about the preview line and always offers the way back', () => {
	const prompted = buildAlphaPrompt({ localVersion: '0.1.5-rc.2', localChannel: 'stable', target: '0.1.7-alpha.1' });
	assert.match(prompted, /npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
	assert.match(prompted, /开发者预览通道/);
	assert.match(prompted, /pre-release/);
	assert.match(prompted, /\$DSH_HOME/);
	assert.match(prompted, /备份/);
	assert.match(prompted, /回退到官方正式版/);
	assert.match(prompted, /不要用 @alpha 或 @latest/);
	assert.match(prompted, /从正式版线路切换到 Alpha 预览线路/);

	const sameLine = buildAlphaPrompt({ localVersion: '0.1.6-alpha.1', localChannel: 'alpha', target: '0.1.7-alpha.1' });
	assert.ok(!/从正式版线路切换到 Alpha 预览线路/.test(sameLine), 'alpha→alpha must not claim a channel switch');
	assert.match(sameLine, /npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
});

test('buildRollbackPrompt is explicit about the downgrade and the pinned target', () => {
	const prompt = buildRollbackPrompt({ target: '0.1.5-rc.2', currentVersion: '0.1.7-alpha.1', currentChannel: 'alpha' });
	assert.match(prompt, /切回官方正式版 0\.1\.5-rc\.2/);
	assert.match(prompt, /降级\/回退操作/);
	assert.match(prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.5-rc\.2/);
});

test('channelView is the single source of truth for the two blocks', () => {
	const stableBlock = channelView({ channel: 'stable', target: '0.1.5-rc.2', localVersion: '0.1.5-rc.2', localChannel: 'stable' });
	assert.equal(stableBlock.decision, 'current');
	assert.equal(stableBlock.statusKind, 'ok');
	assert.equal(stableBlock.prompt, null);

	const alphaUpdate = channelView({ channel: 'alpha', target: '0.1.7-alpha.1', localVersion: '0.1.5-rc.2', localChannel: 'stable' });
	assert.equal(alphaUpdate.decision, 'update');
	assert.equal(alphaUpdate.statusKind, 'update');
	assert.match(alphaUpdate.prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
	assert.match(alphaUpdate.promptLabel, /Alpha/);

	// The regression this feature exists for: an alpha install sees the older
	// stable target as a neutral note, never as a downgrade offer.
	const stableWhileAlpha = channelView({ channel: 'stable', target: '0.1.5-rc.2', localVersion: '0.1.7-alpha.1', localChannel: 'alpha' });
	assert.equal(stableWhileAlpha.decision, 'ahead');
	assert.equal(stableWhileAlpha.prompt, null);
	assert.match(stableWhileAlpha.status, /Alpha 预览版/);
	assert.match(stableWhileAlpha.status, /降级操作/);

	const unknown = channelView({ channel: 'stable', target: '0.1.5-rc.2', localVersion: null, localChannel: null });
	assert.equal(unknown.decision, 'uncomparable');
	assert.equal(unknown.prompt, null);
	assert.match(unknown.status, /无法对比/);

	const missing = channelView({ channel: 'alpha', target: null, localVersion: '0.1.5-rc.2', localChannel: 'stable' });
	assert.equal(missing.decision, null);
	assert.equal(missing.prompt, null);
	assert.equal(missing.status, '');
});
