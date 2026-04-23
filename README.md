# Clocked

Ranks World of Warcraft Mythic raid guilds by hours raided per week before
Cutting Edge. Live at [clockedrankings.github.io/clocked-rankings](https://clockedrankings.github.io/clocked-rankings/).

For the current tier (Voidspire / Dreamrift / March on Quel'danas), pulls
guild rankings from WarcraftLogs, fetches each guild's reports + per-fight
timestamps, and computes:

- **Bosses killed** on Mythic (out of 9 tier encounters)
- **Hours raided per week** before their Cutting Edge kill (Midnight Falls)
- **Raid category** based on local-time start (Late Night / Evening / etc.)
- Standout badges (Most Efficient, Grindiest, Marathon Night, etc.)

## How it works

The static site is generated and published by GitHub Actions:

1. Cron workflow runs every 5 minutes (GitHub silently drops most of these
   under load — over-scheduling compensates).
2. Restores the SQLite DB from the Actions cache.
3. Runs `npm run sync`:
   - Discovers Mythic guilds across every encounter × partition
   - Fetches each guild's reports and per-fight timestamps
   - Marks CE when a guild kills the tier's gating boss on Mythic
   - Exits cleanly on rate-limit; checkpoints persist progress
4. Saves the DB back to cache.
5. Runs `npm run build` — embeds all guild data as JSON in a single
   self-contained HTML file. Filter/sort/render runs entirely in the
   browser.
6. Deploys to GitHub Pages.

## Local development

```sh
cp .env.example .env  # fill in WCL_CLIENT_ID and WCL_CLIENT_SECRET
docker compose up -d  # http://localhost:3457
```

The Docker container runs `tsx watch` for hot reload, and the page
auto-refreshes via SSE when source changes. Sync is disabled in Docker
by default (see `DISABLE_SYNC` in `docker-compose.yml`) since GitHub
Actions owns the sync; remove the env var to run sync locally too.

Without Docker:

```sh
npm install
npm run dev      # server with hot reload
npm run sync     # populate the DB
npm run build    # write static dist/index.html
npm run credits  # check WCL rate-limit usage
```

## Tech

- Node 22 + tsx (no compile step)
- Hono web server (dev only)
- better-sqlite3 (local cache + DB)
- WarcraftLogs GraphQL v2 client-credentials OAuth
- GitHub Pages for static hosting

## File map

```
src/
  cli.ts            dev server entrypoint
  server.ts         Hono routes
  page.ts           HTML template + embedded JSON + client-side filtering JS
  build.ts          static build (writes dist/index.html)
  config.ts         env vars, DB path
  auth.ts           WCL OAuth client-credentials flow
  db.ts             SQLite schema + sync_state helpers
  wcl/              GraphQL client, queries, types
  sync/             zones, guild discovery, per-guild report+fight sync
scripts/            one-off probes for the WCL API
.github/workflows/  cron + build + deploy
```
