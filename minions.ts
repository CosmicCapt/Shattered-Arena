// Minion waves, as in SMITE's Arena: each team's minions spawn behind one of its T2 towers, walk to the
// middle on their own side, then straight up the middle into the enemy portal. Each team alternates
// between its own left and right spawn every wave (Sapphire's left fires with Amber's left, which is the
// other side of the screen).
//   - a wave minion that dies costs its own team MINION_KILL_TICKETS, until that team is down to
//     MINION_TICKET_FLOOR tickets
//   - a minion that reaches the enemy portal (within PORTAL_REACH of its face) is removed and costs the
//     portal's team PORTAL_TICKETS, never its own
//   - minions fight enemy minions. Troopers only fight troopers of their own lane, so every minion is on the
//     map's one lane (its path runs straight down the middle). The game's lane walking can't follow the Y
//     route, so the mod walks each minion along its route itself (MINION_SPAWNS route: bend, meeting point,
//     up the middle, into the enemy portal) with Npc.move, and lets the game's AI have it only while an
//     enemy is within FIGHT_RANGE, so it stops and fights.
//   - Rift minions: each time a team's enemies have died RIFT_KILLS more times, that team gets RIFT_WAVE
//     out of its own portal, straight down the middle to the enemy portal. They copy the game's Rift
//     Troopers (ordinary troopers holding the Unstable Rift's trooper buff, RIFT_BUFF), which the game won't
//     give a mod's trooper: they are made bigger, black and tougher by hand (checkRiftBuff). One that goes into the enemy portal costs RIFT_PORTAL_TICKETS; one that dies
//     costs its team nothing and pays no souls.
//   - The map has no trooper spawn points, so the game sends no troopers of its own. (Don't remove troopers
//     the mod didn't send: comparing them with its own list removed its own minions.)
import { type DamagedEvent, fireInput, log, type Npc, readModifierField, spawnNpc, toast, type Vector, writeField } from 'modlock'

import { FIGHT_HERO_RANGE, FIGHT_RANGE, FIRST_WAVE_SECONDS, MINION_KILL_TICKETS, MINION_SPEED, MINION_TICKET_FLOOR, PORTAL_TICKETS, RIFT_KILLS, RIFT_MINION_COLOR, RIFT_MINION_HEALTH, RIFT_PORTAL_TICKETS, RIFT_SPACING, RIFT_SPAWN_FORWARD, RIFT_WAVE, WAVE, WAVE_SECONDS } from './config'
import { MINION_SPAWNS, PORTAL_REACH, PORTALS, type Side } from './layout'
import { AMBER, cast, M, type Member, memberByPawn, members, patronName, SAPPHIRE, teamName } from './match'
import { minionKilled } from './souls'
import { loseTickets, T } from './tickets'

interface Minion {
  npc: Npc
  team: number
  side: Side
  lane: number
  spawnedAt: number
  route: Vector[] // where it walks, in order
  wp: number // the route point it is walking to
  at: Vector // where the mod has put it (while walking)
  fighting: boolean // an enemy is near: the game's AI has it
  rift: boolean // a rift minion
  buffChecked: boolean // rift minions: whether the game's buff has been looked for
  lastHitBy?: Member // the enemy hero whose hit was the latest, if a hero's was
}

let minions: Minion[] = []
const byEntity = new Map<number, Minion>() // each minion by its entity, for the hits on it
let nextWave: number | undefined
let nextSide: Side = 'left'
let waves = 0
let nextCheck = 0
let lastStep = 0
let riftWaves: Record<number, number> = { [AMBER]: 0, [SAPPHIRE]: 0 } // rift waves each team has been sent

/** The Unstable Rift's trooper buff (Deadlock's scripts/misc.vdata, under citadel_koth_cashin). */
const RIFT_BUFF = 'kothtrooper'
/** The buff's look on the trooper, to precache: the map has no Rift of its own to load it. */
export const RIFT_MINION_EFFECT = 'particles/npc/unstable_rift/unstable_rift_trooper.vpcf'
// The size the buff gives at its first level, for a rift minion the game wouldn't give the buff to.
const RIFT_SCALE = 1.57
const BUFF_WAIT = 0.5 // seconds after a rift minion spawns before looking for the buff

/** minionsStart begins the waves (call when the match starts). */
export function minionsStart(): void {
  stopMinions()
  nextWave = M.clock + FIRST_WAVE_SECONDS
  nextSide = 'left'
}

/** stopMinions stops the waves and takes every minion the mod sent off the map. */
export function stopMinions(): void {
  for (const m of minions) m.npc.remove()
  minions = []
  byEntity.clear()
  nextWave = undefined
  waves = 0
  riftWaves = { [AMBER]: 0, [SAPPHIRE]: 0 }
}

// A row of rift minions across the front of the team's own portal, facing the enemy portal.
function sendRiftWave(team: number): void {
  const enemy = team === AMBER ? SAPPHIRE : AMBER
  const from = PORTALS[team]
  const to = PORTALS[enemy]
  const toward = Math.sign(to.y - from.y) // the way down the middle, along y
  const yaw = toward > 0 ? 90 : 270
  // The same end point as the wave minions' routes: just past the enemy portal's face.
  const route: Vector[] = [{ x: to.x, y: to.y + toward * 30, z: to.z }]
  let made = 0
  RIFT_WAVE.forEach((unit, i) => {
    const position = { x: from.x + (i - (RIFT_WAVE.length - 1) / 2) * RIFT_SPACING, y: from.y + toward * RIFT_SPAWN_FORWARD, z: from.z }
    const npc = spawnNpc({
      className: 'npc_trooper', unit, team, position, lane: MINION_SPAWNS[team].left.lane,
      facing: { pitch: 0, yaw, roll: 0 },
      fields: [{ className: 'CBaseEntity', field: 'm_iInitialTeamNum', type: 'int32', value: team }],
    })
    if (npc === undefined) { log(`rift minions: FAILED to spawn ${unit} (${teamName(team)})`); return }
    made++
    const minion: Minion = { npc, team, side: 'left', lane: MINION_SPAWNS[team].left.lane, spawnedAt: M.clock, route, wp: 0, at: position, fighting: false, rift: true, buffChecked: false }
    minions.push(minion)
    byEntity.set(npc.entity, minion)
  })
  log(`rift minions: ${made} sent for ${teamName(team)} (wave ${riftWaves[team]}, ${T.heroKills[team]} kills)`)
  for (const m of members()) if (!m.bot) toast(m.player, `${patronName(team)}'s Rift Minions are coming through the portal!`, 4)
}

// The first look at a rift minion, BUFF_WAIT after it spawned: it gets RIFT_MINION_HEALTH either way, and
// if the game didn't give it the Rift's buff it is made big and black by hand (its damage stays a normal
// trooper's). readModifierField gives no value while the unit lacks the modifier; the class and field are
// only there to ask.
function checkRiftBuff(m: Minion, health: number): void {
  m.buffChecked = true
  const e = m.npc.entity
  const held = readModifierField(e, RIFT_BUFF, 'CCitadel_Modifier_OrbitCamera', 'm_nCameraLevel', 'int32') !== undefined
  const tough = writeField(e, 'CBaseEntity', 'm_iMaxHealth', 'int32', RIFT_MINION_HEALTH) && writeField(e, 'CBaseEntity', 'm_iHealth', 'int32', RIFT_MINION_HEALTH)
  if (held) { log(`rift minions: buff held; health ${health} -> ${RIFT_MINION_HEALTH} ${tough}`); return }
  const scaled = fireInput(e, 'SetScale', { number: RIFT_SCALE })
  const tinted = fireInput(e, 'Color', { color: RIFT_MINION_COLOR })
  log(`rift minions: no buff; by hand: scale ${scaled}, tint ${tinted}, health ${health} -> ${RIFT_MINION_HEALTH} ${tough}`)
}


function sendWave(side: Side): void {
  waves++
  let made = 0
  for (const team of [AMBER, SAPPHIRE]) {
    const spawn = MINION_SPAWNS[team][side]
    const rad = (spawn.facing * Math.PI) / 180
    // A small block of minions behind the spawn point: rows of 3 across the way they walk.
    WAVE.forEach((unit, i) => {
      const row = Math.floor(i / 3)
      const col = (i % 3) - 1
      const back = row * 90 // rows ahead of the spawn point (behind it is the wall)
      const across = col * 80
      const position = {
        x: spawn.at.x + Math.cos(rad) * back - Math.sin(rad) * across,
        y: spawn.at.y + Math.sin(rad) * back + Math.cos(rad) * across,
        z: spawn.at.z,
      }
      const npc = spawnNpc({
        className: 'npc_trooper', unit, team, position, lane: spawn.lane,
        facing: { pitch: 0, yaw: spawn.facing, roll: 0 },
        fields: [{ className: 'CBaseEntity', field: 'm_iInitialTeamNum', type: 'int32', value: team }],
      })
      if (npc === undefined) log(`wave ${waves}: FAILED to spawn ${unit} (${teamName(team)} ${side}, lane ${spawn.lane})`)
      else {
        made++
        const minion: Minion = { npc, team, side, lane: spawn.lane, spawnedAt: M.clock, route: spawn.route, wp: 0, at: { x: position.x, y: position.y, z: position.z }, fighting: false, rift: false, buffChecked: true }
        minions.push(minion)
        byEntity.set(npc.entity, minion)
      }
    })
  }
  if (waves <= 4 || waves % 10 === 0) log(`wave ${waves} (${side}): ${made} minions sent`)
}

/**
 * minionDamaged remembers whether each minion's latest hit came from an enemy hero, so its souls go to
 * that hero's team when it dies. Call from onDamaged.
 */
export function minionDamaged(hit: DamagedEvent): void {
  if (M.phase !== 'live') return
  const m = byEntity.get(hit.victim)
  if (m === undefined) return
  const by = memberByPawn(hit.attacker)
  m.lastHitBy = by !== undefined && cast.pawn(by.player)?.team !== m.team ? by : undefined
}

/** minionTick sends waves and counts deaths and portal entries. Call every frame during the match. */
export function minionTick(): void {
  if (M.phase !== 'live' || nextWave === undefined) return
  if (M.clock >= nextWave) {
    nextWave = M.clock + WAVE_SECONDS
    sendWave(nextSide)
    nextSide = nextSide === 'left' ? 'right' : 'left'
  }
  for (const team of [AMBER, SAPPHIRE]) {
    if (T.heroKills[team] >= (riftWaves[team] + 1) * RIFT_KILLS) {
      riftWaves[team]++
      sendRiftWave(team)
    }
  }
  steer()
  if (M.clock < nextCheck) return
  nextCheck = M.clock + 0.2
  const still: Minion[] = []
  const where: Vector[] = [] // where each minion in still is, from this one read
  for (const m of minions) {
    const s = m.npc.read()
    if (s === undefined || s.health <= 0) {
      byEntity.delete(m.npc.entity)
      if (m.rift) continue // rift minions cost their team nothing and pay no souls
      minionKilled(m.lastHitBy) // a dead minion can be gone already; the mod's own removals never get here
      // Near the end, minion deaths stop counting: only hero deaths and the portal can finish a team.
      if (T.tickets[m.team] > MINION_TICKET_FLOOR) loseTickets(m.team, MINION_KILL_TICKETS, `${teamName(m.team)} minion died`)
      continue
    }
    const enemy = m.team === AMBER ? SAPPHIRE : AMBER
    const portal = PORTALS[enemy]
    if (Math.hypot(s.position.x - portal.x, s.position.y - portal.y) <= PORTAL_REACH) {
      byEntity.delete(m.npc.entity)
      m.npc.remove()
      loseTickets(enemy, m.rift ? RIFT_PORTAL_TICKETS : PORTAL_TICKETS, `${teamName(m.team)} ${m.rift ? 'rift minion' : 'minion'} went into the portal`)
      continue
    }
    if (!m.buffChecked && M.clock - m.spawnedAt >= BUFF_WAIT) checkRiftBuff(m, s.health)
    still.push(m)
    where.push(s.position)
  }
  minions = still
  checkFights(where)
}

// Each frame: every minion that isn't fighting walks MINION_SPEED towards its next route point. Its place
// is the mod's own (m.at), so the game's AI can't turn it around.
function steer(): void {
  const dt = Math.min(0.1, Math.max(0, M.clock - lastStep))
  lastStep = M.clock
  if (dt === 0) return
  for (const m of minions) {
    if (m.fighting || m.wp >= m.route.length) continue
    const to = m.route[m.wp]
    const dx = to.x - m.at.x
    const dy = to.y - m.at.y
    const d = Math.hypot(dx, dy)
    const step = MINION_SPEED * dt
    if (d <= step) {
      m.at = { x: to.x, y: to.y, z: to.z }
      m.wp++
      continue
    }
    const ux = dx / d
    const uy = dy / d
    m.at = { x: m.at.x + ux * step, y: m.at.y + uy * step, z: to.z }
    m.npc.move(m.at, { pitch: 0, yaw: (Math.atan2(uy, ux) * 180) / Math.PI, roll: 0 }, { x: ux * MINION_SPEED, y: uy * MINION_SPEED, z: 0 })
  }
}

// Five times a second: a minion with an enemy minion within FIGHT_RANGE, or an enemy hero within
// FIGHT_HERO_RANGE, is left to the game's AI so it stops and fights. When the fight is over it walks on
// from wherever the fight left it. where[i] is where minions[i] is (minionTick has just read them all).
function checkFights(where: Vector[]): void {
  // Everything each team could fight, by the team it is on: minions and living heroes.
  const minionsOf: Record<number, Vector[]> = { [AMBER]: [], [SAPPHIRE]: [] }
  const heroesOf: Record<number, Vector[]> = { [AMBER]: [], [SAPPHIRE]: [] }
  minions.forEach((m, i) => minionsOf[m.team]?.push(where[i]))
  for (const mem of members()) {
    const pawn = cast.pawn(mem.player)
    if (pawn !== undefined && pawn.health > 0) heroesOf[pawn.team]?.push(pawn.position)
  }
  for (let i = 0; i < minions.length; i++) {
    const m = minions[i]
    const p = where[i]
    const other = m.team === AMBER ? SAPPHIRE : AMBER
    let enemy = false
    for (const q of minionsOf[other]) {
      if (Math.hypot(q.x - p.x, q.y - p.y) <= FIGHT_RANGE) { enemy = true; break }
    }
    if (!enemy) for (const h of heroesOf[other]) {
      if (Math.hypot(h.x - p.x, h.y - p.y) <= FIGHT_HERO_RANGE) { enemy = true; break }
    }
    if (!enemy && m.fighting) {
      // Walk on from here, to the first route point that isn't behind it.
      m.at = { x: p.x, y: p.y, z: m.route[Math.min(m.wp, m.route.length - 1)].z }
      while (m.wp + 1 < m.route.length && behind(m.at, m.route[m.wp], m.route[m.wp + 1])) m.wp++
    }
    m.fighting = enemy
  }
}

// Whether route point a is already passed: going from p to a would move away from b.
function behind(p: Vector, a: Vector, b: Vector): boolean {
  return (a.x - p.x) * (b.x - a.x) + (a.y - p.y) * (b.y - a.y) < 0 && Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(b.x - a.x, b.y - a.y)
}
