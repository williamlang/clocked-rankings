import { gql } from '../src/wcl/client.js'

// Probe raw shape — stringify everything so we can see what WCL returns.
const res = await gql<{ worldData: { encounter: { fightRankings: unknown } } }>(
  `query Probe($id: Int!) {
    worldData {
      encounter(id: $id) {
        fightRankings(difficulty: 5, page: 1)
      }
    }
  }`,
  { id: 3183 },
)

const rankings = res.worldData.encounter.fightRankings
console.log('Top-level keys:', Object.keys(rankings as Record<string, unknown>))
console.log('\nSample:')
const sample = JSON.stringify(rankings, null, 2)
console.log(sample.slice(0, 3000))
console.log(sample.length > 3000 ? `\n... [truncated, total ${sample.length} chars]` : '')
