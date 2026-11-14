// Heavy melee knockback: a hero hit by an enemy hero's heavy melee is pushed the way the attacker faces, which
// makes shoving people into the pits part of every fight. Light melee doesn't push, and a hero who is
// parrying is not pushed. The hit also empties the victim's stamina (HEAVY_DRAINS_STAMINA).
//
// Light and heavy melee are one ability in Deadlock (citadel_ability_hold_melee, seen in the log), and
// their damage overlaps, so neither the ability nor the damage tells them apart. A heavy melee is the
// melee key held, so the key is watched: once a hero has held it HEAVY_HOLD seconds,
// their melee hits for the next HEAVY_WINDOW seconds are heavy. Bots' keys are read with buttons().
// The push is applied on the next frame (not inside the damage handler), with Player.setVelocity.
import { Buttons, type DamageEvent, entityClass, modifierState, type Player, watchInput } from 'modlock'

import { HEAVY_DRAINS_STAMINA, HEAVY_HOLD, HEAVY_WINDOW, KNOCKBACK_SPEED, KNOCKBACK_UP } from './config'
import { cast, M, memberByPawn, members } from './match'

const PARRY = 'MODIFIER_STATE_PARRY_ACTIVE'
const queued: { victim: number; attacker: number }[] = []
const pressedAt = new Map<number, number>() // player slot -> when the melee key went down
const heavyUntil = new Map<number, number>() // player slot -> melee hits until then are heavy
let watching = false
let nextBotPoll = 0
const meleeCache = new Map<number, boolean>() // ability entity -> is it melee

function isMelee(ability: number): boolean {
  if (ability === 0) return false
  const known = meleeCache.get(ability)
  if (known !== undefined) return known
  const c = entityClass(ability)
  const names = `${c?.designerName ?? ''} ${c?.className ?? ''}`.toLowerCase()
  const melee = names.includes('melee') && !names.includes('parry')
  meleeCache.set(ability, melee)
  return melee
}

/** knockbackWatch starts watching the melee key (call once, at start). */
export function knockbackWatch(): void {
  if (!watching) watching = watchInput(Buttons.melee)
}

/** knockbackInput notes melee key presses and releases. Call from onInput. */
export function knockbackInput(player: Player, pressed: bigint, released: bigint): void {
  if ((pressed & Buttons.melee) !== 0n) {
    pressedAt.set(player.slot, M.clock)
    heavyUntil.delete(player.slot) // a new swing: light unless this press is held too
  }
  if ((released & Buttons.melee) !== 0n) {
    holdCheck(player.slot)
    pressedAt.delete(player.slot)
  }
}

// A key held HEAVY_HOLD seconds makes this hero's melee heavy for the next HEAVY_WINDOW seconds.
function holdCheck(slot: number): void {
  const at = pressedAt.get(slot)
  if (at !== undefined && M.clock - at >= HEAVY_HOLD) heavyUntil.set(slot, M.clock + HEAVY_WINDOW)
}

/** isHeavy reports whether this player's melee is a heavy melee now. */
function isHeavy(slot: number): boolean {
  holdCheck(slot)
  return (heavyUntil.get(slot) ?? -1) >= M.clock
}

/** knockbackDamage looks at each hit before it lands and queues a push for an unparried heavy melee hit. Call from onDamage. */
export function knockbackDamage(hit: DamageEvent): void {
  if ((M.phase !== 'live' && M.phase !== 'bonus') || hit.attacker === 0 || hit.attacker === hit.victim) return
  const victim = memberByPawn(hit.victim)
  const attacker = memberByPawn(hit.attacker)
  if (victim === undefined || attacker === undefined) return
  if (cast.pawn(victim.player)?.team === cast.pawn(attacker.player)?.team) return
  if (!isMelee(hit.ability)) return
  if (!isHeavy(attacker.player.slot) || modifierState(hit.victim, PARRY)) return
  queued.push({ victim: hit.victim, attacker: hit.attacker })
}

/** knockbackTick reads bots' melee keys and pushes the heroes queued last frame. Call every frame. */
export function knockbackTick(): void {
  if (M.clock >= nextBotPoll) {
    // Bots: bots may not report input, so read the keys they hold.
    nextBotPoll = M.clock + 0.1
    for (const m of members()) {
      if (!m.bot) continue
      const held = ((m.player.buttons() ?? 0n) & Buttons.melee) !== 0n
      const slot = m.player.slot
      if (held && !pressedAt.has(slot)) {
        pressedAt.set(slot, M.clock)
        heavyUntil.delete(slot)
      }
      else if (!held && pressedAt.has(slot)) {
        holdCheck(slot)
        pressedAt.delete(slot)
      }
    }
  }
  if (queued.length === 0) return
  const done = new Set<number>()
  for (const q of queued.splice(0)) {
    if (done.has(q.victim)) continue // one push per hero per frame (a melee can report several hits)
    done.add(q.victim)
    const v = memberByPawn(q.victim)
    const a = memberByPawn(q.attacker)
    const vp = v === undefined ? undefined : cast.pawn(v.player)
    const ap = a === undefined ? undefined : cast.pawn(a.player)
    if (vp === undefined || ap === undefined || vp.health <= 0) continue
    // The way the attacker faces (their aim, flattened), so a heavy melee sends the victim where you look.
    const yaw = (ap.eyeAngles.yaw * Math.PI) / 180
    const dx = Math.cos(yaw)
    const dy = Math.sin(yaw)
    // setVelocity replaces the hero's motion (adding to it looked like a dash). The lift knocks them off
    // the ground so the push carries.
    // The host's setting scales the push along the ground; the lift stays, so the throw's length follows it.
    const speed = (KNOCKBACK_SPEED * M.knockback) / 100
    if (speed > 0) v!.player.setVelocity({ x: dx * speed, y: dy * speed, z: KNOCKBACK_UP })
    // No stamina left to dash or wall jump out of the push (the game refills it as usual).
    if (HEAVY_DRAINS_STAMINA) v!.player.setStamina(0)
  }
}

/** knockbackReset forgets everything when a map loads. */
export function knockbackReset(): void {
  queued.length = 0
  meleeCache.clear()
  pressedAt.clear()
  heavyUntil.clear()
}
