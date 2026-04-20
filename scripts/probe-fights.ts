import { gql } from '../src/wcl/client.js'

const code = process.argv[2] ?? 'qMAYnjQTNHFth6yg'

const res = await gql<{ reportData: { report: { startTime: number; endTime: number; fights: unknown[] } } }>(
  `query P($code: String!) {
    reportData {
      report(code: $code) {
        startTime
        endTime
        fights {
          id
          startTime
          endTime
          encounterID
          difficulty
          kill
          name
        }
      }
    }
  }`,
  { code },
)

const r = res.reportData.report
console.log('Report:', code)
console.log('Start:', new Date(r.startTime).toISOString())
console.log('End:  ', new Date(r.endTime).toISOString())
console.log('Duration:', ((r.endTime - r.startTime) / 60000).toFixed(0), 'min')
console.log('Total fights returned:', r.fights.length)
console.log('\nFights:')
for (const f of r.fights as Array<{ id: number; startTime: number; endTime: number; encounterID: number; difficulty: number | null; kill: boolean | null; name: string }>) {
  const dur = ((f.endTime - f.startTime) / 60000).toFixed(1)
  console.log(`  #${f.id} ${new Date(r.startTime + f.startTime).toISOString().slice(11, 19)} ${dur}m  enc=${f.encounterID} diff=${f.difficulty} kill=${f.kill}  ${f.name}`)
}
