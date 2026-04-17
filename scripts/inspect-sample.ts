import { db } from '../src/db.js'

const guilds = db
  .prepare(`
    SELECT g.id, g.name, g.server_name, g.region,
      COUNT(r.code) AS reports,
      COUNT(CASE WHEN r.first_pull IS NOT NULL THEN 1 END) AS reports_with_pulls,
      MIN(r.first_pull) AS first, MAX(r.last_pull) AS last
    FROM guilds g
    LEFT JOIN reports r ON r.guild_id = g.id
    WHERE g.reports_synced_at IS NOT NULL
    GROUP BY g.id
    ORDER BY reports DESC
  `)
  .all() as Array<{
    id: number
    name: string
    server_name: string
    region: string
    reports: number
    reports_with_pulls: number
    first: number | null
    last: number | null
  }>

for (const g of guilds) {
  const hours =
    g.first && g.last
      ? ((db
          .prepare(
            'SELECT SUM(last_pull - first_pull) AS ms FROM reports WHERE guild_id = ? AND first_pull IS NOT NULL',
          )
          .get(g.id) as { ms: number }).ms /
          3_600_000).toFixed(1)
      : '—'
  const span =
    g.first && g.last ? ((g.last - g.first) / (7 * 24 * 3_600_000)).toFixed(1) + 'w' : '—'
  console.log(
    `${g.name.padEnd(24)} ${g.region}-${g.server_name?.padEnd(14) ?? ''} reports=${g.reports} w/pulls=${g.reports_with_pulls} total=${hours}h span=${span}`,
  )
}
