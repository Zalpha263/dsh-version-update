// dsh-version-update — Host half (persistent).
//
// Registers the "versionUpdate" Remote service consumed by the settings-page
// Client half. Read-only by design: the official desktop updater owns updates,
// so this plugin never builds an update command and never touches the install.
//
// Methods:
//   info()             local version / channel / install path / install
//                      environment / Node / npm / platform / $DSH_HOME + probe
//                      diagnostics (facts live in lib/probe.js)
//   changelog(refresh, lang)  parsed official release notes (fetch + cache lives
//                      in lib/changelog.js) plus the channel summary and where
//                      the running version sits in the timeline
//   range(from,to,lang) everything published in (from, to], grouped by category
//   search(query,channel,kind,lang)  full-text search, grouped by version
//
// IMPORTANT: the Gateway derives parameter wires from the method SOURCE
// (parameter names must be simple identifiers), and the Client contribution
// matches them positionally. Keep the parameter names here and in
// lib/client.js CONTRIBUTION in sync.

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readLocalInfo } from './probe.js'
import {
  loadChangelog,
  localStanding,
  channelSummary,
  rangeAggregate,
  searchReleases,
  channelOf
} from './changelog.js'

class VersionUpdateService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'versionUpdate')
    this.ctx = ctx
  }

  /** One settings-page load: all local version/environment facts. */
  async info() {
    const facts = await readLocalInfo(this.ctx)
    return {
      ...facts,
      localChannel: channelOf(facts.localVersion)
    }
  }

  /**
   * Official release notes + channel summary + local standing.
   *
   * refresh=true forces a network check (the "刷新数据" button); a failed
   * refresh degrades to the cache and reports stale + an error code, so the
   * panel keeps rendering offline. The client's language is passed through so
   * the per-category counts match the version it renders.
   */
  async changelog(refresh, lang) {
    const [data, facts] = await Promise.all([
      loadChangelog({ refresh: refresh === true }),
      readLocalInfo(this.ctx)
    ])
    return {
      releases: data.releases,
      fetchedAt: data.fetchedAt,
      checkedAt: data.checkedAt,
      stale: data.stale,
      error: data.error,
      channels: channelSummary(data.releases),
      local: localStanding(data.releases, facts.localVersion, lang),
      localVersion: facts.localVersion,
      installEnvironment: facts.installEnvironment
    }
  }

  /** Aggregate every change between two versions (inclusive of the target). */
  async range(from, to, lang) {
    const data = await loadChangelog({})
    return rangeAggregate(data.releases, from, to, lang)
  }

  /** Full-text search over the parsed changelog. */
  async search(query, channel, kind, lang) {
    const data = await loadChangelog({})
    return searchReleases(data.releases, query, channel, kind, lang)
  }
}

// --- Manual Remote markers (decorator-syntax-free) ---------------------------
const proto = VersionUpdateService.prototype
function markRemote(method) {
  const context = {
    private: false,
    static: false,
    name: method,
    addInitializer(cb) { this.cb = cb }
  }
  // Equivalent to "@Remote(method)" on the class method.
  // NOTE: this manual decorator-context trick is coupled to the
  // typert-protocol internals; keep in sync when upgrading that package.
  Remote(method)(undefined, context)
  context.cb.call(Object.create(proto))
}
markRemote('info')
markRemote('changelog')
markRemote('range')
markRemote('search')

export function apply(ctx) {
  // TypertRemoteService registers "versionUpdate" in ctx.reflect.props and sets
  // service.typertRemote; the Gateway's source-mode discovery consumes both.
  new VersionUpdateService(ctx)
}
