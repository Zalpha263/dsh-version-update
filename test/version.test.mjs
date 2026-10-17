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
	promptTargetOf,
	buildStablePrompt,
	buildAlphaPrompt,
	buildRollbackPrompt,
	channelView,
	newestByChannel,
	resolveChannelResults
} from '../lib/version.js';
import { findDshRoot, installEnvironmentOf } from '../lib/probe.js';

// Every prompt/channel test written before v1.4.1 describes the npm-global CLI
// install, which was the only install source the plugin knew. Pin that source
// explicitly so those tests keep specifying the CLI contract; the desktop and
// unknown-source variants are covered by their own tests below.
const CLI_INSTALL = { installSource: 'npmRoot' };
const cliStablePrompt = (input) => buildStablePrompt({ ...CLI_INSTALL, ...input });
const cliAlphaPrompt = (input) => buildAlphaPrompt({ ...CLI_INSTALL, ...input });
const cliRollbackPrompt = (input) => buildRollbackPrompt({ ...CLI_INSTALL, ...input });
const cliChannelView = (input) => channelView({ ...CLI_INSTALL, ...input });

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

test('decideChannel: while on alpha the stable line is ALWAYS actionable', () => {
	// Regression under test: 0.1.7-alpha.2 running, 0.1.7-rc.1 published on the
	// stable line. The old "same core is not an update" guard hid it; semver
	// ranks rc.1 above alpha.2, so this IS an update and must offer a prompt.
	const sameCoreNewerRc = decideChannel({ localVersion: '0.1.7-alpha.2', localChannel: 'alpha', channel: 'stable', target: '0.1.7-rc.1' });
	assert.equal(sameCoreNewerRc.kind, 'update');
	assert.equal(sameCoreNewerRc.canPrompt, true);

	// Any stable target that outranks the running alpha is an update.
	for (const target of ['0.1.7-rc.2', '0.1.7', '0.1.8-rc.1', '0.2.0-rc.1']) {
		const decision = decideChannel({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', channel: 'stable', target: target });
		assert.equal(decision.kind, 'update', 'stable ' + target + ' outranks 0.1.7-alpha.1');
		assert.equal(decision.canPrompt, true, 'stable ' + target + ' must offer a prompt');
	}

	// An OLDER stable target is never sold as an upgrade, but the block must
	// still offer the way back — that is what the "switch" kind means.
	for (const target of ['0.1.5-rc.3', '0.1.6-rc.1', '0.1.7-alpha.0']) {
		const decision = decideChannel({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', channel: 'stable', target: target });
		assert.equal(decision.kind, 'switch', 'stable ' + target + ' is older than 0.1.7-alpha.1');
		assert.equal(decision.canPrompt, true, 'an alpha user must always be able to return to the stable line');
	}

	// A stable build that leads the stable channel still has nothing to do.
	const stableAhead = decideChannel({ localVersion: '0.1.7-rc.1', localChannel: 'stable', channel: 'stable', target: '0.1.5-rc.3' });
	assert.equal(stableAhead.kind, 'ahead');
	assert.equal(stableAhead.canPrompt, false);
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
	const prompt = cliStablePrompt({ localVersion: '0.1.5-rc.2', localChannel: 'stable', target: '0.1.7-rc.1' });
	assert.match(prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.7-rc\.1/);
	assert.match(prompt, /dsh --version/);
	assert.match(prompt, /回退命令：npm install -g @deepseek-ai\/dsh@0\.1\.5-rc\.2/);
	assert.match(prompt, /\$DSH_HOME/);
	assert.match(prompt, /不要用 @latest/);
	// Trimmed on request: the note keeps the requirement, drops the explanation.
	assert.ok(!/latest 标签可能解析到别的发行线/.test(prompt), 'drop the long @latest explanation');
	assert.ok(!/dist-tag/.test(prompt), 'drop dist-tag jargon from the prompt body');
	assert.ok(!/开发者预览通道/.test(prompt), 'the stable prompt must not claim the alpha preview warning');
	assert.ok(!/@alpha/.test(prompt));
});

test('buildStablePrompt: an undetectable local version still yields a usable prompt', () => {
	// "Return to the stable line at any time" must not depend on version
	// detection: the prompt goes neutral instead of refusing to target a build.
	const neutral = cliStablePrompt({ localVersion: null, localChannel: null, target: '0.1.7-rc.1' });
	assert.match(neutral, /切换到官方正式版 0\.1\.7-rc\.1/);
	assert.match(neutral, /本机版本未能识别/);
	assert.match(neutral, /npm install -g @deepseek-ai\/dsh@0\.1\.7-rc\.1/);
	assert.match(neutral, /dsh --version，确认输出为 0\.1\.7-rc\.1/);
	assert.match(neutral, /@<升级前版本>/);
	assert.ok(!/属于升级|属于降级/.test(neutral), 'the direction must stay unknown');
	assert.ok(!/当前渠道 官方正式版/.test(neutral), 'the local channel must not be guessed');
	assert.ok(!/从 Alpha 预览线路切回/.test(neutral), 'no alpha line switch may be invented');
});

test('buildStablePrompt: alpha→stable calls the line switch what it is', () => {
	// Newer stable target: a line switch that also moves the version UP.
	const upgrade = cliStablePrompt({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', target: '0.1.7-rc.2' });
	assert.match(upgrade, /从 Alpha 预览线路切回官方正式版线路/);
	assert.match(upgrade, /目标版本高于当前 Alpha，属于升级/);
	assert.ok(!/降级\/回退/.test(upgrade), 'an rc above the running alpha is not a downgrade');
	assert.match(upgrade, /npm install -g @deepseek-ai\/dsh@0\.1\.7-rc\.2/);
	assert.match(upgrade, /回退命令：npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
	// Step numbering stays sequential after the extra line-switch step.
	assert.match(upgrade, /\n2\. /);
	assert.match(upgrade, /\n3\. 官方安装命令/);
	assert.match(upgrade, /\n4\. 升级后运行/);
	assert.match(upgrade, /\n5\. 确认后提醒/);

	// Older stable target: still the line switch, honestly labelled a rollback.
	const rollback = cliStablePrompt({ localVersion: '0.1.7-alpha.1', localChannel: 'alpha', target: '0.1.5-rc.3' });
	assert.match(rollback, /目标版本低于当前 Alpha，属于降级\/回退/);
});

test('buildAlphaPrompt warns about the preview line and always offers the way back', () => {
	const prompted = cliAlphaPrompt({ localVersion: '0.1.5-rc.2', localChannel: 'stable', target: '0.1.7-alpha.1' });
	assert.match(prompted, /npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
	assert.match(prompted, /开发者预览通道/);
	assert.match(prompted, /可能包含破坏兼容性的变更/);
	// Trimmed on request: no npm/GitHub jargon and no "not for production" gate.
	assert.ok(!/pre-release/.test(prompted), 'drop the GitHub pre-release jargon');
	assert.ok(!/dist-tag/.test(prompted), 'drop the dist-tag jargon from the prompt body');
	assert.ok(!/不适合生产/.test(prompted), 'drop the "not for production" discouragement');
	assert.match(prompted, /\$DSH_HOME/);
	// No backup step: the install only replaces the global package (the closing
	// line says so), so a numbered "back up first" instruction contradicted it.
	assert.ok(!/备份/.test(prompted), 'the alpha prompt must not ask for a $DSH_HOME backup');
	assert.match(prompted, /回退到官方正式版/);
	assert.match(prompted, /不要用 @alpha 或 @latest/);
	assert.match(prompted, /从正式版线路切换到 Alpha 预览线路/);
	// Numbering stays sequential with the backup step gone (switching case: 3–7).
	assert.match(prompted, /\n3\. 这会把你从正式版线路切换/);
	assert.match(prompted, /\n4\. 官方安装命令/);
	assert.match(prompted, /\n5\. 升级后运行/);
	assert.match(prompted, /\n6\. 确认后提醒/);
	assert.match(prompted, /\n7\. 如遇到插件或会话异常/);
	assert.ok(!/\n8\. /.test(prompted), 'no step 8 may be left behind');

	const sameLine = cliAlphaPrompt({ localVersion: '0.1.6-alpha.1', localChannel: 'alpha', target: '0.1.7-alpha.1' });
	assert.ok(!/从正式版线路切换到 Alpha 预览线路/.test(sameLine), 'alpha→alpha must not claim a channel switch');
	assert.ok(!/备份/.test(sameLine), 'alpha→alpha must not ask for a backup either');
	assert.match(sameLine, /npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
	assert.match(sameLine, /\n3\. 官方安装命令/);
	assert.match(sameLine, /\n6\. 如遇到插件或会话异常/);
});

test('buildRollbackPrompt is explicit about the downgrade and the pinned target', () => {
	const prompt = cliRollbackPrompt({ target: '0.1.5-rc.2', currentVersion: '0.1.7-alpha.1', currentChannel: 'alpha' });
	assert.match(prompt, /切回官方正式版 0\.1\.5-rc\.2/);
	assert.match(prompt, /降级\/回退操作/);
	assert.match(prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.5-rc\.2/);
});

test('buildRollbackPrompt names the right origin line', () => {
	// From a stable build that runs ahead of the channel: it is NOT an alpha
	// install, so the prompt must not claim an "Alpha 线路" switch.
	const fromStable = cliRollbackPrompt({ target: '0.1.5-rc.3', currentVersion: '0.1.7-rc.1', currentChannel: 'stable' });
	assert.match(fromStable, /回退到正式版渠道当前版本 0\.1\.5-rc\.3/);
	assert.match(fromStable, /本机版本高于渠道当前版本/);
	assert.match(fromStable, /降级\/回退操作/);
	assert.match(fromStable, /npm install -g @deepseek-ai\/dsh@0\.1\.5-rc\.3/);
	assert.ok(!/Alpha/.test(fromStable), 'a stable origin must not be described as an Alpha line');
});

test('newestByChannel: a channel is every tag classified into it, not one tag', () => {
	// The live registry shape that produced the bug report.
	const live = [
		{ tag: 'latest', version: '0.1.5-rc.3' },
		{ tag: 'next', version: '0.1.7-rc.1' },
		{ tag: 'alpha', version: '0.1.7-alpha.2' }
	];
	const best = newestByChannel(live);
	assert.deepEqual(best.stable, { tag: 'next', version: '0.1.7-rc.1' });
	assert.deepEqual(best.alpha, { tag: 'alpha', version: '0.1.7-alpha.2' });

	// `latest` wins when it is genuinely the newest stable tag.
	assert.deepEqual(
		newestByChannel([{ tag: 'latest', version: '0.1.9-rc.1' }, { tag: 'next', version: '0.1.7-rc.1' }]).stable,
		{ tag: 'latest', version: '0.1.9-rc.1' }
	);
	// Unparseable / malformed entries are ignored, never guessed at.
	assert.deepEqual(
		newestByChannel([{ tag: 'x', version: 'garbage' }, null, {}, { tag: 'alpha', version: '0.2.0-alpha.1' }]).stable,
		null
	);
	assert.deepEqual(newestByChannel(null), { stable: null, alpha: null });
});

test('resolveChannelResults reports each channel target with its provenance', () => {
	const channels = resolveChannelResults([
		{ tag: 'latest', version: '0.1.5-rc.3' },
		{ tag: 'next', version: '0.1.7-rc.1' },
		{ tag: 'alpha', version: '0.1.7-alpha.2' }
	]);
	assert.equal(channels.stable.version, '0.1.7-rc.1');
	assert.equal(channels.stable.sourceTag, 'next');
	assert.equal(channels.stable.latestVersion, '0.1.5-rc.3');
	assert.equal(channels.stable.error, null);
	assert.equal(channels.alpha.version, '0.1.7-alpha.2');
	assert.equal(channels.alpha.sourceTag, 'alpha');
	assert.equal(channels.alpha.error, null);

	// A channel with no parseable tag reports an error instead of a guess.
	const empty = resolveChannelResults([{ tag: 'latest', version: '0.1.5-rc.3' }]);
	assert.equal(empty.stable.version, '0.1.5-rc.3');
	assert.equal(empty.alpha.version, null);
	assert.match(empty.alpha.error, /Alpha/);
});

test('channelView is the single source of truth for the two blocks', () => {
	const stableBlock = cliChannelView({ channel: 'stable', target: '0.1.5-rc.2', localVersion: '0.1.5-rc.2', localChannel: 'stable' });
	assert.equal(stableBlock.decision, 'current');
	assert.equal(stableBlock.statusKind, 'ok');
	assert.equal(stableBlock.prompt, null);

	const alphaUpdate = cliChannelView({ channel: 'alpha', target: '0.1.7-alpha.1', localVersion: '0.1.5-rc.2', localChannel: 'stable' });
	assert.equal(alphaUpdate.decision, 'update');
	assert.equal(alphaUpdate.statusKind, 'update');
	assert.match(alphaUpdate.prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.7-alpha\.1/);
	assert.match(alphaUpdate.promptLabel, /Alpha/);

	// While on alpha the stable block is NEVER prompt-less. A newer stable
	// target is an update — the exact report: 0.1.7-alpha.2 installed while the
	// stable line already published 0.1.7-rc.1 (npm `next`) …
	const stableUpgradeWhileAlpha = cliChannelView({
		channel: 'stable',
		target: '0.1.7-rc.1',
		localVersion: '0.1.7-alpha.2',
		localChannel: 'alpha',
		sourceTag: 'next',
		altLatest: '0.1.5-rc.3'
	});
	assert.equal(stableUpgradeWhileAlpha.decision, 'update');
	assert.equal(stableUpgradeWhileAlpha.statusKind, 'update');
	assert.match(stableUpgradeWhileAlpha.status, /可切回正式版线路/);
	assert.match(stableUpgradeWhileAlpha.prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.7-rc\.1/);
	assert.match(stableUpgradeWhileAlpha.promptLabel, /升级提示词/);
	// … and it explains why that number is not the npm `latest` tag.
	assert.match(stableUpgradeWhileAlpha.note, /next 标签/);
	assert.match(stableUpgradeWhileAlpha.note, /latest 标签当前为 v0\.1\.5-rc\.3/);

	// … while an OLDER stable target offers the labelled switch-back prompt
	// instead of a silent "you are ahead, do nothing".
	const stableWhileAlpha = cliChannelView({ channel: 'stable', target: '0.1.5-rc.2', localVersion: '0.1.7-alpha.1', localChannel: 'alpha' });
	assert.equal(stableWhileAlpha.decision, 'switch');
	assert.equal(stableWhileAlpha.promptLabel, '切回正式版提示词（复制后粘贴给 DeepSeek）');
	assert.match(stableWhileAlpha.prompt, /切回官方正式版 0\.1\.5-rc\.2/);
	assert.match(stableWhileAlpha.prompt, /降级\/回退操作/);
	assert.match(stableWhileAlpha.status, /可随时切回正式版线路/);
	// No provenance note when the target IS the `latest` tag (nothing to explain).
	assert.equal(stableWhileAlpha.note, null);

	const unknownLocal = cliChannelView({ channel: 'stable', target: '0.1.7-rc.1', localVersion: null, localChannel: null });
	assert.equal(unknownLocal.decision, 'uncomparable');
	// Confirmed policy: a known stable target stays actionable even when the
	// local version could not be detected — the prompt goes neutral instead of
	// disappearing, and never claims which way the version moves.
	assert.equal(unknownLocal.promptLabel, '切换提示词（复制后粘贴给 DeepSeek）');
	assert.match(unknownLocal.prompt, /切换到官方正式版 0\.1\.7-rc\.1/);
	assert.match(unknownLocal.prompt, /npm install -g @deepseek-ai\/dsh@0\.1\.7-rc\.1/);
	assert.match(unknownLocal.prompt, /本机版本未能识别/);
	assert.ok(!/官方正式版到/.test(unknownLocal.prompt), 'an unknown local version must not be called an upgrade');
	assert.ok(!/当前渠道 官方正式版/.test(unknownLocal.prompt), 'an unknown channel must not be guessed');
	assert.match(unknownLocal.status, /可复制下方提示词/);

	// The alpha block stays prompt-less when nothing can be compared.
	const unknownAlpha = cliChannelView({ channel: 'alpha', target: '0.1.7-alpha.1', localVersion: null, localChannel: null });
	assert.equal(unknownAlpha.decision, 'uncomparable');
	assert.equal(unknownAlpha.prompt, null);

	// A build ahead of the stable channel (Q2): not an upgrade, but the user
	// can still return to the exact published channel version.
	const stableAhead = cliChannelView({ channel: 'stable', target: '0.1.5-rc.3', localVersion: '0.1.7-rc.1', localChannel: 'stable' });
	assert.equal(stableAhead.decision, 'ahead');
	assert.equal(stableAhead.promptLabel, '切回渠道版本提示词（复制后粘贴给 DeepSeek）');
	assert.match(stableAhead.prompt, /回退到正式版渠道当前版本 0\.1\.5-rc\.3/);
	assert.match(stableAhead.prompt, /本机版本高于渠道当前版本/);
	assert.ok(!/升级 dsh/.test(stableAhead.prompt), 'a channel-return must not be sold as an upgrade');
	assert.match(stableAhead.status, /如需回到渠道当前版本/);

	// The alpha block keeps its neutral note when the running build leads it.
	const alphaAhead = cliChannelView({ channel: 'alpha', target: '0.1.6-alpha.2', localVersion: '0.1.7-alpha.1', localChannel: 'alpha' });
	assert.equal(alphaAhead.decision, 'ahead');
	assert.equal(alphaAhead.prompt, null);

	const missing = cliChannelView({ channel: 'alpha', target: null, localVersion: '0.1.5-rc.2', localChannel: 'stable' });
	assert.equal(missing.decision, null);
	assert.equal(missing.prompt, null);
	assert.equal(missing.status, '');
});

test('promptTargetOf picks the updater from the authoritative environment first', () => {
	// The Host's installEnvironment is authoritative when present.
	assert.equal(promptTargetOf('clientModules', 'desktop'), 'desktop');
	assert.equal(promptTargetOf('desktopApp', 'cli'), 'cli');
	assert.equal(promptTargetOf('pluginPackages', 'desktop'), 'desktop');
	assert.equal(promptTargetOf('pluginPackages', 'cli'), 'cli');

	// Probe names are the fallback for a Host built before installEnvironment.
	assert.equal(promptTargetOf('desktopApp'), 'desktop');
	assert.equal(promptTargetOf('clientModules'), 'cli');
	assert.equal(promptTargetOf('require'), 'cli');
	assert.equal(promptTargetOf('npmRoot'), 'cli');
	// 0.2.1's pluginPackages resolves either tree; without an environment or an
	// app.asar path the source is genuinely unknown, never guessed as CLI.
	assert.equal(promptTargetOf('pluginPackages'), 'unknown');
	assert.equal(promptTargetOf('pluginPackages', null, 'C:/Program Files/App/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'), 'desktop');
	assert.equal(promptTargetOf('pluginPackages', null, 'C:/Users/me/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh'), 'unknown');
	assert.equal(promptTargetOf(null, null, null), 'unknown');
	assert.equal(promptTargetOf(undefined), 'unknown');
});

test('desktopApp prompts update inside the app and never tell users to npm install -g', () => {
	const stable = buildStablePrompt({
		installSource: 'desktopApp',
		localVersion: '0.2.0-rc.2',
		localChannel: 'stable',
		target: '0.2.1-rc.1'
	});
	// The regression this guards: the desktop runtime lives in app.asar, so an
	// npm-global install would update a different tree and never the app.
	assert.ok(!stable.includes('npm install -g'), 'desktop prompt must not offer an npm-global install');
	assert.match(stable, /桌面应用内/);
	assert.match(stable, /检查更新…/);
	assert.match(stable, /应用菜单/);
	assert.match(stable, /\$DSH_HOME/);
	assert.ok(!/重启 dsh web/.test(stable), 'desktop prompt must not ask to restart dsh web');
	assert.match(stable, /0\.2\.1-rc\.1/);

	// Alpha on desktop: same in-app route, plus the preview warning.
	const alpha = buildAlphaPrompt({
		installSource: 'desktopApp',
		localVersion: '0.2.0-rc.2',
		localChannel: 'stable',
		target: '0.2.1-alpha.1'
	});
	assert.ok(!alpha.includes('npm install -g'), 'desktop alpha prompt must not offer an npm-global install');
	assert.match(alpha, /桌面应用内/);
	assert.match(alpha, /检查更新…/);
	assert.match(alpha, /开发者预览通道/);
	assert.ok(!/重启 dsh web/.test(alpha));

	// Rollback on desktop: no npm-global fallback either.
	const rollback = buildRollbackPrompt({
		installSource: 'desktopApp',
		currentVersion: '0.2.1-alpha.1',
		currentChannel: 'alpha',
		target: '0.2.0-rc.2'
	});
	assert.ok(!rollback.includes('npm install -g'), 'desktop rollback prompt must not offer an npm-global install');
	assert.match(rollback, /桌面应用内/);
	assert.match(rollback, /降级\/回退操作/);

	// installEnvironment is authoritative even when the probe name looks like CLI,
	// and the app.asar path fallback works for a pluginPackages hit.
	const viaEnvironment = buildStablePrompt({
		installSource: 'pluginPackages',
		installEnvironment: 'desktop',
		localVersion: '0.2.0-rc.2',
		localChannel: 'stable',
		target: '0.2.1-rc.1'
	});
	assert.ok(!viaEnvironment.includes('npm install -g'));
	const viaAsarPath = buildStablePrompt({
		installSource: 'pluginPackages',
		installPath: 'C:/Program Files/App/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh',
		localVersion: '0.2.0-rc.2',
		localChannel: 'stable',
		target: '0.2.1-rc.1'
	});
	assert.ok(!viaAsarPath.includes('npm install -g'));
});

test('channelView forwards install facts into the prompts', () => {
	const desktop = channelView({
		channel: 'stable',
		target: '0.2.1-rc.1',
		localVersion: '0.2.0-rc.2',
		localChannel: 'stable',
		installSource: 'desktopApp',
		installEnvironment: 'desktop'
	});
	assert.equal(desktop.decision, 'update');
	assert.ok(!desktop.prompt.includes('npm install -g'), 'the desktop block must render the in-app prompt');
	assert.match(desktop.prompt, /检查更新…/);
	// The alpha→stable line-switch status must not claim an npm overwrite on desktop.
	assert.doesNotMatch(desktop.status, /覆盖安装/);

	const cli = channelView({
		channel: 'stable',
		target: '0.2.1-rc.1',
		localVersion: '0.2.0-rc.2',
		localChannel: 'stable',
		installSource: 'npmRoot',
		installEnvironment: 'cli'
	});
	assert.match(cli.prompt, /npm install -g @deepseek-ai\/dsh@0\.2\.1-rc\.1/);
	assert.match(cli.prompt, /重启 dsh web/);
	assert.match(cli.status, /发现新版本/);
});

test('an unknown install source offers both updaters, each labelled', () => {
	const stable = buildStablePrompt({ localVersion: '0.2.0-rc.2', localChannel: 'stable', target: '0.2.1-rc.1' });
	assert.match(stable, /未能识别 dsh 的安装来源/);
	assert.match(stable, /桌面应用内运行/);
	assert.match(stable, /npm 全局安装/);
	assert.match(stable, /npm install -g @deepseek-ai\/dsh@0\.2\.1-rc\.1/);
	// Both routes are described; neither is presented as the only truth.
	assert.match(stable, /二选一/);

	const alpha = buildAlphaPrompt({ localVersion: '0.2.0-rc.2', localChannel: 'stable', target: '0.2.1-alpha.1' });
	assert.match(alpha, /未能识别 dsh 的安装来源/);
	assert.match(alpha, /npm install -g @deepseek-ai\/dsh@0\.2\.1-alpha\.1/);
	assert.match(alpha, /检查更新…/);

	const rollback = buildRollbackPrompt({ target: '0.2.0-rc.2', currentVersion: '0.2.1-alpha.1', currentChannel: 'alpha' });
	assert.match(rollback, /未能识别 dsh 的安装来源/);
	assert.match(rollback, /npm install -g @deepseek-ai\/dsh@0\.2\.0-rc\.2/);

	// An explicit CLI environment still wins over an unknown source: the prompt
	// must not hedge when the Host actually knows the install tree.
	const cli = buildStablePrompt({ installEnvironment: 'cli', localVersion: '0.2.0-rc.2', localChannel: 'stable', target: '0.2.1-rc.1' });
	assert.ok(!/未能识别 dsh 的安装来源/.test(cli));
	assert.match(cli, /官方安装命令/);
});

test('probe: the 0.2.1 pluginPackages hit wins and classifies the desktop tree', async () => {
	const debug = [];
	const found = await findDshRoot({
		get: (key) => key === 'pluginPackages'
			? { packageOf: () => ({ dir: 'C:/Program Files/App/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh', version: '0.2.1-rc.1' }) }
			: undefined
	}, debug);
	assert.equal(found.source, 'pluginPackages');
	assert.equal(found.environment, 'desktop');
	assert.ok(found.root.endsWith(path.sep), 'the install root keeps the trailing separator convention');
	assert.deepEqual(debug, [], 'a successful probe must not add diagnostics');
});

test('probe: installEnvironmentOf separates desktop resources from npm-global trees', () => {
	// The desktop app keeps its runtime below process.resourcesPath (inside
	// app.asar when packaged); an npm-global tree does not.
	assert.equal(installEnvironmentOf('C:/Program Files/App/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'), 'desktop');
	assert.equal(installEnvironmentOf('C:/Users/me/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh'), 'cli');
});

test('manifest declares the DSH engines range and ships the monochrome icon', () => {
	const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
	// The official compatibility gate reads engines.dsh when present; the typert
	// peer stays for package managers and the real dependency.
	assert.equal(pkg.version, '1.4.1');
	assert.equal(pkg.engines && pkg.engines.dsh, '>=0.2.0-rc.1 <0.3.0-0');
	assert.ok(pkg.peerDependencies && pkg.peerDependencies['@deepseek-ai/dsh-typert-protocol']);
	assert.equal(pkg.icon, './icon.svg');
	assert.ok(Array.isArray(pkg.files) && pkg.files.includes('icon.svg'), 'icon.svg must ship in the package');
	const svg = readFileSync(path.join(here, '..', 'icon.svg'), 'utf8');
	assert.match(svg, /viewBox="0 0 16 16"/);
	assert.match(svg, /fill="none"/);
	assert.match(svg, /stroke="currentColor"/);
	assert.match(svg, /stroke-width="1\.5"/);
	assert.ok(Buffer.byteLength(svg) < 256 * 1024, 'icon must stay below the manifest limit');
});
