// Bases: heroes heal quickly in their own base (behind its curved wall), and an enemy hero standing in
// it is burned down, so nobody camps the spawn. Heals are written to m_iHealth (a func_regenerate volume
// crashed the server); the burn is a hazard hit that credits no one.
// The map's four Walkers (npc_boss_tier2) guard the base exits and can't be destroyed: they are held
// invulnerable, and onDamage blocks any hit on them as a backstop. They still shoot.
import { damage, type DamageEvent, type DamageResult, findEntities, holdModifierState, log, readField, toast, writeField } from 'modlock'

import { BASE_ENEMY_DAMAGE_PER_SECOND, BASE_HEAL_PER_SECOND } from './config'
import { BASES } from './layout'
import { AMBER, cast, M, members, SAPPHIRE } from './match'

const TICK = 0.5
let next = 0

/** roomOf returns the team whose base a point is in, if any. */
function roomOf(x: number, y: number): number | undefined {
  for (const team of [AMBER, SAPPHIRE]) {
    const b = BASES[team]
    if (Math.hypot(x - b.centre.x, y - b.centre.y) <= b.radius) return team
  }
  return undefined
}

/** baseTick heals and burns. Call every frame during the match. */
export function baseTick(): void {
  if (M.phase !== 'live' || (M.clock < next && M.clock > next - 5)) return
  next = M.clock + TICK
  for (const m of members()) {
    const pawn = cast.pawn(m.player)
    if (pawn === undefined || pawn.health <= 0) continue
    const room = roomOf(pawn.position.x, pawn.position.y)
    if (room === undefined) continue
    const max = pawn.effectiveMaxHealth ?? pawn.maxHealth
    if (room === pawn.team) {
      if (pawn.health >= max) continue
      const health = Math.min(max, Math.ceil(pawn.health + max * BASE_HEAL_PER_SECOND * TICK))
      if (!writeField(pawn.entity, 'CBaseEntity', 'm_iHealth', 'int32', health)) {
        log(`base: could not heal ${m.name} (health now ${String(readField(pawn.entity, 'CBaseEntity', 'm_iHealth', 'int32'))})`)
      }
    } else {
      damage({ victim: pawn.entity, amount: Math.ceil(max * BASE_ENEMY_DAMAGE_PER_SECOND * TICK) })
      if (!m.bot) toast(m.player, 'Enemy base: get out!', 1)
    }
  }
}

// ------------------------------------------------------------------ Walkers
const TOWER_CLASS = 'npc_boss_tier2'
const SCAN_SECONDS = 3

const held = new Set<number>()
let nextScan = 0

/** towersReset forgets the towers when a map loads. */
export function towersReset(): void {
  held.clear()
  nextScan = 0
}

/** towersTick holds every tower invulnerable (they can be replaced, so it looks again now and then). */
export function towersTick(now: number): void {
  if (now < nextScan && now > nextScan - 10) return
  nextScan = now + SCAN_SECONDS
  for (const e of findEntities(TOWER_CLASS)) {
    if (held.has(e)) continue
    holdModifierState(e, 'MODIFIER_STATE_INVULNERABLE', true)
    held.add(e)
  }
}

/** towerDamage blocks every hit on a tower. Call from onDamage. */
export function towerDamage(hit: DamageEvent): DamageResult | void {
  if (held.has(hit.victim)) return { block: true }
}
