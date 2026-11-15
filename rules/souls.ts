// Shared souls: minion and hero kills pay every player on the killing team the same, wherever they are,
// at M.soulScale of the normal amount (SOUL_SCALE unless the host changed it on team select).
//
//   - Minions: the game's own minion souls are off (no orbs, no splitting). A minion whose last hit came
//     from an enemy hero pays every player on that hero's team (MINION_SOULS + MINION_SOULS_PER_MINUTE for
//     each whole minute since the match started) x M.soulScale. Minions killed by minions or towers pay
//     nothing.
//   - Hero kills (pit kills too): the game pays the kill as usual, so streak and comeback bonuses count.
//     The kill was shared by the enemy heroes who hit the victim in the last ASSIST_SECONDS (the game's
//     own rule). The mod watches what the killer earns for KILL_WATCH_SECONDS, works out from the
//     game's sharing table what the kill pays a solo killer, and leaves every player on the team with
//     that x M.soulScale: it tops up those below and quietly takes back from those above.
//   - Camps keep the game's rules.

import { type DamagedEvent, log, serverCommand } from 'modlock'
import { ASSIST_SECONDS, KILL_WATCH_SECONDS, MINION_SOULS, MINION_SOULS_PER_MINUTE } from '../config'
import { AMBER, cast, M, type Member, memberByPawn, members, SAPPHIRE, teamName } from '../match/match'

// The killer's part of a hero kill's base bounty by how many heroes shared it (deadlock.wiki/Assist,
// November 2026): alone 125%, with one helper 79.06%, and so on.
const KILLER_SHARE = [1.25, 0.7906, 0.4447, 0.2962, 0.1952, 0.1522]

let startedAt = 0 // M.clock when the match started

/** soulsStart turns the game's own minion souls off. Call when the match starts. */
export function soulsStart(): void {
  serverCommand('citadel_minion_gold_reward 0')
  serverCommand('citadel_minion_gold_reward_bonus_per_minute 0')
  watches.clear()
  paid.clear()
  hitsOn.clear()
  startedAt = M.clock
}

// ------------------------------------------------------------ paying a team

/** teamOf is the team a member's hero is on in the game, if it has one. */
function teamOf(m: Member): number | undefined {
  const team = cast.pawn(m.player)?.team
  return team === AMBER || team === SAPPHIRE ? team : undefined
}

// Every soul the mod has given (or taken from) each player, so a kill's watch can leave them out.
const paid = new Map<Member, number>()

/** give gives a player souls with the usual pop-up, or quietly takes them when n is negative. */
function give(m: Member, n: number): boolean {
  if (n === 0) return true
  const ok = m.player.adjustSouls(n, n < 0)
  if (ok) paid.set(m, (paid.get(m) ?? 0) + n)
  return ok
}

/** pay gives every player (bots too) on a team the same souls. */
function pay(team: number, souls: number, why: string): void {
  const n = Math.round(souls)
  if (n <= 0) return
  for (const m of members()) if (teamOf(m) === team) give(m, n)
  log(`souls: ${teamName(team)} +${n} each (${why})`)
}

// ------------------------------------------------------------ minions

/** minionKilled pays a minion's souls to the team of the hero who landed its last hit. */
export function minionKilled(by: Member | undefined): void {
  if (by === undefined || M.phase !== 'live') return
  const team = teamOf(by)
  if (team === undefined) return
  const minutes = Math.floor(Math.max(0, M.clock - startedAt) / 60)
  pay(team, (MINION_SOULS + MINION_SOULS_PER_MINUTE * minutes) * M.soulScale, `${by.name} killed a minion`)
}

// ------------------------------------------------------------ hero kills

// Enemy heroes' latest hit on each hero, for who shared a kill.
const hitsOn = new Map<Member, Map<Member, number>>()

/** soulsDamaged remembers enemy heroes' hits on heroes. Call from onDamaged. */
export function soulsDamaged(hit: DamagedEvent): void {
  if (M.phase !== 'live' || hit.attacker === 0 || hit.attacker === hit.victim) return
  const victim = memberByPawn(hit.victim)
  const attacker = victim === undefined ? undefined : memberByPawn(hit.attacker)
  if (victim === undefined || attacker === undefined || teamOf(attacker) === teamOf(victim)) return
  let hits = hitsOn.get(victim)
  if (hits === undefined) hitsOn.set(victim, (hits = new Map()))
  hits.set(attacker, M.clock)
}

interface Watch {
  until: number
  killer: Member // the latest enemy hit on the victim
  sharers: Set<Member> // enemy heroes who hit the victim in the last ASSIST_SECONDS
  before: Map<Member, number> // each player's earned souls the frame before the kill
  paidBefore: Map<Member, number> // and what the mod had given them by then
}

const watches = new Map<number, Watch>() // by the killing team
let lastWorth = new Map<Member, number>() // every player's earned souls last frame

function worth(m: Member): number | undefined {
  return cast.pawn(m.player)?.score?.netWorth
}

/** heroKilled starts watching what a dead hero's killers earn. Call when a hero dies. */
export function heroKilled(victim: Member, team: number): void {
  const hits = hitsOn.get(victim)
  hitsOn.delete(victim)
  if (M.phase !== 'live' || hits === undefined) return
  const killers = team === AMBER ? SAPPHIRE : AMBER
  let killer: Member | undefined
  let latest = -Infinity
  const sharers = new Set<Member>()
  for (const [m, at] of hits) {
    if (M.clock - at > ASSIST_SECONDS || teamOf(m) !== killers) continue
    sharers.add(m)
    if (at > latest) [killer, latest] = [m, at]
  }
  if (killer === undefined) return // no enemy hero hit them lately: a death to minions, a tower or a fall
  const open = watches.get(killers)
  if (open !== undefined) {
    // Two kills close together are settled as one, from the later killer's earnings.
    open.until = M.clock + KILL_WATCH_SECONDS
    open.killer = killer
    for (const m of sharers) open.sharers.add(m)
    return
  }
  const before = new Map<Member, number>()
  const paidBefore = new Map<Member, number>()
  for (const m of members()) {
    if (teamOf(m) !== killers) continue
    const w = lastWorth.get(m) ?? worth(m)
    if (w === undefined) continue
    before.set(m, w)
    paidBefore.set(m, paid.get(m) ?? 0)
  }
  watches.set(killers, { until: M.clock + KILL_WATCH_SECONDS, killer, sharers, before, paidBefore })
}

/** soulsTick records earned souls and settles kills whose watch has ended. Call every frame. */
export function soulsTick(): void {
  if (M.phase !== 'live') return
  for (const [team, w] of watches) {
    if (M.clock < w.until) continue
    watches.delete(team)
    settle(team, w)
  }
  const now = new Map<Member, number>()
  for (const m of members()) {
    const v = worth(m)
    if (v !== undefined) now.set(m, v)
  }
  lastWorth = now
}

/** gain is what a player earned during a watch, the mod's own payments left out. */
function gain(m: Member, w: Watch): number | undefined {
  const v = worth(m)
  const before = w.before.get(m)
  if (v === undefined || before === undefined) return undefined
  return v - before - ((paid.get(m) ?? 0) - (w.paidBefore.get(m) ?? 0))
}

function settle(team: number, w: Watch): void {
  const killerGain = gain(w.killer, w)
  if (killerGain === undefined || killerGain <= 0) return
  const share = KILLER_SHARE[Math.min(w.sharers.size, KILLER_SHARE.length) - 1]
  const solo = (killerGain / share) * KILLER_SHARE[0]
  const target = Math.round(solo * M.soulScale)
  let changed = 0
  for (const m of w.before.keys()) {
    const g = gain(m, w)
    if (g === undefined || teamOf(m) !== team) continue
    const change = target - Math.round(g)
    if (change !== 0 && give(m, change)) changed++
  }
  log(
    `souls: ${teamName(team)} kill by ${w.killer.name} (${w.sharers.size} shared, killer earned ${killerGain}): ` +
      `${Math.round(solo)} alone, everyone left with ${target}; ${changed} adjusted`,
  )
}
