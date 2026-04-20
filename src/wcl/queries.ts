export const GET_ZONES = `
  query GetZones {
    worldData {
      zones {
        id
        name
        encounters { id name }
      }
    }
  }
`

// Encounter rankings with guild filter. `metric: execution` groups by guild (GuildRankings).
// `difficulty: 5` = Mythic. The response is a JSON scalar.
export const GET_ENCOUNTER_GUILD_RANKINGS = `
  query GetEncounterGuildRankings($encounterID: Int!, $page: Int!) {
    worldData {
      encounter(id: $encounterID) {
        fightRankings(
          difficulty: 5
          page: $page
          partition: 1
        )
      }
    }
  }
`

export const GET_GUILD_REPORTS = `
  query GetGuildReports($guildID: Int!, $page: Int!, $zoneID: Int) {
    reportData {
      reports(guildID: $guildID, page: $page, limit: 25, zoneID: $zoneID) {
        data {
          code
          startTime
          endTime
          zone { id }
        }
        total
        per_page
        current_page
        has_more_pages
      }
    }
  }
`

export const GET_REPORT_FIGHTS = `
  query GetReportFights($code: String!) {
    reportData {
      report(code: $code) {
        startTime
        endTime
        zone { id }
        fights {
          id
          startTime
          endTime
          encounterID
          difficulty
          kill
        }
      }
    }
  }
`
