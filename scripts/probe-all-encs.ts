import { gql } from '../src/wcl/client.js'

const encs = [3176, 3177, 3179, 3178, 3180, 3181, 3306, 3182, 3183]

for (const id of encs) {
  const res = await gql<{ worldData: { encounter: { fightRankings: unknown } } }>(
    `query P($id: Int!) {
      worldData {
        encounter(id: $id) {
          fightRankings(difficulty: 5, page: 1)
        }
      }
    }`,
    { id },
  )
  const r = res.worldData.encounter.fightRankings as Record<string, unknown>
  const rankings = r?.rankings as unknown[] | undefined
  console.log(`enc ${id}: count=${r.count} rankings=${rankings?.length ?? 'n/a'} hasMore=${r.hasMorePages} err=${r.error ?? 'none'}`)
}
