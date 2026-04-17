import { gql } from '../src/wcl/client.js'
import { getAllEncounterIDs, ensureZones } from '../src/sync/zones.js'

await ensureZones()
const ids = getAllEncounterIDs()

for (const id of ids) {
  const res = await gql<{ worldData: { encounter: { fightRankings: unknown } } }>(
    `query P($id: Int!) { worldData { encounter(id: $id) { fightRankings(difficulty: 5, page: 1) } } }`,
    { id },
  )
  const r = res.worldData.encounter.fightRankings as Record<string, unknown>
  const keys = r ? Object.keys(r) : []
  const rr = r?.rankings
  console.log(`encounter ${id}: keys=[${keys.join(',')}] rankings=${Array.isArray(rr) ? rr.length + ' entries' : typeof rr}`)
  if (!Array.isArray(rr)) {
    console.log('  full:', JSON.stringify(r).slice(0, 400))
  }
}
