import { db, getState, setState, clearState } from '../db.js'
import { fetchGuildReports, fetchReportFights } from '../wcl/client.js'
import { getCEGateEncounterIDs, loadZone } from './zones.js'

const MYTHIC_DIFFICULTY = 5
const STATE_KEY = 'report_sync_cursor'

interface ReportSyncCursor {
  guildID: number
  page: number
}

function loadCursor(): ReportSyncCursor | null {
  const raw = getState(STATE_KEY)
  return raw ? (JSON.parse(raw) as ReportSyncCursor) : null
}

function saveCursor(c: ReportSyncCursor): void {
  setState(STATE_KEY, JSON.stringify(c))
}

interface PendingGuild {
  id: number
  name: string
}

function pendingGuilds(): PendingGuild[] {
  // Unsynced first, then stalest-synced next — after backfill, this rotates fairly.
  return db
    .prepare(`
      SELECT id, name FROM guilds
      WHERE ce_achieved_at IS NULL
      ORDER BY reports_synced_at IS NOT NULL, reports_synced_at, id
    `)
    .all() as PendingGuild[]
}

const upsertReport = db.prepare(`
  INSERT INTO reports (code, guild_id, zone_id, start_time, end_time, first_pull, last_pull)
  VALUES (@code, @guild_id, @zone_id, @start_time, @end_time, @first_pull, @last_pull)
  ON CONFLICT(code) DO UPDATE SET
    zone_id = excluded.zone_id,
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

const markSynced = db.prepare('UPDATE guilds SET reports_synced_at = unixepoch() WHERE id = ?')
const markCE = db.prepare('UPDATE guilds SET ce_achieved_at = ? WHERE id = ?')

const reportAlreadyFetched = db.prepare('SELECT 1 FROM reports WHERE code = ?')

function checkCE(guildID: number): number | null {
  const gateIDs = getCEGateEncounterIDs()
  if (gateIDs.length === 0) return null
  const placeholders = gateIDs.map(() => '?').join(',')
  const kills = db
    .prepare(
      `SELECT encounter_id, killed_at FROM mythic_kills
       WHERE guild_id = ? AND encounter_id IN (${placeholders})`,
    )
    .all(guildID, ...gateIDs) as { encounter_id: number; killed_at: number }[]
  if (kills.length !== gateIDs.length) return null
  return Math.max(...kills.map(k => k.killed_at))
}

async function syncGuildReports(
  guild: PendingGuild,
  startPage: number,
  zoneID: number | null,
): Promise<void> {
  let page = startPage
  while (true) {
    saveCursor({ guildID: guild.id, page })
    const reports = await fetchGuildReports(guild.id, page, zoneID)

    for (const report of reports.data) {
      // Skip if we've already processed this report
      if (reportAlreadyFetched.get(report.code)) continue

      // Fetch fights to compute pull window + kill detection
      const full = await fetchReportFights(report.code)

      // Pull window: first fight start to last fight end (in absolute ms)
      let firstPull: number | null = null
      let lastPull: number | null = null
      if (full.fights.length > 0) {
        const fightStarts = full.fights.map(f => f.startTime)
        const fightEnds = full.fights.map(f => f.endTime)
        firstPull = full.startTime + Math.min(...fightStarts)
        lastPull = full.startTime + Math.max(...fightEnds)
      }

      upsertReport.run({
        code: report.code,
        guild_id: guild.id,
        zone_id: full.zone?.id ?? report.zone?.id ?? null,
        start_time: full.startTime,
        end_time: full.endTime,
        first_pull: firstPull,
        last_pull: lastPull,
      })

      const insertFights = db.transaction(() => {
        for (const f of full.fights) {
          insertFight.run({
            report_code: report.code,
            fight_id: f.id,
            guild_id: guild.id,
            start_time: full.startTime + f.startTime,
            end_time: full.startTime + f.endTime,
            encounter_id: f.encounterID,
            difficulty: f.difficulty,
          })
          if (f.kill && f.difficulty === MYTHIC_DIFFICULTY) {
            upsertKill.run(guild.id, f.encounterID, report.code, full.startTime + f.startTime)
          }
        }
      })
      insertFights()
    }

    if (!reports.has_more_pages) break
    page += 1
  }

  markSynced.run(guild.id)
  const ceAt = checkCE(guild.id)
  if (ceAt !== null) markCE.run(ceAt, guild.id)
}

export async function syncReports(limit?: number): Promise<void> {
  const cursor = loadCursor()
  const allGuilds = pendingGuilds()
  const guilds = limit !== undefined ? allGuilds.slice(0, limit) : allGuilds
  const zoneID = loadZone()?.id ?? null

  let startIdx = 0
  let startPage = 1
  if (cursor) {
    const idx = guilds.findIndex(g => g.id === cursor.guildID)
    if (idx >= 0) {
      startIdx = idx
      startPage = cursor.page
    }
  }

  for (let i = startIdx; i < guilds.length; i++) {
    await syncGuildReports(guilds[i], i === startIdx ? startPage : 1, zoneID)
  }

  clearState(STATE_KEY)
}
