import { db } from './db.js'

interface GuildRankingRow {
  id: number
  name: string
  server_name: string | null
  region: string
  faction: string | null
  ce_achieved_at: number | null
  total_ms: number
  first_pull_ms: number | null
  last_pull_ms: number | null
  report_count: number
}

// Sum (last_pull - first_pull) over reports for each guild.
// For CE guilds, only count reports whose first_pull is <= ce_achieved_at.
// Span: from first recorded report to CE timestamp (or to last report if no CE yet).
function loadRankings(): GuildRankingRow[] {
  return db.prepare(`
    SELECT
      g.id,
      g.name,
      g.server_name,
      g.region,
      g.faction,
      g.ce_achieved_at,
      COALESCE(SUM(
        CASE
          WHEN r.first_pull IS NULL OR r.last_pull IS NULL THEN 0
          WHEN g.ce_achieved_at IS NOT NULL AND r.first_pull > g.ce_achieved_at THEN 0
          ELSE r.last_pull - r.first_pull
        END
      ), 0) AS total_ms,
      MIN(r.first_pull) AS first_pull_ms,
      MAX(CASE
        WHEN g.ce_achieved_at IS NOT NULL AND r.first_pull > g.ce_achieved_at THEN NULL
        ELSE r.last_pull
      END) AS last_pull_ms,
      COUNT(CASE
        WHEN g.ce_achieved_at IS NOT NULL AND r.first_pull > g.ce_achieved_at THEN NULL
        ELSE r.code
      END) AS report_count
    FROM guilds g
    LEFT JOIN reports r ON r.guild_id = g.id
    GROUP BY g.id
    HAVING total_ms > 0
  `).all() as GuildRankingRow[]
}

interface RankedGuild extends GuildRankingRow {
  hours_per_week: number
  total_hours: number
  weeks: number
}

function rank(rows: GuildRankingRow[]): RankedGuild[] {
  const ranked: RankedGuild[] = rows.map(r => {
    const total_hours = r.total_ms / 3_600_000
    // Span: first_pull to ce_achieved_at (CE guilds) or last_pull (progressing)
    const spanEnd = r.ce_achieved_at !== null ? r.ce_achieved_at : r.last_pull_ms ?? 0
    const spanStart = r.first_pull_ms ?? spanEnd
    const weeks = Math.max((spanEnd - spanStart) / (7 * 24 * 3_600_000), 1 / 7) // min 1 day
    return {
      ...r,
      total_hours,
      weeks,
      hours_per_week: total_hours / weeks,
    }
  })
  return ranked.sort((a, b) => b.hours_per_week - a.hours_per_week)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function fmtHours(h: number): string {
  return h.toFixed(1)
}

function fmtDate(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toISOString().slice(0, 10)
}

export function renderRankingsPage(): string {
  const rows = rank(loadRankings())
  const totalGuilds = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
  const ceGuilds = (db
    .prepare('SELECT COUNT(*) as c FROM guilds WHERE ce_achieved_at IS NOT NULL')
    .get() as { c: number }).c

  const tbody = rows
    .map(
      (r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.server_name ?? '')} <span class="muted">${escapeHtml(r.region)}</span></td>
      <td class="num">${fmtHours(r.hours_per_week)}</td>
      <td class="num">${fmtHours(r.total_hours)}</td>
      <td class="num">${r.weeks.toFixed(1)}</td>
      <td>${r.ce_achieved_at !== null ? fmtDate(r.ce_achieved_at) : '<span class="progress">in progress</span>'}</td>
      <td class="num">${r.report_count}</td>
    </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Guild Rankings — Hours Per Week Before CE</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #222; }
    h1 { margin-bottom: 0.25rem; }
    .sub { color: #666; margin-bottom: 1.5rem; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { padding: 6px 10px; border-bottom: 1px solid #eee; text-align: left; }
    th { background: #f5f5f5; position: sticky; top: 0; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #999; font-size: 12px; }
    .progress { color: #b7791f; font-style: italic; }
    .empty { padding: 2rem; text-align: center; color: #999; }
  </style>
</head>
<body>
  <h1>Guild Rankings</h1>
  <div class="sub">
    Hours raided per week before Cutting Edge across Voidspire, Dreamrift, and March on Quel'danas.
    ${totalGuilds} guilds tracked · ${ceGuilds} with CE.
  </div>
  ${
    rows.length === 0
      ? '<div class="empty">No data yet. Run <code>npm run sync</code>.</div>'
      : `<table>
    <thead>
      <tr>
        <th>#</th>
        <th>Guild</th>
        <th>Server</th>
        <th class="num">Hours/week</th>
        <th class="num">Total hours</th>
        <th class="num">Weeks</th>
        <th>CE</th>
        <th class="num">Reports</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>`
  }
</body>
</html>`
}
