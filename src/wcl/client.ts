import { getAccessToken } from '../auth.js'
import { WCL_API_URL } from '../config.js'
import { setState } from '../db.js'
import {
  GET_ZONES,
  GET_ENCOUNTER_GUILD_RANKINGS,
  GET_GUILD_REPORTS,
  GET_REPORT_FIGHTS,
} from './queries.js'
import type {
  RateLimitData,
  WorldDataResponse,
  EncounterRankingsJSON,
  GuildReportsPage,
  ReportFightsData,
} from './types.js'

export class RateLimitError extends Error {
  constructor(public resetIn: number, public spent: number, public limit: number) {
    super(`WCL rate limit hit: ${spent}/${limit}, resets in ${resetIn}s`)
    this.name = 'RateLimitError'
  }
}

let lastRateLimit: RateLimitData | null = null
export function getLastRateLimit(): RateLimitData | null {
  return lastRateLimit
}

// Safety margin — stop well before hitting the cap so we can checkpoint cleanly.
const RATE_LIMIT_SAFETY = 50

function withRateLimit(query: string): string {
  return query.trimEnd().replace(/}(\s*)$/, `  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }\n}$1`)
}

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken()

  const res = await fetch(WCL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: withRateLimit(query), variables }),
  })

  if (res.status === 429) {
    const reset = parseInt(res.headers.get('retry-after') ?? '3600', 10)
    throw new RateLimitError(reset, lastRateLimit?.pointsSpentThisHour ?? 0, lastRateLimit?.limitPerHour ?? 0)
  }

  if (!res.ok) throw new Error(`WCL API error: ${res.status} ${await res.text()}`)

  const json = (await res.json()) as {
    data?: T & { rateLimitData?: RateLimitData }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    throw new Error(`GraphQL: ${json.errors.map(e => e.message).join(', ')}`)
  }

  if (json.data?.rateLimitData) {
    lastRateLimit = json.data.rateLimitData
    setState('last_rate_limit', JSON.stringify({ ...lastRateLimit, capturedAt: Date.now() }))
    const remaining = lastRateLimit.limitPerHour - lastRateLimit.pointsSpentThisHour
    if (remaining < RATE_LIMIT_SAFETY) {
      throw new RateLimitError(
        lastRateLimit.pointsResetIn,
        lastRateLimit.pointsSpentThisHour,
        lastRateLimit.limitPerHour,
      )
    }
  }

  return json.data as T
}

export async function fetchZones(): Promise<WorldDataResponse['worldData']['zones']> {
  const data = await gql<WorldDataResponse>(GET_ZONES, {})
  return data.worldData.zones
}

export async function fetchEncounterRankings(
  encounterID: number,
  page: number,
): Promise<EncounterRankingsJSON> {
  const data = await gql<{
    worldData: { encounter: { fightRankings: EncounterRankingsJSON | { error: string } } }
  }>(GET_ENCOUNTER_GUILD_RANKINGS, { encounterID, page })
  const raw = data.worldData.encounter.fightRankings
  // WCL returns { error: "..." } when page > 20 (hard cap) or invalid partition
  if ('error' in raw) return { page, hasMorePages: false, count: 0, rankings: [] }
  return raw
}

export async function fetchGuildReports(
  guildID: number,
  page: number,
  zoneID: number | null = null,
): Promise<GuildReportsPage> {
  const data = await gql<{ reportData: { reports: GuildReportsPage } }>(GET_GUILD_REPORTS, {
    guildID,
    page,
    zoneID: zoneID ?? undefined,
  })
  return data.reportData.reports
}

export async function fetchReportFights(code: string): Promise<ReportFightsData> {
  const data = await gql<{ reportData: { report: ReportFightsData } }>(GET_REPORT_FIGHTS, { code })
  return data.reportData.report
}
