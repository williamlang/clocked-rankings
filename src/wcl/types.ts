export interface RateLimitData {
  limitPerHour: number
  pointsSpentThisHour: number
  pointsResetIn: number
}

export interface WorldZone {
  id: number
  name: string
  encounters: Array<{ id: number; name: string }>
}

export interface WorldDataResponse {
  worldData: { zones: WorldZone[] }
}

export interface GuildRankingEntry {
  name: string
  server: { id: number; name: string; region: string; slug?: string }
  faction?: { name: string }
  guildID?: number
  // Guild rankings for an encounter expose guild via nested fields — WCL returns a JSON scalar
}

// rankings() on encounters returns a JSON scalar. Shape for a `GuildRankings` response:
export interface EncounterRankingsJSON {
  page: number
  hasMorePages: boolean
  count: number
  rankings: Array<{
    name: string // guild name
    server: { name: string; region: string }
    faction: number
    guild?: { id: number; name: string; faction: number }
    startTime?: number
    duration?: number
    reportID?: string
  }>
}

export interface GuildReportSummary {
  code: string
  startTime: number
  endTime: number
  zone?: { id: number } | null
}

export interface GuildReportsPage {
  data: GuildReportSummary[]
  total: number
  per_page: number
  current_page: number
  has_more_pages: boolean
}

export interface ReportFightsData {
  startTime: number
  endTime: number
  zone?: { id: number } | null
  fights: Array<{
    id: number
    startTime: number
    endTime: number
    encounterID: number
    difficulty: number | null
    kill: boolean | null
  }>
}
