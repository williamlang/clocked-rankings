import { db } from '../src/db.js'

const reports = db
  .prepare(`
    SELECT r.guild_id, g.name, g.server_name, g.region, r.code, r.first_pull, r.last_pull
    FROM reports r JOIN guilds g ON g.id = r.guild_id
    WHERE r.first_pull IS NOT NULL AND r.last_pull IS NOT NULL
      AND g.reports_synced_at IS NOT NULL
    ORDER BY r.guild_id, r.first_pull
  `)
  .all() as Array<{
    guild_id: number
    name: string
    server_name: string
    region: string
    code: string
    first_pull: number
    last_pull: number
  }>

// Merge per guild and find those with any session > 12h
const byGuild = new Map<number, typeof reports>()
for (const r of reports) {
  if (!byGuild.has(r.guild_id)) byGuild.set(r.guild_id, [])
  byGuild.get(r.guild_id)!.push(r)
}

for (const [gid, rs] of byGuild) {
  const sorted = [...rs].sort((a, b) => a.first_pull - b.first_pull)
  type Merged = { first: number; last: number; codes: string[] }
  const merged: Merged[] = []
  for (const r of sorted) {
    const prev = merged[merged.length - 1]
    if (prev && r.first_pull <= prev.last) {
      prev.last = Math.max(prev.last, r.last_pull)
      prev.codes.push(r.code)
    } else {
      merged.push({ first: r.first_pull, last: r.last_pull, codes: [r.code] })
    }
  }
  for (const m of merged) {
    const hrs = (m.last - m.first) / 3_600_000
    if (hrs > 12) {
      console.log(
        `${rs[0].name} (${rs[0].region}-${rs[0].server_name}) guild=${gid}  ${hrs.toFixed(1)}h merged from ${m.codes.length} reports:`,
      )
      for (const c of m.codes) {
        const rep = rs.find(x => x.code === c)!
        console.log(
          `  ${c}  ${new Date(rep.first_pull).toISOString()} → ${new Date(rep.last_pull).toISOString()}  (${((rep.last_pull - rep.first_pull) / 3_600_000).toFixed(1)}h)`,
        )
      }
    }
  }
}
