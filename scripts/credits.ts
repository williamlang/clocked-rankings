import { getAccessToken } from '../src/auth.js'
import { WCL_API_URL } from '../src/config.js'

// Direct fetch — bypass the gql wrapper's safety margin so we can still
// check status when near the cap.
const token = await getAccessToken()
const res = await fetch(WCL_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'query { rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }',
  }),
})

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`)
  process.exit(1)
}

const json = (await res.json()) as {
  data: { rateLimitData: { limitPerHour: number; pointsSpentThisHour: number; pointsResetIn: number } }
}
const rl = json.data.rateLimitData

const remaining = rl.limitPerHour - rl.pointsSpentThisHour
const pct = (rl.pointsSpentThisHour / rl.limitPerHour) * 100
const resetMin = Math.floor(rl.pointsResetIn / 60)
const resetSec = rl.pointsResetIn % 60

const bar = '█'.repeat(Math.floor(pct / 2.5)).padEnd(40, '░')
const color = pct > 90 ? '\x1b[31m' : pct > 70 ? '\x1b[33m' : '\x1b[32m'
const reset = '\x1b[0m'

console.log(`\n  WCL rate limit`)
console.log(`  ${color}${bar}${reset}  ${pct.toFixed(1)}%`)
console.log(`  spent:     ${rl.pointsSpentThisHour.toFixed(0)} / ${rl.limitPerHour}`)
console.log(`  remaining: ${color}${remaining.toFixed(0)}${reset} credits`)
console.log(`  resets in: ${resetMin}m ${resetSec}s\n`)
