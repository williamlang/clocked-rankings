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

// Pace requests to stay under Raider.IO's per-key throttle. Unauthenticated
// is documented as 200/min; with a key it's higher but unspecified. 300ms
// between calls (~200/min) is well within both. Bursting hit a 403
// "Access Denied" anti-abuse response after ~90 calls in <30s.
const MIN_INTERVAL_MS = 300
let lastCallAt = 0

async function rioGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
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
  // 403 "Access Denied" is RIO's anti-abuse soft block — treat as rate-limit.
  if (res.status === 403) {
    throw new RioRateLimitError(parseInt(res.headers.get('retry-after') ?? '300', 10))
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
