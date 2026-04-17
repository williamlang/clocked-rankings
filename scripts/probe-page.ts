import { gql } from '../src/wcl/client.js'

const res = await gql<{ worldData: { encounter: { fightRankings: unknown } } }>(
  `query P($id: Int!, $page: Int!) { worldData { encounter(id: $id) { fightRankings(difficulty: 5, page: $page) } } }`,
  { id: 3176, page: 21 },
)
console.log(JSON.stringify(res.worldData.encounter.fightRankings, null, 2))
