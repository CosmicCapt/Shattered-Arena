// Each player's match, for the results card: kills, deaths, assists, damage to heroes and net worth from
// the game's scoreboard (counted from when the match started, so team select doesn't count), and the pit
// throws the mod counts itself. The card shows what was recorded when the match ended.
import { cast, type Member, members } from './match'

export interface StatRow {
  member: Member
  name: string
  bot: boolean
  team: number
  hero: string | undefined
  scored: boolean // the game's scoreboard could be read for this player
  kills: number
  deaths: number
  assists: number
  damage: number
  netWorth: number
  pitThrows: number
  mvp: boolean
}

interface Start {
  kills: number
  deaths: number
  assists: number
  damage: number
}

const atStart = new Map<Member, Start>() // each player's scoreboard when the match started
const throws = new Map<Member, number>() // pit throws this match
let rows: StatRow[] = []

/** statRows is every player's match, as recorded when it ended. */
export function statRows(): readonly StatRow[] {
  return rows
}

/** statsStart records everyone's scoreboard as the match starts. Call when the match starts. */
export function statsStart(): void {
  atStart.clear()
  throws.clear()
  rows = []
  for (const m of members()) {
    const s = cast.pawn(m.player)?.score
    if (s !== undefined) atStart.set(m, { kills: s.kills, deaths: s.deaths, assists: s.assists, damage: s.heroDamage })
  }
}

/** pitThrow counts a pit throw for the hero credited with it. */
export function pitThrow(by: Member): void {
  throws.set(by, (throws.get(by) ?? 0) + 1)
}

/** statsEnd records everyone's match for the results card and picks the MVP. Call when the match ends. */
export function statsEnd(): void {
  rows = []
  for (const m of members()) {
    if (m.team === undefined || m.hero === undefined) continue // not in the match
    const s = cast.pawn(m.player)?.score
    const from = atStart.get(m) ?? { kills: 0, deaths: 0, assists: 0, damage: 0 }
    rows.push({
      member: m,
      name: m.name,
      bot: m.bot,
      team: m.team,
      hero: m.hero,
      scored: s !== undefined,
      kills: s === undefined ? 0 : Math.max(0, s.kills - from.kills),
      deaths: s === undefined ? 0 : Math.max(0, s.deaths - from.deaths),
      assists: s === undefined ? 0 : Math.max(0, s.assists - from.assists),
      damage: s === undefined ? 0 : Math.max(0, Math.round(s.heroDamage - from.damage)),
      netWorth: s?.netWorth ?? 0,
      pitThrows: throws.get(m) ?? 0,
      mvp: false,
    })
  }
  // The MVP has the most kills and assists, then pit throws, then damage. Nobody is MVP with none of these.
  const rank = (r: StatRow) => [r.kills + r.assists, r.pitThrows, r.damage]
  let best: StatRow | undefined
  for (const r of rows) {
    if (r.kills + r.assists + r.pitThrows === 0) continue
    if (best === undefined || beats(rank(r), rank(best))) best = r
  }
  if (best !== undefined) best.mvp = true
  // Most kills first within each team.
  rows.sort((a, b) => b.kills - a.kills || b.assists - a.assists || a.deaths - b.deaths)
}

function beats(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
