// Tickets, as in SMITE's Arena: both teams start with the same tickets (START_TICKETS, or what the host
// set on team select) and the first at 0 loses.
//   - a hero dies (killed, or fallen into a pit): their team loses HERO_KILL_TICKETS
//   - a minion dies: its team loses MINION_KILL_TICKETS (minions.ts reports it)
//   - a minion walks into the enemy portal: the enemy loses PORTAL_TICKETS (minions.ts reports it)
//
// Pits: a hero who falls below PIT_KILL_Z is killed. The kill goes to the last enemy hero who hit them
// within PIT_CREDIT_SECONDS (so a shove into a pit is that hero's kill, with its souls); with nobody to
// credit it is a death to the pit. Either way it costs the same tickets as any death.
import { type DamagedEvent, killEntity, log } from 'modlock'

import { HERO_KILL_TICKETS, PIT_CREDIT_SECONDS, START_TICKETS } from '../config'
import { PIT_KILL_Z } from '../arena/layout'
import { heroKilled } from './souls'
import { pitThrow } from '../match/stats'
import { AMBER, cast, endMatch, M, type Member, memberByPawn, members, SAPPHIRE, teamName } from '../match/match'

export const T = {
  tickets: { [AMBER]: START_TICKETS, [SAPPHIRE]: START_TICKETS } as Record<number, number>,
  pitKills: { [AMBER]: 0, [SAPPHIRE]: 0 } as Record<number, number>, // by the team that got the kill (or fell, for -1)
  heroKills: { [AMBER]: 0, [SAPPHIRE]: 0 } as Record<number, number>,
}

interface HeroState {
  entity: number
  alive: boolean
  lastHitBy: Member | undefined
  lastHitAt: number
  pitKilledAt: number // when the mod killed it for falling, so the death reads as a pit death
}
const heroState = new Map<number, HeroState>() // by player slot

/** ticketsReset starts a match: full tickets, nothing recorded. */
export function ticketsReset(): void {
  T.tickets = { [AMBER]: M.startTickets, [SAPPHIRE]: M.startTickets }
  T.pitKills = { [AMBER]: 0, [SAPPHIRE]: 0 }
  T.heroKills = { [AMBER]: 0, [SAPPHIRE]: 0 }
  heroState.clear()
}

// Deaths go to the log only: players see them in the game's own kill feed.
function feed(text: string): void {
  log(`feed: ${text}`)
}

/** loseTickets takes tickets from a team and ends the match when it runs out. */
export function loseTickets(team: number, n: number, why: string): void {
  if (M.phase !== 'live' || (team !== AMBER && team !== SAPPHIRE)) return
  T.tickets[team] = Math.max(0, T.tickets[team] - n)
  log(`tickets: ${teamName(team)} -${n} (${why}) -> ${T.tickets[AMBER]} / ${T.tickets[SAPPHIRE]}`)
  if (T.tickets[team] === 0) endMatch(team === AMBER ? SAPPHIRE : AMBER)
}

/** ticketsDamaged records who last hit each hero, for pit kill credit. Call from onDamaged. */
export function ticketsDamaged(hit: DamagedEvent): void {
  if (M.phase !== 'live' || hit.attacker === 0 || hit.attacker === hit.victim) return
  const victim = memberByPawn(hit.victim)
  if (victim === undefined) return
  const attacker = memberByPawn(hit.attacker)
  const victimTeam = cast.pawn(victim.player)?.team
  if (attacker === undefined || cast.pawn(attacker.player)?.team === victimTeam) return
  const s = state(victim)
  if (s === undefined) return
  s.lastHitBy = attacker
  s.lastHitAt = M.clock
}

function state(m: Member): HeroState | undefined {
  const pawn = cast.pawn(m.player)
  if (pawn === undefined) return undefined
  let s = heroState.get(m.player.slot)
  if (s === undefined || s.entity !== pawn.entity) {
    s = { entity: pawn.entity, alive: pawn.health > 0, lastHitBy: s?.lastHitBy, lastHitAt: s?.lastHitAt ?? -99, pitKilledAt: -99 }
    heroState.set(m.player.slot, s)
  }
  return s
}

/** ticketsTick finds hero deaths and pit falls. Call every frame during the match. */
export function ticketsTick(): void {
  if (M.phase !== 'live') return
  for (const m of members()) {
    // Every hero on a team counts, whether or not seating finished for it.
    const pawn = cast.pawn(m.player)
    if (pawn === undefined || (pawn.team !== AMBER && pawn.team !== SAPPHIRE)) continue
    const team = pawn.team
    const s = state(m)
    if (s === undefined) continue
    const alive = pawn.health > 0

    // Fell into a pit: kill them, crediting whoever last hit them.
    if (alive && pawn.position.z < PIT_KILL_Z && M.clock - s.pitKilledAt > 2) {
      s.pitKilledAt = M.clock
      const by = s.lastHitBy !== undefined && M.clock - s.lastHitAt <= PIT_CREDIT_SECONDS ? s.lastHitBy : undefined
      const byPawn = by === undefined ? undefined : cast.pawn(by.player)
      const ok = killEntity({ victim: pawn.entity, attacker: byPawn?.entity })
      if (!ok) m.player.kill()
      if (by !== undefined) {
        T.pitKills[team === AMBER ? SAPPHIRE : AMBER]++
        pitThrow(by)
        feed(`${by.name} threw ${m.name} into the pit`)
      } else {
        feed(`${m.name} fell into the pit`)
      }
    }

    // A death, whatever caused it, costs the team tickets.
    if (s.alive && !alive) {
      T.heroKills[team === AMBER ? SAPPHIRE : AMBER]++
      if (M.clock - s.pitKilledAt > 2) {
        const by = s.lastHitBy !== undefined && M.clock - s.lastHitAt <= 3 ? s.lastHitBy : undefined
        feed(by === undefined ? `${m.name} died` : `${by.name} killed ${m.name}`)
      }
      s.lastHitBy = undefined
      heroKilled(m, team) // share the kill's souls with the whole other team
      loseTickets(team, HERO_KILL_TICKETS, `${m.name} died`)
    }
    s.alive = alive
  }
}
