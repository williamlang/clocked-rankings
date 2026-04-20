import { getAccessToken } from '../src/auth.js'
import { WCL_API_URL } from '../src/config.js'

const code = process.argv[2] ?? 'qMAYnjQTNHFth6yg'
const token = await getAccessToken()

const query = `query P($code: String!) {
  reportData {
    report(code: $code) {
      startTime endTime
      fights { id startTime endTime encounterID difficulty kill name }
    }
  }
  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
}`

const res = await fetch(WCL_API_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { code } }),
})

if (!res.ok) {
  console.error('HTTP', res.status, await res.text())
  process.exit(1)
}

const json = (await res.json()) as {
  data: {
    reportData: {
      report: {
        startTime: number
        endTime: number
        fights: Array<{ id: number; startTime: number; endTime: number; encounterID: number; difficulty: number | null; kill: boolean | null; name: string }>
      }
    }
    rateLimitData: { limitPerHour: number; pointsSpentThisHour: number; pointsResetIn: number }
  }
}

const r = json.data.reportData.report
console.log(`report ${code}  ${r.fights.length} fights  (${((r.endTime - r.startTime) / 60000).toFixed(0)}m span)`)
for (const f of r.fights) {
  const t = new Date(r.startTime + f.startTime).toISOString().slice(11, 19)
  const dur = ((f.endTime - f.startTime) / 60000).toFixed(1)
  console.log(`  ${t} ${dur}m  enc=${f.encounterID} diff=${f.difficulty} kill=${f.kill}  ${f.name}`)
}
const rl = json.data.rateLimitData
console.log(`\nrate limit: ${rl.pointsSpentThisHour.toFixed(0)}/${rl.limitPerHour}  reset in ${rl.pointsResetIn}s`)
