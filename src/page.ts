import { db, getState } from './db.js'

interface Interval {
  first: number
  last: number
}

const REGION_OFFSET: Record<string, number> = {
  US: -5,
  EU: 1,
  CN: 8,
  KR: 9,
  TW: 8,
}

function localHour(ms: number, region: string): number {
  const offset = REGION_OFFSET[region] ?? 0
  const shifted = new Date(ms + offset * 3_600_000)
  return shifted.getUTCHours() + shifted.getUTCMinutes() / 60
}

function localDay(ms: number, region: string): number {
  const offset = REGION_OFFSET[region] ?? 0
  return new Date(ms + offset * 3_600_000).getUTCDay()
}

function circularMeanHour(hours: number[]): number {
  if (hours.length === 0) return 0
  const angles = hours.map(h => (h / 24) * 2 * Math.PI)
  const s = angles.reduce((a, x) => a + Math.sin(x), 0) / angles.length
  const c = angles.reduce((a, x) => a + Math.cos(x), 0) / angles.length
  const mean = (Math.atan2(s, c) / (2 * Math.PI)) * 24
  return mean < 0 ? mean + 24 : mean
}

// Reports longer than this are treated as multi-day and split via fights.
const MAX_SINGLE_DAY_MS = 14 * 3_600_000
// Gap threshold for splitting fights within a multi-day report.
const MULTI_DAY_GAP_MS = 4 * 3_600_000

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.first - b.first)
  const out: Interval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1]
    const iv = sorted[i]
    if (iv.first <= prev.last) prev.last = Math.max(prev.last, iv.last)
    else out.push({ ...iv })
  }
  return out
}

const WEEK_MS = 7 * 24 * 3_600_000
function bucketKey(ms: number): number {
  return Math.floor(ms / WEEK_MS)
}

const CATEGORIES = ['Weekend Warrior', 'Late Night', 'Evening', 'Afternoon', 'Morning'] as const
type Category = (typeof CATEGORIES)[number]

function categoryOf(avgHour: number, weekendOnly: boolean): Category {
  if (weekendOnly) return 'Weekend Warrior'
  const h = avgHour < 4 ? avgHour + 24 : avgHour
  if (h >= 22) return 'Late Night'
  if (h >= 17) return 'Evening'
  if (h >= 12) return 'Afternoon'
  return 'Morning'
}

const TZ_KEYS = ['own', 'US', 'EU', 'CN', 'KR', 'TW'] as const
type TZKey = (typeof TZ_KEYS)[number]

interface GuildData {
  id: number
  name: string
  server_name: string | null
  region: string
  ce_achieved_at: number | null
  total_hours: number
  hours_per_week: number
  raid_nights: number
  raid_weeks: number
  longest_night_hours: number
  bosses: number
  // Category pre-computed for each TZ viewpoint. 'own' = the guild's own region.
  categories: Record<TZKey, Category>
}

function loadRanked(): GuildData[] {
  // Grab mythic-team reports: those containing ≥1 tier-Mythic fight.
  const reports = db
    .prepare(`
      WITH mythic_reports AS (
        SELECT DISTINCT report_code FROM fights
        WHERE difficulty = 5 AND encounter_id IN (SELECT id FROM encounters)
      )
      SELECT r.guild_id, r.code, r.first_pull, r.last_pull
      FROM reports r
      JOIN guilds g ON g.id = r.guild_id
      WHERE r.first_pull IS NOT NULL AND r.last_pull IS NOT NULL
        AND g.reports_synced_at IS NOT NULL
        AND r.code IN (SELECT report_code FROM mythic_reports)
        AND (g.ce_achieved_at IS NULL OR r.first_pull <= g.ce_achieved_at)
    `)
    .all() as { guild_id: number; code: string; first_pull: number; last_pull: number }[]

  // For multi-day reports, grab their fights so we can split per raid night.
  const multiDayCodes = reports.filter(r => r.last_pull - r.first_pull > MAX_SINGLE_DAY_MS).map(r => r.code)
  const fightsPerReport = new Map<string, { start: number; end: number }[]>()
  if (multiDayCodes.length > 0) {
    const placeholders = multiDayCodes.map(() => '?').join(',')
    const fightRows = db
      .prepare(
        `SELECT report_code, start_time, end_time FROM fights
         WHERE report_code IN (${placeholders}) ORDER BY report_code, start_time`,
      )
      .all(...multiDayCodes) as { report_code: string; start_time: number; end_time: number }[]
    for (const f of fightRows) {
      const arr = fightsPerReport.get(f.report_code) ?? []
      arr.push({ start: f.start_time, end: f.end_time })
      fightsPerReport.set(f.report_code, arr)
    }
  }

  const byGuild = new Map<number, Interval[]>()
  for (const r of reports) {
    const arr = byGuild.get(r.guild_id) ?? []
    if (r.last_pull - r.first_pull <= MAX_SINGLE_DAY_MS) {
      arr.push({ first: r.first_pull, last: r.last_pull })
    } else {
      // Multi-day report — split into per-night intervals via fight gaps.
      const fights = fightsPerReport.get(r.code) ?? []
      let cur: Interval | null = null
      for (const f of fights) {
        if (cur && f.start - cur.last <= MULTI_DAY_GAP_MS) {
          cur.last = Math.max(cur.last, f.end)
        } else {
          if (cur) arr.push(cur)
          cur = { first: f.start, last: f.end }
        }
      }
      if (cur) arr.push(cur)
    }
    byGuild.set(r.guild_id, arr)
  }

  const guilds = db
    .prepare(
      'SELECT id, name, server_name, region, ce_achieved_at FROM guilds WHERE reports_synced_at IS NOT NULL',
    )
    .all() as Pick<GuildData, 'id' | 'name' | 'server_name' | 'region' | 'ce_achieved_at'>[]

  const bossRows = db
    .prepare(`
      SELECT guild_id, COUNT(DISTINCT encounter_id) AS n
      FROM mythic_kills
      WHERE encounter_id IN (SELECT id FROM encounters)
      GROUP BY guild_id
    `)
    .all() as { guild_id: number; n: number }[]
  const bossByGuild = new Map(bossRows.map(r => [r.guild_id, r.n]))

  const out: GuildData[] = []
  for (const g of guilds) {
    const sessions = mergeIntervals(byGuild.get(g.id) ?? [])
    const total_ms = sessions.reduce((s, iv) => s + (iv.last - iv.first), 0)
    if (total_ms === 0) continue
    const raid_weeks = Math.max(new Set(sessions.map(iv => bucketKey(iv.first))).size, 1)

    const catFor = (region: string): Category => {
      const hrs = sessions.map(iv => localHour(iv.first, region))
      const avg = circularMeanHour(hrs)
      const weekendOnly = sessions.every(iv => {
        const d = localDay(iv.first, region)
        return d === 0 || d === 5 || d === 6
      })
      return categoryOf(avg, weekendOnly)
    }

    const total_hours = total_ms / 3_600_000
    out.push({
      ...g,
      total_hours,
      hours_per_week: total_hours / raid_weeks,
      raid_nights: sessions.length,
      raid_weeks,
      longest_night_hours: sessions.reduce((m, iv) => Math.max(m, iv.last - iv.first), 0) / 3_600_000,
      bosses: bossByGuild.get(g.id) ?? 0,
      categories: {
        own: catFor(g.region),
        US: catFor('US'),
        EU: catFor('EU'),
        CN: catFor('CN'),
        KR: catFor('KR'),
        TW: catFor('TW'),
      },
    })
  }
  out.sort((a, b) => b.bosses - a.bosses || a.hours_per_week - b.hours_per_week)
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function fmtLastSync(): string {
  const raw = getState('last_sync_at')
  if (!raw) return ''
  const d = new Date(parseInt(raw, 10))
  // e.g. "2026-04-20 22:58 UTC"
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export function renderRankingsPage(): string {
  const data = loadRanked()
  const lastSync = fmtLastSync()
  const totalGuilds = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
  const ceGuilds = (db
    .prepare('SELECT COUNT(*) as c FROM guilds WHERE ce_achieved_at IS NOT NULL')
    .get() as { c: number }).c
  const regions = (db
    .prepare('SELECT DISTINCT region FROM guilds ORDER BY region')
    .all() as { region: string }[]).map(r => r.region)
  const servers = (db
    .prepare(
      `SELECT DISTINCT server_name, region FROM guilds
       WHERE server_name IS NOT NULL
       ORDER BY region, server_name`,
    )
    .all() as { server_name: string; region: string }[])

  const regionChips = [
    `<a class="preset" data-filter="region=">All regions</a>`,
    ...regions.map(r => `<a class="preset" data-filter="region=${encodeURIComponent(r)}">${escapeHtml(r)}</a>`),
  ].join('')

  const hourChips = [
    { label: 'All', q: 'min_hours=&max_hours=' },
    { label: 'Chill (3–4)', q: 'min_hours=3&max_hours=4' },
    { label: 'Steady (6–7)', q: 'min_hours=6&max_hours=7' },
    { label: 'Hardcore (9–10)', q: 'min_hours=9&max_hours=10' },
    { label: 'Mythic (10+)', q: 'min_hours=10&max_hours=' },
  ]
    .map(c => `<a class="preset" data-filter="${c.q}">${escapeHtml(c.label)}</a>`)
    .join('')

  const categoryChips = [
    `<a class="preset" data-filter="category=">All times</a>`,
    ...CATEGORIES.map(c => `<a class="preset" data-filter="category=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`),
  ].join('')

  const tzChips = [
    { key: 'own', label: "Guild's own" },
    { key: 'US', label: 'US' },
    { key: 'EU', label: 'EU' },
    { key: 'CN', label: 'CN' },
    { key: 'KR', label: 'KR' },
    { key: 'TW', label: 'TW' },
  ]
    .map(t => `<a class="preset" data-filter="tz=${t.key}">${escapeHtml(t.label)}</a>`)
    .join('')

  const serverOpts = servers
    .map(s => `<option value="${escapeHtml(s.server_name)}">${escapeHtml(s.server_name)} (${escapeHtml(s.region)})</option>`)
    .join('')
  const regionOpts = regions.map(r => `<option value="${r}">${r}</option>`).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Clocked — Hours Raided Before CE</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #e5e7eb; background: #0f1115; }
    .header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; justify-content: space-between; }
    .awards { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .award { flex: 1 1 200px; background: linear-gradient(180deg, #1a2332 0%, #161b22 100%);
      border: 1px solid #2d3748; border-radius: 6px; padding: 0.75rem 1rem; }
    .award-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
      color: #d4a017; font-weight: 600; margin-bottom: 4px; }
    .award-guild { font-size: 16px; font-weight: 600; color: #f3f4f6; }
    .award-meta { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
    .award-value { font-size: 14px; color: #10b981; font-variant-numeric: tabular-nums; }
    .guild-link { color: inherit; text-decoration: none; border-bottom: 1px dotted #4b5563; }
    .guild-link:hover { color: #d4a017; border-bottom-color: #d4a017; }
    .category-pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px;
      background: #1f2937; color: #cbd5e1; border: 1px solid #2d3748; }
    h1 { margin-bottom: 0.25rem; color: #f3f4f6; }
    h1 .tagline { font-size: 0.55em; font-weight: 400; color: #9ca3af; }
    .sub { color: #9ca3af; margin-bottom: 1.5rem; }
    .warn { color: #d4a017; font-size: 13px; margin-top: 6px; }
    .presets { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; align-items: center; }
    .tz-label { font-size: 12px; color: #9ca3af; margin-right: 0.25rem; }
    .preset {
      background: #161b22; color: #cbd5e1; border: 1px solid #2d3748;
      border-radius: 999px; padding: 5px 14px; font-size: 13px;
      text-decoration: none; transition: background 0.1s; cursor: pointer;
    }
    .preset:hover { background: #2d3748; }
    .preset.active { background: #d4a017; color: #0f1115; border-color: #d4a017; font-weight: 600; }
    form.filters { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: end; margin-bottom: 1rem;
      padding: 0.75rem; background: #161b22; border-radius: 6px; }
    form.filters label { display: flex; flex-direction: column; font-size: 12px; color: #9ca3af; gap: 4px; }
    form.filters input, form.filters select {
      background: #0f1115; color: #e5e7eb; border: 1px solid #2d3748; border-radius: 4px;
      padding: 4px 8px; font-size: 14px;
    }
    form.filters button, form.filters a.clear {
      background: #2d3748; color: #e5e7eb; border: none; border-radius: 4px;
      padding: 6px 12px; font-size: 14px; cursor: pointer; text-decoration: none;
      line-height: 1.5;
    }
    form.filters button:hover, form.filters a.clear:hover { background: #3a4557; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { padding: 6px 10px; border-bottom: 1px solid #1f2430; text-align: left; }
    th { background: #161b22; position: sticky; top: 0; color: #cbd5e1; }
    tbody tr:hover { background: #161b22; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #6b7280; font-size: 12px; }
    .progress { color: #6b7280; }
    .empty { padding: 2rem; text-align: center; color: #6b7280; }
    .credit { color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Clocked <span class="tagline">— hours raided before CE</span></h1>
    <span class="credit">
      ${lastSync ? `last sync: ${escapeHtml(lastSync)} · ` : ''}made by Bredie · Area 52 &lt;Death Jesters&gt;
    </span>
  </div>
  <div class="sub">
    Ranked by Mythic bosses killed, tiebroken by hours raided per week before Cutting Edge.
    ${totalGuilds} guilds tracked · ${ceGuilds} with CE · <span id="shown-count">${data.length}</span> shown.
    <span class="muted">Guilds updated ~once a day.</span>
    <div class="warn">Don't see your guild? Make sure you publicly log!</div>
  </div>
  <div id="awards" class="awards"></div>
  <div class="presets">${regionChips}</div>
  <div class="presets">${hourChips}</div>
  <div class="presets">${categoryChips}</div>
  <div class="presets"><span class="tz-label">Display times in:</span>${tzChips}</div>
  <form class="filters" id="filters-form">
    <label>Server
      <select name="server">
        <option value="">All</option>
        ${serverOpts}
      </select>
    </label>
    <label>Region
      <select name="region">
        <option value="">All</option>
        ${regionOpts}
      </select>
    </label>
    <label>Min hours/week
      <input type="number" step="0.1" name="min_hours" style="width: 90px;">
    </label>
    <label>Max hours/week
      <input type="number" step="0.1" name="max_hours" style="width: 90px;">
    </label>
    <button type="submit">Apply</button>
    <a class="clear" href="#" id="clear-filters">Clear</a>
  </form>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Guild</th>
        <th>Server</th>
        <th>Category</th>
        <th class="num">Bosses</th>
        <th class="num">Hours/week</th>
        <th class="num">Total hours</th>
        <th class="num">Nights</th>
        <th class="num">Weeks</th>
        <th>CE</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div id="empty" class="empty" style="display: none;">No guilds match. Relax filters.</div>
  <script id="guild-data" type="application/json">${JSON.stringify(data)}</script>
  <script>
    (function () {
      const GUILDS = JSON.parse(document.getElementById('guild-data').textContent);

      function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
      }
      function fmtDate(ms) {
        return ms == null ? '—' : new Date(ms).toISOString().slice(0, 10);
      }
      function guildUrl(id) {
        return 'https://www.warcraftlogs.com/guild/id/' + id;
      }

      function readFilters() {
        const p = new URLSearchParams(location.search);
        return {
          server: p.get('server') || '',
          region: p.get('region') || '',
          category: p.get('category') || '',
          tz: p.get('tz') || 'own',
          minHours: p.get('min_hours') !== null && p.get('min_hours') !== '' ? parseFloat(p.get('min_hours')) : null,
          maxHours: p.get('max_hours') !== null && p.get('max_hours') !== '' ? parseFloat(p.get('max_hours')) : null,
        };
      }

      function categoryFor(r, tz) {
        return r.categories[tz] || r.categories.own;
      }

      function filterGuilds(f) {
        return GUILDS.filter(r => {
          if (f.server && !(r.server_name || '').toLowerCase().includes(f.server.toLowerCase())) return false;
          if (f.region && r.region !== f.region) return false;
          if (f.category && categoryFor(r, f.tz) !== f.category) return false;
          if (f.minHours != null && r.hours_per_week < f.minHours) return false;
          if (f.maxHours != null && r.hours_per_week > f.maxHours) return false;
          return true;
        });
      }

      function superlatives(rows) {
        // Require enough raid data so guilds with sparse/kill-only logs don't
        // sweep "Most Efficient" or "Fastest Progression".
        const qualified = rows.filter(r => r.bosses >= 3 && r.total_hours >= 15 && r.raid_nights >= 6);
        if (qualified.length === 0) return [];
        const mostEfficient = qualified.slice().sort((a, b) => b.bosses / b.total_hours - a.bosses / a.total_hours)[0];
        const grindiest = rows.slice().sort((a, b) => b.hours_per_week - a.hours_per_week)[0];
        const mostDisciplined = rows.slice().sort((a, b) => b.raid_nights - a.raid_nights)[0];
        const marathonNight = qualified.slice().sort((a, b) => b.longest_night_hours - a.longest_night_hours)[0];
        const fastestProg = qualified.slice().sort((a, b) => b.bosses / Math.max(b.raid_weeks, 1) - a.bosses / Math.max(a.raid_weeks, 1))[0];
        return [
          { label: 'Most Efficient', guild: mostEfficient, value: (mostEfficient.bosses / mostEfficient.total_hours).toFixed(2) + ' bosses/hour' },
          { label: 'Grindiest', guild: grindiest, value: grindiest.hours_per_week.toFixed(1) + ' h/week' },
          { label: 'Fastest Progression', guild: fastestProg, value: (fastestProg.bosses / Math.max(fastestProg.raid_weeks, 1)).toFixed(1) + ' bosses/week' },
          { label: 'Marathon Night', guild: marathonNight, value: marathonNight.longest_night_hours.toFixed(1) + 'h session' },
          { label: 'Most Nights', guild: mostDisciplined, value: mostDisciplined.raid_nights + ' nights' },
        ];
      }

      function renderAwards(rows) {
        const awards = superlatives(rows);
        const html = awards.map(a => \`<div class="award">
          <div class="award-label">\${esc(a.label)}</div>
          <div class="award-guild"><a class="guild-link" href="\${guildUrl(a.guild.id)}" target="_blank" rel="noopener">\${esc(a.guild.name)}</a></div>
          <div class="award-meta">\${esc(a.guild.server_name ?? '')} <span class="muted">\${esc(a.guild.region)}</span></div>
          <div class="award-value">\${esc(a.value)}</div>
        </div>\`).join('');
        document.getElementById('awards').innerHTML = html;
      }

      let CURRENT_TZ = 'own';

      function renderTable(rows) {
        const tbody = document.getElementById('tbody');
        const empty = document.getElementById('empty');
        if (rows.length === 0) {
          tbody.innerHTML = '';
          empty.style.display = '';
          return;
        }
        empty.style.display = 'none';
        // Batch DOM update
        const html = rows.map((r, i) => \`<tr>
          <td>\${i + 1}</td>
          <td><a class="guild-link" href="\${guildUrl(r.id)}" target="_blank" rel="noopener">\${esc(r.name)}</a></td>
          <td>\${esc(r.server_name ?? '')} <span class="muted">\${esc(r.region)}</span></td>
          <td><span class="category-pill">\${esc(categoryFor(r, CURRENT_TZ))}</span></td>
          <td class="num">\${r.bosses}/9</td>
          <td class="num">\${r.hours_per_week.toFixed(1)}</td>
          <td class="num">\${r.total_hours.toFixed(1)}</td>
          <td class="num">\${r.raid_nights}</td>
          <td class="num">\${r.raid_weeks}</td>
          <td>\${r.ce_achieved_at !== null ? fmtDate(r.ce_achieved_at) : '<span class="progress">—</span>'}</td>
        </tr>\`).join('');
        tbody.innerHTML = html;
      }

      function updateChipActive(f) {
        document.querySelectorAll('[data-filter]').forEach(el => {
          const updates = new URLSearchParams(el.dataset.filter);
          let match = true;
          for (const [k, v] of updates) {
            const current = {
              server: f.server,
              region: f.region,
              category: f.category,
              tz: f.tz,
              min_hours: f.minHours != null ? String(f.minHours) : '',
              max_hours: f.maxHours != null ? String(f.maxHours) : '',
            }[k] || '';
            if (current !== v) { match = false; break; }
          }
          el.classList.toggle('active', match);
        });
      }

      function updateFormValues(f) {
        const form = document.getElementById('filters-form');
        form.querySelector('[name=server]').value = f.server;
        form.querySelector('[name=region]').value = f.region;
        form.querySelector('[name=min_hours]').value = f.minHours != null ? f.minHours : '';
        form.querySelector('[name=max_hours]').value = f.maxHours != null ? f.maxHours : '';
      }

      function render() {
        const f = readFilters();
        CURRENT_TZ = f.tz;
        const rows = filterGuilds(f);
        renderAwards(rows);
        renderTable(rows);
        updateChipActive(f);
        updateFormValues(f);
        document.getElementById('shown-count').textContent = rows.length;
      }

      function updateUrl(params) {
        const qs = params.toString();
        history.pushState({}, '', qs ? '?' + qs : location.pathname);
      }

      document.addEventListener('click', e => {
        const a = e.target.closest('a[data-filter]');
        if (!a) return;
        e.preventDefault();
        const params = new URLSearchParams(location.search);
        for (const [k, v] of new URLSearchParams(a.dataset.filter)) {
          if (v === '') params.delete(k); else params.set(k, v);
        }
        updateUrl(params);
        render();
      });

      document.getElementById('filters-form').addEventListener('submit', e => {
        e.preventDefault();
        const data = new FormData(e.target);
        const params = new URLSearchParams();
        for (const [k, v] of data) if (v) params.set(k, v);
        updateUrl(params);
        render();
      });

      document.getElementById('clear-filters').addEventListener('click', e => {
        e.preventDefault();
        updateUrl(new URLSearchParams());
        render();
      });

      window.addEventListener('popstate', render);
      render();
    })();
  </script>
  ${
    process.env.STATIC_BUILD
      ? ''
      : `<script>
    (function () {
      let boot = null;
      const es = new EventSource('/__reload');
      es.onmessage = function (e) {
        if (boot !== null && boot !== e.data) location.reload();
        boot = e.data;
      };
    })();
  </script>`
  }
</body>
</html>`
}
