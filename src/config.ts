import 'dotenv/config'
import path from 'path'
import os from 'os'

export const PORT = parseInt(process.env.PORT ?? '3457', 10)
export const CLIENT_ID = process.env.WCL_CLIENT_ID ?? ''
export const CLIENT_SECRET = process.env.WCL_CLIENT_SECRET ?? ''
export const REDIRECT_URI = `http://localhost:${PORT}/callback`

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'guild-rankings-by-day')
export const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json')
export const DB_PATH = process.env.DB_PATH ?? path.join(CONFIG_DIR, 'data.db')

export const WCL_AUTHORIZE_URL = 'https://www.warcraftlogs.com/oauth/authorize'
export const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token'
export const WCL_API_URL = 'https://www.warcraftlogs.com/api/v2/client'

export const TIER_ZONE_NAME = 'VS / DR / MQD'

// Encounter ID → sub-raid name. WCL merges all three raids into zone 46.
export const ENCOUNTER_SUBRAID: Record<number, string> = {
  3176: 'Voidspire',
  3177: 'Voidspire',
  3179: 'Voidspire',
  3178: 'Voidspire',
  3180: 'Voidspire',
  3181: 'Voidspire',
  3306: 'Dreamrift',
  3182: "March on Quel'danas",
  3183: "March on Quel'danas",
}

// CE = Mythic kill of Midnight Falls (final boss of March on Quel'danas).
export const CE_GATE_ENCOUNTER_IDS: readonly number[] = [3183]
