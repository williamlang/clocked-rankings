import { fetchZones } from '../src/wcl/client.js'

const zones = await fetchZones()
const target = zones.find(z => z.id === 46)
if (!target) throw new Error('Zone 46 not found')
console.log(`Zone ${target.id} — ${target.name}`)
console.log('Encounters:')
for (const e of target.encounters) {
  console.log(`  ${e.id} — ${e.name}`)
}
