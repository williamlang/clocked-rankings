import { CLIENT_ID, CLIENT_SECRET } from '../config.js'
import { ensureZones, getAllEncounterIDs } from './zones.js'
import { syncGuilds } from './guilds.js'
import { syncReports } from './reports.js'
import { RateLimitError, getLastRateLimit } from '../wcl/client.js'
import { db } from '../db.js'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set in .env')
  process.exit(1)
}

function logRateLimit(): void {
  const rl = getLastRateLimit()
  if (!rl) return
  const remaining = rl.limitPerHour - rl.pointsSpentThisHour
  console.log(`  Rate limit: ${rl.pointsSpentThisHour}/${rl.limitPerHour} (${remaining} left, resets in ${rl.pointsResetIn}s)`)
}

async function main(): Promise<void> {
  console.log('→ Ensuring zones...')
  const zone = await ensureZones()
  console.log(`  zone ${zone.id}: ${zone.name}`)

  console.log('→ Discovering guilds with ≥1 Mythic kill...')
  const before = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
  await syncGuilds(getAllEncounterIDs())
  const after = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
  console.log(`  ${after} total guilds (+${after - before} new)`)
  logRateLimit()

  console.log('→ Syncing reports for non-CE guilds...')
  await syncReports()
  const ceCount = (db.prepare('SELECT COUNT(*) as c FROM guilds WHERE ce_achieved_at IS NOT NULL').get() as { c: number }).c
  console.log(`  ${ceCount} guilds now have CE`)
  logRateLimit()

  console.log('✓ Sync complete')
}

main().catch(err => {
  if (err instanceof RateLimitError) {
    console.error(`\n⚠ Hit rate limit. Progress saved — rerun \`npm run sync\` after ${err.resetIn}s.`)
    logRateLimit()
    process.exit(2)
  }
  console.error(err)
  process.exit(1)
})
