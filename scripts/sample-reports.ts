import { db } from '../src/db.js'
import { ensureZones } from '../src/sync/zones.js'
import { syncReports } from '../src/sync/reports.js'
import { getLastRateLimit, RateLimitError } from '../src/wcl/client.js'

await ensureZones()

const before = getLastRateLimit()
const startedAt = Date.now()
const SAMPLE = 10

console.log(`Sampling report sync for ${SAMPLE} guilds...`)

try {
  await syncReports(SAMPLE)
} catch (err) {
  if (err instanceof RateLimitError) console.error(`\n⚠ rate limit: ${err.message}`)
  else throw err
}

const after = getLastRateLimit()
const elapsedSec = (Date.now() - startedAt) / 1000

const pointsUsed = (after?.pointsSpentThisHour ?? 0) - (before?.pointsSpentThisHour ?? 0)

const reports = (db.prepare('SELECT COUNT(*) as c FROM reports').get() as { c: number }).c
const kills = (db.prepare('SELECT COUNT(*) as c FROM mythic_kills').get() as { c: number }).c
const ce = (db.prepare('SELECT COUNT(*) as c FROM guilds WHERE ce_achieved_at IS NOT NULL').get() as {
  c: number
}).c
const synced = (db
  .prepare('SELECT COUNT(*) as c FROM guilds WHERE reports_synced_at IS NOT NULL')
  .get() as { c: number }).c

console.log('')
console.log(`  ${synced}/${SAMPLE} guilds synced in ${elapsedSec.toFixed(1)}s`)
console.log(`  ${reports} reports fetched, ${kills} mythic kills logged, ${ce} CE'd`)
console.log(`  rate-limit points used: ${pointsUsed.toFixed(2)} (${(pointsUsed / Math.max(synced, 1)).toFixed(2)} per guild)`)

if (after) {
  const remaining = after.limitPerHour - after.pointsSpentThisHour
  const perGuild = pointsUsed / Math.max(synced, 1)
  const capacity = Math.floor(remaining / Math.max(perGuild, 0.01))
  console.log(`  current remaining: ${remaining.toFixed(0)} → capacity for ~${capacity} more guilds this hour`)
}
