import { ensureZones, loadEncounters } from '../src/sync/zones.js'

const zone = await ensureZones()
console.log(`Resolved zone: ${zone.id} — ${zone.name}`)
console.log('Encounters:')
for (const e of loadEncounters()) {
  const tag = e.is_ce_gate ? ' [CE gate]' : ''
  console.log(`  ${e.id} — ${e.name}  (${e.sub_raid ?? 'unknown'})${tag}`)
}
