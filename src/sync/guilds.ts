import { db, getState, setState, clearState } from '../db.js'
import { fetchEncounterRankings } from '../wcl/client.js'

interface DiscoveryCheckpoint {
  encounterIdx: number
  page: number
}

const STATE_KEY = 'guild_discovery_checkpoint'

function loadCheckpoint(): DiscoveryCheckpoint {
  const raw = getState(STATE_KEY)
  if (!raw) return { encounterIdx: 0, page: 1 }
  return JSON.parse(raw) as DiscoveryCheckpoint
}

function saveCheckpoint(cp: DiscoveryCheckpoint): void {
  setState(STATE_KEY, JSON.stringify(cp))
}

// Iterate Mythic guild rankings across every encounter in the tier.
// A guild that appears on ANY encounter's Mythic rankings has ≥1 Mythic kill.
export async function syncGuilds(encounterIDs: number[]): Promise<void> {
  const cp = loadCheckpoint()

  const insertGuild = db.prepare(`
    INSERT INTO guilds (id, name, server_slug, server_name, region, faction)
    VALUES (@id, @name, @server_slug, @server_name, @region, @faction)
    ON CONFLICT(id) DO NOTHING
  `)

  for (let i = cp.encounterIdx; i < encounterIDs.length; i++) {
    const encounterID = encounterIDs[i]
    let page = i === cp.encounterIdx ? cp.page : 1

    while (true) {
      saveCheckpoint({ encounterIdx: i, page })
      const rankings = await fetchEncounterRankings(encounterID, page)

      const tx = db.transaction(() => {
        for (const entry of rankings.rankings) {
          if (!entry.guild?.id) continue
          insertGuild.run({
            id: entry.guild.id,
            name: entry.guild.name,
            server_slug: entry.server.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            server_name: entry.server.name,
            region: entry.server.region,
            faction:
              entry.guild.faction === 1 ? 'Alliance' : entry.guild.faction === 2 ? 'Horde' : null,
          })
        }
      })
      tx()

      if (!rankings.hasMorePages) break
      page += 1
    }
  }

  clearState(STATE_KEY)
}
