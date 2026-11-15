// Jungle camps and their bridge buffs.
//   - Every camp spawns when the match starts (none in team select).
//   - A camp killed to the last unit drops its bridge buff where it stood: blue camps the casting buff, red
//     the gun buff, purple the movement buff. Each camp has a game pickup spawner (citadel_pickup_spawner) set
//     to its buff, made during team select; its SpawnPickup input drops the real bridge buff
//     (citadel_pickup_modifier), which heavy melee takes, with the buff's real values. The map says which buff
//     a camp drops (its ring and lettering); a floating label was tried and never showed.
//     (What else was tried is in MODLOCK_NOTES.md under "Bridge buffs".)
//   - A taken pickup stays in the world, inactive, so the buff counts as taken when the pickup goes inactive
//     or is gone, or a hero next to it now holds the buff. The camp comes back CAMP_RESPAWN seconds later.
//   - A camp is cleared when the units it spawned are dead, wherever they are: a camp pushed away from its
//     spot isn't cleared (counting units near the spot made pushed camps vanish).
// The game would spawn camps on its own 2-minute cycle, so each camp is kept
// disabled (its SetDisabled input) except when this module spawns it (SpawnNeutrals), and units that show
// up early are removed. The camp's kind is in its map name, arena_camp_<kind>_<n>.
import { createEntity, entityClass, entityName, entityPosition, findEntities, fireInput, log, readField, readModifierField, serverCommand, type Vector, writeField } from 'modlock'

import { CAMP_RESPAWN } from '../config'
import { cast, M, members } from '../match/match'

type Kind = 'blue' | 'red' | 'purple'
const MODIFIER: Record<Kind, string> = { blue: 'modifier_citadel_powerup_casting', red: 'modifier_citadel_powerup_gun', purple: 'modifier_citadel_powerup_movement' }
const BUFF_TITLE: Record<Kind, string> = { blue: 'casting', red: 'gun', purple: 'movement' }
/** The game's bridge buff pickups (Deadlock's scripts/misc.vdata), class citadel_pickup_modifier. */
const PICKUP: Record<Kind, string> = { blue: 'casting_powerup_pickup', red: 'gun_powerup_pickup', purple: 'movement_powerup_pickup' }
const PICKUP_CLASS = 'citadel_pickup_modifier'
/**
 * Bridge buff assets (from Deadlock's scripts/misc.vdata), precached at start: one loaded mid-match
 * asserts and freezes the game.
 */
const TOMES = ['spirit', 'damage', 'weapon', 'health', 'cooldown', 'battle', 'armor', 'spiritresist', 'spiritrange', 'movespeed']
export const BUFF_MODELS = [
  ...TOMES.map((t) => `models/props_gameplay/powerup_tomes/powerup_${t}_tome.vmdl`),
  'models/npc/sewer_beast/sewer.vmdl',
  'models/null.vmdl',
]
/** Keep every one of these: a dropped pickup uses powerup_spawner_buff.vpcf, and a missing one asserts in game. */
export const BUFF_PARTICLES = [
  'particles/generic/bridge_buff.vpcf',
  'particles/generic/powerup_spawner_gained.vpcf',
  'particles/environment/powerup_spawner_buff.vpcf',
  'particles/environment/powerup_spawner_ambient.vpcf',
  'particles/environment/powerup_spawner_inactive_ambient.vpcf',
  'particles/environment/powerup_spawner_ambient_damaged.vpcf',
  'particles/environment/powerup_spawner_ambient_simple.vpcf',
]
const UNIT_CLASS = 'npc_trooper_neutral'
const SPAWN_RADIUS = 600 // units that appear within this of a camp when it spawns are its units
const TICK = 0.25

type State = 'waiting' | 'up' | 'buff'
interface Camp {
  entity: number
  name: string
  kind: Kind
  at: Vector
  state: State
  dueAt: number // waiting: spawn at this time
  askedAt: number | undefined
  asks: number
  disabled: boolean | undefined
  units: Set<number> // up: the units this camp spawned
  pickup: number | undefined // the game's bridge buff pickup lying there
  spawner: number | undefined // the game's bridge buff spawner at this camp (hidden)
  dropWaitUntil: number // waiting for the spawner's drop until then (0: not waiting)
  knownPickups: Set<number> // pickups that were there before the drop
  holdersAtDrop: Set<number> // player slots already holding this camp's buff when it dropped
  spawnTries: number // SpawnPickup asks for this drop
}

let camps: Camp[] = []
let live = false
let nextTick = 0
let markersMade = 0 // how many camps have their pickup spawner (made one per tick)
let nextMarker = 0

function kindOf(name: string): Kind | undefined {
  const m = /^arena_camp_(blue|red|purple)_/.exec(name)
  return m === null ? undefined : (m[1] as Kind)
}

function setDisabled(c: Camp, disabled: boolean): void {
  if (c.disabled === disabled) return
  c.disabled = disabled
  fireInput(c.entity, 'SetDisabled', { boolean: disabled })
}

function alive(e: number): boolean {
  const hp = readField(e, 'CBaseEntity', 'm_iHealth', 'int32')
  return typeof hp === 'number' ? hp > 0 : entityPosition(e) !== undefined
}

// Every camp unit on the map and where it is, read from the game once a tick and shared by all the camps.
// A unit's health is read the first time a camp needs it.
interface Unit { entity: number; at: Vector; alive: boolean | undefined }
let scan: Unit[] | undefined // this tick's units; undefined until a camp asks

function campUnits(): Unit[] {
  if (scan !== undefined) return scan
  scan = []
  for (const entity of findEntities(UNIT_CLASS)) {
    const at = entityPosition(entity)?.position
    if (at !== undefined) scan.push({ entity, at, alive: undefined })
  }
  return scan
}

/** Live camp units near the camp's spot. */
function unitsNear(c: Camp): number[] {
  const near: number[] = []
  for (const u of campUnits()) {
    if (Math.hypot(u.at.x - c.at.x, u.at.y - c.at.y) > SPAWN_RADIUS) continue
    if (u.alive === undefined) u.alive = alive(u.entity)
    if (u.alive) near.push(u.entity)
  }
  return near
}

function findCamps(): Camp[] {
  const out: Camp[] = []
  for (const entity of findEntities('info_neutral_trooper_camp')) {
    const name = entityName(entity) ?? String(readField(entity, 'CInfoTrooperNeutralCamp', 'm_iszCampName', 'string') ?? '')
    const kind = kindOf(name)
    const at = entityPosition(entity)?.position
    if (kind === undefined || at === undefined) continue
    out.push({ entity, name, kind, at, state: 'waiting', dueAt: Infinity, askedAt: undefined, asks: 0, disabled: undefined, units: new Set(), pickup: undefined, spawner: undefined, dropWaitUntil: 0, knownPickups: new Set(), holdersAtDrop: new Set(), spawnTries: 0 })
  }
  return out
}

/** campsHold keeps every camp empty and disabled (team select). Call when a map is ready. */
export function campsHold(): void {
  live = false
  // Bridge buffs may be switched off on a custom map: neither a spawner's drop nor a directly made pickup
  // worked without this.
  serverCommand('citadel_powerup_spawn_enabled true')
  serverCommand('citadel_pickup_spawner_enabled true')
  camps = findCamps()
  markersMade = 0
  nextMarker = 0
  for (const c of camps) {
    setDisabled(c, true)
    fireInput(c.entity, 'RemoveNeutrals')
  }
  log(`camps: ${camps.length} camps held until the match starts`)
}

/** campsStart spawns every camp (the match has started). */
export function campsStart(): void {
  if (camps.length === 0) camps = findCamps()
  live = true
  nextTick = 0
  for (const c of camps) {
    c.state = 'waiting'
    c.dueAt = M.clock
    c.askedAt = undefined
    c.asks = 0
    c.units.clear()
  }
  log(`camps: spawning ${camps.length} camps`)
}

/** campsStop removes every camp's units and hides the buffs (the match is over). */
export function campsStop(): void {
  live = false
  for (const c of camps) {
    if (c.pickup !== undefined && entityClass(c.pickup) !== undefined) fireInput(c.pickup, 'Kill')
    c.pickup = undefined
    setDisabled(c, true)
    fireInput(c.entity, 'RemoveNeutrals')
  }
}

// Each camp's pickup spawner: the game's generic pickup spawner, set to this camp's bridge buff, with its
// own timers pushed far off so it only spawns when told (its SpawnPickup input).
function makeMarker(c: Camp): void {
  c.spawner = createEntity({
    designerName: 'citadel_pickup_spawner', subclass: 'citadel_pickup_spawner', team: 4, position: { x: c.at.x, y: c.at.y, z: c.at.z + 40 },
    keyValues: [{ key: 'pickup_subclass', value: { text: PICKUP[c.kind] } }, { key: 'spawn_delay_override', value: { number: 1e6 } }, { key: 'respawn_time_override', value: { number: 1e6 } }],
  })
  if (c.spawner === undefined) log(`camps: ${c.name}: the game refused a pickup spawner; this camp drops no buff`)
}

/**
 * campsPrepare makes the camps' spawners before the match, one camp per tick: creating an entity can
 * take a while, which is better spent before the match than in it. Call every frame
 * during the hero pick and seating.
 */
export function campsPrepare(): void {
  if (live || markersMade >= camps.length || M.clock < nextMarker) return
  nextMarker = M.clock + TICK
  makeMarker(camps[markersMade++])
}

// The camp is cleared: note who already holds its buff, and ask the spawner for the buff.
function dropBuff(c: Camp): void {
  c.pickup = undefined
  c.spawnTries = 0
  c.holdersAtDrop = new Set()
  for (const m of members()) {
    const pawn = cast.pawn(m.player)
    if (pawn !== undefined && hasBuff(pawn.entity, c.kind)) c.holdersAtDrop.add(m.player.slot)
  }
  askSpawner(c)
}

function askSpawner(c: Camp): void {
  c.spawnTries++
  // Pickups already lying active somewhere. A taken pickup stays in the world inactive, and the spawner
  // may bring the same entity back, so only active ones count as already there.
  c.knownPickups = new Set(findEntities(PICKUP_CLASS).filter((e) => pickupActive(e)))
  if (c.spawner !== undefined) fireInput(c.spawner, 'SpawnPickup')
  c.dropWaitUntil = M.clock + 3
}

// While waiting for the drop: find the new pickup near the camp. It is made active and interactive (cheap,
// and a pickup can start with neither). Asked twice; if nothing comes, the camp just comes back later.
function findDrop(c: Camp): boolean {
  for (const e of findEntities(PICKUP_CLASS)) {
    if (c.knownPickups.has(e)) continue
    const p = entityPosition(e)?.position
    if (p === undefined || Math.hypot(p.x - c.at.x, p.y - c.at.y) > 900) continue
    writeField(e, 'CCitadel_Pickup', 'm_bActive', 'bool', true)
    writeField(e, 'CCitadel_Pickup', 'm_bInteractive', 'bool', true)
    c.pickup = e
    c.dropWaitUntil = 0
    log(`camps: ${c.name} cleared, dropped the ${BUFF_TITLE[c.kind]} buff`)
    return false
  }
  if (M.clock < c.dropWaitUntil) return false
  if (c.spawnTries < 2) {
    askSpawner(c)
    return false
  }
  c.dropWaitUntil = 0
  log(`camps: ${c.name} cleared, but its spawner dropped no buff`)
  return true
}

function pickupActive(e: number): boolean {
  return readField(e, 'CCitadel_Pickup', 'm_bActive', 'bool') !== false
}

// readModifierField gives no value while the hero lacks the modifier; the class and field are only there to
// read something (the documented one is used).
function hasBuff(entity: number, kind: Kind): boolean {
  return readModifierField(entity, MODIFIER[kind], 'CCitadel_Modifier_OrbitCamera', 'm_nCameraLevel', 'int32') !== undefined
}

// The name of a hero within 500 of the camp who holds its buff and didn't when it dropped.
function newHolder(c: Camp): string | undefined {
  for (const m of members()) {
    const pawn = cast.pawn(m.player)
    if (pawn === undefined || pawn.health <= 0 || c.holdersAtDrop.has(m.player.slot)) continue
    if (Math.hypot(pawn.position.x - c.at.x, pawn.position.y - c.at.y) > 500) continue
    if (hasBuff(pawn.entity, c.kind)) return m.name
  }
  return undefined
}

// Whether the buff has been taken (or never came): the camp may come back.
function takeBuff(c: Camp): boolean {
  if (c.dropWaitUntil > 0) return findDrop(c)
  if (c.pickup === undefined) return true
  const holder = newHolder(c)
  if (holder === undefined && entityClass(c.pickup) !== undefined && pickupActive(c.pickup)) return false
  log(`camps: ${holder ?? 'someone'} took the ${BUFF_TITLE[c.kind]} buff from ${c.name}`)
  c.pickup = undefined
  return true
}

/** campsTick runs the camps. Call every frame during the match; it works four times a second. */
export function campsTick(): void {
  if (!live || M.clock < nextTick) return
  nextTick = M.clock + TICK
  scan = undefined // read the camp units again this tick
  if (markersMade < camps.length) makeMarker(camps[markersMade++]) // any not made before the match
  for (const c of camps) {
    switch (c.state) {
      case 'waiting': {
        const near = unitsNear(c)
        if (near.length > 0) {
          if (c.askedAt === undefined) {
            fireInput(c.entity, 'RemoveNeutrals') // the game spawned it on its own: not yet
            log(`camps: ${c.name} came early; removed`)
          } else {
            c.state = 'up'
            c.units = new Set(near)
            c.asks = 0
            log(`camps: ${c.name} up (${near.length} units)`)
          }
          break
        }
        if (M.clock >= c.dueAt && (c.askedAt === undefined || M.clock - c.askedAt > 5)) {
          c.askedAt = M.clock // asked; again in 5 s if nothing shows
          setDisabled(c, false)
          fireInput(c.entity, 'SpawnNeutrals')
          if (++c.asks === 3) log(`camps: ${c.name} will not spawn (asked 3 times)`)
        }
        break
      }
      case 'up':
        for (const e of near(c)) c.units.add(e) // a unit that showed up a moment late
        for (const e of [...c.units]) if (!alive(e)) c.units.delete(e)
        if (c.units.size > 0) break
        setDisabled(c, true) // the game must not bring it back on its own cycle
        c.askedAt = undefined
        dropBuff(c)
        c.state = 'buff'
        break
      case 'buff':
        if (unitsNear(c).length > 0) fireInput(c.entity, 'RemoveNeutrals') // the game spawned it on its own
        if (!takeBuff(c)) break
        log(`camps: ${c.name} back in ${CAMP_RESPAWN} s`)
        c.state = 'waiting'
        c.dueAt = M.clock + CAMP_RESPAWN
        break
    }
  }
}

// While a camp is up, units that appear at its spot within a second or so of spawning are its own too.
function near(c: Camp): number[] {
  return c.asks === 0 && c.askedAt !== undefined && M.clock - c.askedAt < 3 ? unitsNear(c) : []
}
