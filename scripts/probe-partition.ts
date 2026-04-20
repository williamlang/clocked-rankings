import { gql } from '../src/wcl/client.js'

// Try explicit partitions
for (const partition of [-1, 1, 2, 3, 4, 5]) {
  const res = await gql<{ worldData: { encounter: { fightRankings: unknown } } }>(
    `query P($id: Int!, $p: Int!) {
      worldData {
        encounter(id: $id) {
          fightRankings(difficulty: 5, page: 1, partition: $p)
        }
      }
    }`,
    { id: 3183, p: partition },
  )
  const r = res.worldData.encounter.fightRankings as Record<string, unknown>
  const rankings = r?.rankings as unknown[] | undefined
  console.log(`partition ${partition}: count=${r.count} rankings=${rankings?.length ?? 'n/a'} err=${r.error ?? 'none'}`)
}
