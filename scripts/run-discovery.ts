import { ensureZones, getAllEncounterIDs, loadEncounters } from '../src/sync/zones.js'
import { syncGuilds } from '../src/sync/guilds.js'
import { getLastRateLimit, RateLimitError } from '../src/wcl/client.js'
import { db } from '../src/db.js'

await ensureZones()

const encs = loadEncounters()
console.log(`Discovering guilds across ${encs.length} encounters on Mythic...`)

try {
  await syncGuilds(getAllEncounterIDs())
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(`\n⚠ rate limit hit: ${err.message}`)
  } else {
    throw err
  }
}

const total = (db.prepare('SELECT COUNT(*) as c FROM guilds').get() as { c: number }).c
console.log(`\n${total} unique guilds discovered`)

const regionBreakdown = db
  .prepare('SELECT region, COUNT(*) as c FROM guilds GROUP BY region ORDER BY c DESC')
  .all() as { region: string; c: number }[]
for (const r of regionBreakdown) console.log(`  ${r.region}: ${r.c}`)

const rl = getLastRateLimit()
if (rl) {
  console.log(`\nRate limit: ${rl.pointsSpentThisHour}/${rl.limitPerHour} used, resets in ${rl.pointsResetIn}s`)
}
