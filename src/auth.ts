import fs from 'fs'
import path from 'path'
import { TOKEN_PATH, CLIENT_ID, CLIENT_SECRET, WCL_TOKEN_URL } from './config.js'

interface TokenData {
  access_token: string
  token_type: string
  expires_in: number
  expires_at: number
}

function readCached(): TokenData | null {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return null
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) as TokenData
    // 60s safety margin
    if (data.expires_at < Date.now() + 60_000) return null
    return data
  } catch {
    return null
  }
}

function writeCached(raw: Omit<TokenData, 'expires_at'>): TokenData {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true })
  const data: TokenData = { ...raw, expires_at: Date.now() + raw.expires_in * 1000 }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2))
  return data
}

// Client Credentials flow — no user interaction needed.
export async function getAccessToken(): Promise<string> {
  const cached = readCached()
  if (cached) return cached.access_token

  const res = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`)
  const token = (await res.json()) as Omit<TokenData, 'expires_at'>
  return writeCached(token).access_token
}
