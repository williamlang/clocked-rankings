import { db, getState, setState, clearState } from '../db.js'
import { fetchRaidPulls, fetchRaidRankings } from '../rio/client.js'
import type { RioDifficulty, RioGuildSummary, RioPullEntry, RioRegion } from '../rio/types.js'
import { getCEGateEncounterIDs } from './zones.js'

const REGIONS: RioRegion[] = ['us', 'eu', 'kr', 'tw']
const DIFFICULTIES: { name: RioDifficulty; wcl: number }[] = [
  { name: 'mythic', wcl: 5 },
  { name: 'heroic', wcl: 4 },
  { name: 'normal', wcl: 3 },
]
const RANKINGS_PAGE_SIZE = 200
// RIO IDs are stored as negative `guilds.id` values to keep them disjoint from
// WCL IDs (which are positive). When the same guild later turns up in WCL we
// just set wcl_id on the existing row — id stays negative.
const RIO_ID_SIGN = -1

const PULL_STATE_KEY = 'rio_pull_cursor'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const findGuildByRioId = db.prepare<[number]>('SELECT id, wcl_id FROM guilds WHERE rio_id = ?')
const findGuildByMatch = db.prepare<[string, string, string]>(
  'SELECT id, wcl_id, rio_id FROM guilds WHERE upper(region) = upper(?) AND server_slug = ? AND lower(name) = lower(?) LIMIT 1',
)
const wclHasReports = db.prepare<[number]>(
  "SELECT 1 FROM reports WHERE guild_id = ? AND code NOT LIKE 'rio:%' LIMIT 1",
)

const insertRioGuild = db.prepare(`
  INSERT INTO guilds (id, rio_id, name, server_slug, server_name, region, faction)
  VALUES (@id, @rio_id, @name, @server_slug, @server_name, @region, @faction)
  ON CONFLICT(id) DO NOTHING
`)

const linkRioToExisting = db.prepare(
  'UPDATE guilds SET rio_id = ? WHERE id = ? AND rio_id IS NULL',
)

const upsertReport = db.prepare(`
  INSERT INTO reports (code, guild_id, zone_id, start_time, end_time, first_pull, last_pull)
  VALUES (@code, @guild_id, @zone_id, @start_time, @end_time, @first_pull, @last_pull)
  ON CONFLICT(code) DO UPDATE SET
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    first_pull = excluded.first_pull,
    last_pull = excluded.last_pull,
    fetched_at = unixepoch()
`)

const insertFight = db.prepare(`
  INSERT INTO fights (report_code, fight_id, guild_id, start_time, end_time, encounter_id, difficulty)
  VALUES (@report_code, @fight_id, @guild_id, @start_time, @end_time, @encounter_id, @difficulty)
  ON CONFLICT(report_code, fight_id) DO UPDATE SET
    start_time = excluded.start_time,
    end_time = excluded.end_time
`)

const upsertKill = db.prepare(`
  INSERT INTO mythic_kills (guild_id, encounter_id, report_code, killed_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, encounter_id) DO UPDATE SET
    killed_at = CASE WHEN excluded.killed_at < killed_at THEN excluded.killed_at ELSE killed_at END,
    report_code = CASE WHEN excluded.killed_at < killed_at THEN excluded.report_code ELSE report_code END
`)

const markRioSynced = db.prepare(
  'UPDATE guilds SET rio_updated_at = unixepoch(), rio_no_data_at = NULL WHERE id = ?',
)
const markRioEmpty = db.prepare('UPDATE guilds SET rio_no_data_at = unixepoch() WHERE id = ?')
const setCE = db.prepare(
  'UPDATE guilds SET ce_achieved_at = ? WHERE id = ? AND (ce_achieved_at IS NULL OR ce_achieved_at > ?)',
)

// Skip a guild's API check if we already determined it has no Desktop App
// data within this TTL. Refreshed when the cache entry expires.
const NO_DATA_TTL_SECS = 24 * 3600
const isRecentlyEmpty = db.prepare<[number, number]>(
  'SELECT 1 FROM guilds WHERE id = ? AND rio_no_data_at IS NOT NULL AND rio_no_data_at > ?',
)

interface ResolvedGuild {
  id: number
  isWclCovered: boolean
}

/**
 * Map a RIO-discovered guild to a local guilds.id, creating a row if needed.
 * `isWclCovered` is true only when WCL has actually returned reports for this
 * guild — guilds discovered via WCL but with private logs (no reports rows)
 * are NOT covered, so RIO can fill in.
 */
function resolveGuild(g: RioGuildSummary): ResolvedGuild {
  const region = g.region.slug
  const server_slug = g.realm.slug

  const byRioId = findGuildByRioId.get(g.id) as { id: number; wcl_id: number | null } | undefined
  if (byRioId) return { id: byRioId.id, isWclCovered: !!wclHasReports.get(byRioId.id) }

  const match = findGuildByMatch.get(region, server_slug, g.name) as
    | { id: number; wcl_id: number | null; rio_id: number | null }
    | undefined
  if (match) {
    if (match.rio_id === null) linkRioToExisting.run(g.id, match.id)
    return { id: match.id, isWclCovered: !!wclHasReports.get(match.id) }
  }

  const id = RIO_ID_SIGN * g.id
  insertRioGuild.run({
    id,
    rio_id: g.id,
    name: g.name,
    server_slug,
    server_name: g.realm.name,
    region: region.toUpperCase(),
    faction: g.faction === 'horde' ? 'Horde' : g.faction === 'alliance' ? 'Alliance' : null,
  })
  return { id, isWclCovered: false }
}

function ingestPulls(
  guildId: number,
  difficulty: { name: RioDifficulty; wcl: number },
  pulls: RioPullEntry[],
): number {
  let fightCount = 0
  let firstPull = Number.POSITIVE_INFINITY
  let lastPull = 0
  const reportCode = `rio:${guildId}:${difficulty.name}`

  const tx = db.transaction(() => {
    for (const entry of pulls) {
      const wclEncounterId = entry.encounter.wowEncounterId
      if (!wclEncounterId) continue
      for (const detail of entry.details) {
        const startMs = Date.parse(detail.pull_started_at)
        const endMs = Date.parse(detail.pull_ended_at)
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
        if (startMs < firstPull) firstPull = startMs
        if (endMs > lastPull) lastPull = endMs

        insertFight.run({
          report_code: reportCode,
          fight_id: detail.id,
          guild_id: guildId,
          start_time: startMs,
          end_time: endMs,
          encounter_id: wclEncounterId,
          difficulty: difficulty.wcl,
        })
        fightCount += 1

        if (detail.is_success && difficulty.name === 'mythic') {
          upsertKill.run(guildId, wclEncounterId, reportCode, startMs)
        }
      }
    }

    if (fightCount > 0) {
      upsertReport.run({
        code: reportCode,
        guild_id: guildId,
        zone_id: null,
        start_time: firstPull,
        end_time: lastPull,
        first_pull: firstPull,
        last_pull: lastPull,
      })
    }
  })
  tx()

  return fightCount
}

function checkAndSetCE(guildId: number, ceGateIDs: number[]): void {
  if (ceGateIDs.length === 0) return
  const placeholders = ceGateIDs.map(() => '?').join(',')
  const kills = db
    .prepare(
      `SELECT encounter_id, killed_at FROM mythic_kills
       WHERE guild_id = ? AND encounter_id IN (${placeholders})`,
    )
    .all(guildId, ...ceGateIDs) as { encounter_id: number; killed_at: number }[]
  if (kills.length !== ceGateIDs.length) return
  const ceAt = Math.max(...kills.map(k => k.killed_at))
  setCE.run(ceAt, guildId, ceAt)
}

interface QueuedGuild {
  guildId: number
  rio: RioGuildSummary
}

async function discoverCandidates(verbose: boolean): Promise<QueuedGuild[]> {
  // Discovery is idempotent and lightweight enough that we re-run it from
  // scratch on every sync. The pull-ingest step is what we checkpoint.
  const queued: QueuedGuild[] = []
  const seen = new Set<number>()
  const ttlCutoff = Math.floor(Date.now() / 1000) - NO_DATA_TTL_SECS

  for (const region of REGIONS) {
    let page = 0
    let regionTotal = 0
    let regionWcl = 0
    let regionEmptyCache = 0
    while (true) {
      const data = await fetchRaidRankings(region, page, RANKINGS_PAGE_SIZE)
      const rankings = data?.raidRankings ?? []
      if (rankings.length === 0) break

      for (const r of rankings) {
        if (!r.guild?.id || !r.guild.realm?.slug) continue
        if (seen.has(r.guild.id)) continue
        seen.add(r.guild.id)
        regionTotal += 1
        const summary: RioGuildSummary = {
          ...r.guild,
          realm: { ...r.guild.realm, slug: slugify(r.guild.realm.slug) },
        }
        const resolved = resolveGuild(summary)
        if (resolved.isWclCovered) {
          regionWcl += 1
          continue
        }
        if (isRecentlyEmpty.get(resolved.id, ttlCutoff)) {
          regionEmptyCache += 1
          continue
        }
        queued.push({ guildId: resolved.id, rio: summary })
      }

      if (rankings.length < RANKINGS_PAGE_SIZE) break
      page += 1
    }
    if (verbose) {
      const candidates = regionTotal - regionWcl - regionEmptyCache
      console.log(`    ${region}: ${regionTotal} ranked (${regionWcl} on WCL, ${regionEmptyCache} no-data cached, ${candidates} candidates)`)
    }
  }
  return queued
}

export async function syncRio(opts: { verbose?: boolean } = {}): Promise<void> {
  const verbose = opts.verbose ?? false
  const ceGateIDs = getCEGateEncounterIDs()

  if (verbose) console.log('  Discovering Mythic-ranked guilds across regions...')
  const queued = await discoverCandidates(verbose)
  console.log(`  ${queued.length} RIO-only candidate guilds discovered`)

  const pullCursor = getState(PULL_STATE_KEY)
  let startIdx = 0
  if (pullCursor) {
    const cursorId = parseInt(pullCursor, 10)
    const idx = queued.findIndex(q => q.guildId === cursorId)
    if (idx >= 0) startIdx = idx
    if (verbose && startIdx > 0) console.log(`  Resuming from cursor at index ${startIdx}`)
  }

  let ingested = 0
  let emptyCount = 0
  for (let i = startIdx; i < queued.length; i++) {
    const { guildId, rio } = queued[i]
    setState(PULL_STATE_KEY, String(guildId))

    let nonEmpty = false
    const diffCounts: Record<string, number> = { mythic: 0, heroic: 0, normal: 0 }
    for (const diff of DIFFICULTIES) {
      // Short-circuit: if Mythic (the first difficulty) returned no pulls,
      // this guild isn't in the Desktop App pool. Skip Heroic/Normal — they'd
      // be empty too, and we'd rather save the API budget for real ingest.
      // Candidates here all have at least one Mythic kill (raid-rankings
      // filters to Mythic), so an absent Mythic pool means absent overall.
      if (diff.name !== 'mythic' && !nonEmpty) break
      const data = await fetchRaidPulls({
        region: rio.region.slug,
        realm: rio.realm.slug,
        guild: rio.name,
        difficulty: diff.name,
      })
      const pulls = data?.pulls ?? []
      diffCounts[diff.name] = pulls.reduce((s, p) => s + p.details.length, 0)
      if (pulls.length === 0) continue
      nonEmpty = true
      ingestPulls(guildId, diff, pulls)
    }

    if (nonEmpty) {
      markRioSynced.run(guildId)
      checkAndSetCE(guildId, ceGateIDs)
      ingested += 1
      if (verbose) {
        console.log(`    [${i + 1}/${queued.length}] ${rio.name} (${rio.region.slug}-${rio.realm.slug}) — m=${diffCounts.mythic} h=${diffCounts.heroic} n=${diffCounts.normal}`)
      }
    } else {
      markRioEmpty.run(guildId)
      emptyCount += 1
      if (verbose && emptyCount <= 5) {
        console.log(`    [${i + 1}/${queued.length}] ${rio.name} (${rio.region.slug}-${rio.realm.slug}) — no Desktop App data (cached for ${NO_DATA_TTL_SECS / 3600}h)`)
      } else if (verbose && emptyCount === 6) {
        console.log(`    ... (further empty results suppressed)`)
      }
    }
  }
  console.log(`  ${ingested} RIO guilds ingested with Desktop App pull data (${emptyCount} had no data)`)
  clearState(PULL_STATE_KEY)
}
