import { db } from '../db.js'
import { TIER_ZONE_NAME, ENCOUNTER_SUBRAID, CE_GATE_ENCOUNTER_IDS } from '../config.js'
import { fetchZones } from '../wcl/client.js'

interface ZoneRow {
  id: number
  name: string
}

interface EncounterRow {
  id: number
  zone_id: number
  name: string
  ordinal: number
  sub_raid: string | null
  is_ce_gate: number
}

export function loadZone(): ZoneRow | null {
  return (db.prepare('SELECT id, name FROM zones LIMIT 1').get() as ZoneRow) ?? null
}

export function loadEncounters(): EncounterRow[] {
  return db
    .prepare(
      'SELECT id, zone_id, name, ordinal, sub_raid, is_ce_gate FROM encounters ORDER BY ordinal',
    )
    .all() as EncounterRow[]
}

export async function ensureZones(): Promise<ZoneRow> {
  const cached = loadZone()
  if (cached && loadEncounters().length > 0) return cached

  const all = await fetchZones()
  const zone = all.find(z => z.name.toLowerCase() === TIER_ZONE_NAME.toLowerCase())
  if (!zone) {
    const available = all.map(z => `${z.id}: ${z.name}`).join('\n  ')
    throw new Error(`Zone "${TIER_ZONE_NAME}" not found. Available zones:\n  ${available}`)
  }

  const ceSet = new Set(CE_GATE_ENCOUNTER_IDS)
  const insertZone = db.prepare('INSERT OR REPLACE INTO zones (id, name) VALUES (?, ?)')
  const insertEnc = db.prepare(
    'INSERT OR REPLACE INTO encounters (id, zone_id, name, ordinal, sub_raid, is_ce_gate) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const tx = db.transaction(() => {
    insertZone.run(zone.id, zone.name)
    zone.encounters.forEach((e, i) => {
      insertEnc.run(e.id, zone.id, e.name, i, ENCOUNTER_SUBRAID[e.id] ?? null, ceSet.has(e.id) ? 1 : 0)
    })
  })
  tx()

  return { id: zone.id, name: zone.name }
}

export function getCEGateEncounterIDs(): number[] {
  return (db.prepare('SELECT id FROM encounters WHERE is_ce_gate = 1').all() as { id: number }[]).map(
    r => r.id,
  )
}

export function getAllEncounterIDs(): number[] {
  return (db.prepare('SELECT id FROM encounters ORDER BY ordinal').all() as { id: number }[]).map(
    r => r.id,
  )
}
