import { RIO_API_KEY, RIO_API_URL, RIO_TIER_SLUG } from '../config.js'
import type {
  RioDifficulty,
  RioRaidPullsResponse,
  RioRaidRankingsResponse,
  RioRegion,
} from './types.js'

export class RioRateLimitError extends Error {
  constructor(public retryAfter: number) {
    super(`Raider.IO rate limit hit; retry after ${retryAfter}s`)
    this.name = 'RioRateLimitError'
  }
}

export class RioServerError extends Error {
  constructor(public status: number, body: string) {
    super(`Raider.IO server error: ${status} ${body.slice(0, 200)}`)
    this.name = 'RioServerError'
  }
}

// Pace requests under Raider.IO's per-key throttle. Authenticated keys are
// documented at 1000/min, but anti-abuse soft-blocks (403) trigger on
// sustained uniform bursts well under that. 250ms ± 50ms jitter (~240/min
// average) breaks the bot-like cadence the heuristic latches onto.
const MIN_INTERVAL_MS = 250
const JITTER_MS = 50
const MAX_403_RETRIES = 1
const RETRY_403_CAP_SECS = 60
let lastCallAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function rioGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  retries403 = 0,
): Promise<T> {
  const jitter = Math.floor((Math.random() * 2 - 1) * JITTER_MS)
  const wait = MIN_INTERVAL_MS + jitter - (Date.now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()

  const search = new URLSearchParams()
  if (RIO_API_KEY) search.set('access_key', RIO_API_KEY)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v))
  }
  const res = await fetch(`${RIO_API_URL}${path}?${search.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (res.status === 429) {
    throw new RioRateLimitError(parseInt(res.headers.get('retry-after') ?? '60', 10))
  }
  // 403 "Access Denied" is RIO's anti-abuse soft block. The header default of
  // 300s overstates how long the block actually lasts; cap our in-process
  // sleep at RETRY_403_CAP_SECS so a single run can recover. If a retry also
  // 403s, give up and let the next cron run resume from the cursor.
  if (res.status === 403) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '300', 10)
    if (retries403 < MAX_403_RETRIES) {
      const sleepSecs = Math.min(retryAfter, RETRY_403_CAP_SECS)
      console.log(`  RIO 403 anti-abuse — sleeping ${sleepSecs}s then retrying once`)
      await sleep(sleepSecs * 1000)
      return rioGet<T>(path, params, retries403 + 1)
    }
    throw new RioRateLimitError(retryAfter)
  }
  if (res.status >= 500) {
    throw new RioServerError(res.status, await res.text())
  }
  if (res.status === 400 || res.status === 404) {
    // Empty / not-tracked guild — treat as "no data"
    return null as T
  }
  if (!res.ok) {
    throw new Error(`Raider.IO ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export async function fetchRaidRankings(
  region: RioRegion | 'world',
  page: number,
  limit = 200,
): Promise<RioRaidRankingsResponse | null> {
  return rioGet<RioRaidRankingsResponse>('/raiding/raid-rankings', {
    raid: RIO_TIER_SLUG,
    difficulty: 'mythic',
    region,
    page,
    limit,
  })
}

export async function fetchRaidPulls(args: {
  region: string
  realm: string
  guild: string
  difficulty: RioDifficulty
}): Promise<RioRaidPullsResponse | null> {
  return rioGet<RioRaidPullsResponse>('/live-tracking/guild/raid-pulls', {
    raid: RIO_TIER_SLUG,
    difficulty: args.difficulty,
    region: args.region,
    realm: args.realm,
    guild: args.guild,
  })
}
