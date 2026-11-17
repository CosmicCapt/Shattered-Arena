// Sinner's Sacrifices that pay tickets (16 Nov 2026, from the user's design).
//   - Four in the map (tools/build_arena_v1.py): one on a small island in each middle pit, against the gun
//     buff wall, and one on the floor by each long side pit. Camp names arena_sinner_<pit|edge>_<n>.
//   - The pit ones first come at SINNER_PIT_AT, the edge ones at SINNER_EDGE_AT (match time), then each comes
//     back SINNER_RESPAWN seconds after it is cleared. Like the jungle camps, each camp is kept disabled except
//     when this module spawns it, since the game would spawn camps on its own 2-minute cycle.
//   - The game's souls and jackpot buffs stay as they are. On top, each HEAVY melee hit on a Sinner gives the
//     hitter's team SINNER_HIT_TICKETS, except the last hit: SINNER_JACKPOT_TICKETS if it was a jackpot,
//     nothing if not. Light melee gives nothing. Tickets never go above the team's starting tickets.
//   - Whether a hit was the last is only known once the Sinner is gone, so a hit's tickets are paid
//     SINNER_SETTLE seconds after it, or when the Sinner goes.
//   - The jackpot: the Sinner runs a timing mini-game ("the vault") and a well-timed one ends in the jackpot.
//     Its vault state (m_iVaultState) is read four times a second and logged as it changes, to learn which
//     state is the jackpot (SINNER_JACKPOT_STATE). Until that is known, a Sinner that goes while it still has
//     health counts as a jackpot (the vault breaking open), and one beaten down to no health doesn't.
//   - Arrivals (16 Nov 2026): a pit Sinner's island (a func_movelinear in the map, arena_sinner_island_<n>,
//     built sunk under the pit floor) rises SINNER_RISE_TIME seconds before the Sinner is due, with a rumble,
//     and sinks again SINNER_SINK_DELAY seconds after the Sinner is cleared (anyone on it rides it down into
//     the pit). Every Sinner drops in from the sky: the Sinner's model falls SINNER_DROP_HEIGHT units in
//     SINNER_DROP_TIME seconds, and where it lands a burst and a thud play and the real Sinner spawns.
import {
  createModel,
  createParticle,
  type DamagedEvent,
  emitSound,
  entityName,
  entityPosition,
  findEntities,
  fireInput,
  log,
  moveEntity,
  readField,
  stopSound,
  type Vector,
} from 'modlock'

import {
  SINNER_DROP_HEIGHT,
  SINNER_DROP_TIME,
  SINNER_EDGE_AT,
  SINNER_HIT_TICKETS,
  SINNER_JACKPOT_STATE,
  SINNER_JACKPOT_TICKETS,
  SINNER_LAND_EFFECT,
  SINNER_LAND_SOUND,
  SINNER_PIT_AT,
  SINNER_RESPAWN,
  SINNER_RISE_TIME,
  SINNER_RUMBLE_SOUND,
  SINNER_SETTLE,
  SINNER_SINK_DELAY,
} from '../config'
import { cast, M, memberByPawn } from '../match/match'
import { isHeavy, isMelee } from '../rules/knockback'
import { gainTickets } from '../rules/tickets'

const SINNER_CLASS = 'npc_neutral_sinners_sacrifice'
/** SINNER_MODEL is the Sinner's own model, for its fall from the sky. Precache it with SINNER_PARTICLES. */
export const SINNER_MODEL = 'models/props_gameplay/sinners_sacrifice_vault/sinners_sacrifice.vmdl'
export const SINNER_PARTICLES = [SINNER_LAND_EFFECT]
const ISLAND_CLASS = 'func_movelinear'
const ISLAND_NEAR = 400 // an island within this of a pit Sinner's camp is that Sinner's
const PIN_SLACK = 4 // a pit Sinner further than this from its spot is put back on its island
const NEAR = 300 // a Sinner within this of its camp is that camp's
const TICK = 0.25
const SAME_SWING = 0.35 // a melee can report several hits: one per hero per this long

type Kind = 'pit' | 'edge'
type State = 'waiting' | 'dropping' | 'up'
interface Hit { team: number; name: string; at: number }
interface Island {
  e: number
  name: string
  up: boolean // raised, or on its way up
  movedAt: number // when it last started moving
  sinkAt: number | undefined // when to lower it (its Sinner was cleared)
  rumble: number | undefined // the rumble playing while it moves
}
// The falling model.
interface Faller { move(p: Vector): void; remove(): void }
interface Sinner {
  camp: number
  name: string
  kind: Kind
  at: Vector
  state: State
  dueAt: number
  askedAt: number | undefined
  disabled: boolean | undefined
  unit: number | undefined // up: the Sinner itself
  health: number // its health at the last read
  vault: number | undefined // its vault state at the last read
  jackpotSeen: boolean // the vault reached SINNER_JACKPOT_STATE
  hits: Hit[] // heavy hits not paid yet
  lastHitBy: Map<number, number> // player slot -> when their last counted hit landed
  island: Island | undefined // pit Sinners: the island it stands on
  faller: Faller | undefined // dropping: the falling model
  dropAt: number // dropping: when the fall started
  pinLogged: boolean // up: its first put-back was logged
}

let sinners: Sinner[] = []
let live = false
let nextTick = 0

function kindOf(name: string): Kind | undefined {
  const m = /^arena_sinner_(pit|edge)_/.exec(name)
  return m === null ? undefined : (m[1] as Kind)
}

function setDisabled(s: Sinner, disabled: boolean): void {
  if (s.disabled === disabled) return
  s.disabled = disabled
  fireInput(s.camp, 'SetDisabled', { boolean: disabled })
}

function healthOf(e: number): number | undefined {
  const hp = readField(e, 'CBaseEntity', 'm_iHealth', 'int32')
  return typeof hp === 'number' ? hp : undefined
}

function vaultOf(e: number): number | undefined {
  const v = readField(e, 'CNPC_Neutral_SinnersSacrifice', 'm_iVaultState', 'int32')
  return typeof v === 'number' ? v : undefined
}

function find(): Sinner[] {
  const out: Sinner[] = []
  for (const camp of findEntities('info_neutral_trooper_camp')) {
    const name = entityName(camp) ?? String(readField(camp, 'CInfoTrooperNeutralCamp', 'm_iszCampName', 'string') ?? '')
    const kind = kindOf(name)
    const at = entityPosition(camp)?.position
    if (kind === undefined || at === undefined) continue
    out.push({ camp, name, kind, at, state: 'waiting', dueAt: Infinity, askedAt: undefined, disabled: undefined, unit: undefined, health: 0, vault: undefined, jackpotSeen: false, hits: [], lastHitBy: new Map(), island: undefined, faller: undefined, dropAt: 0, pinLogged: false })
  }
  const islands = findEntities(ISLAND_CLASS).filter((e) => /^arena_sinner_island_/.test(entityName(e) ?? ''))
  for (const s of out) {
    if (s.kind !== 'pit') continue
    for (const e of islands) {
      const p = entityPosition(e)?.position
      if (p === undefined || Math.hypot(p.x - s.at.x, p.y - s.at.y) > ISLAND_NEAR) continue
      s.island = { e, name: entityName(e) ?? 'island', up: false, movedAt: -99, sinkAt: undefined, rumble: undefined }
    }
    if (s.island === undefined) log(`sinners: no island found for ${s.name} (recompile the map?)`)
  }
  return out
}

// ---------------------------------------------------------------- islands
function moveIsland(s: Sinner, up: boolean): void {
  const i = s.island
  if (i === undefined || i.up === up) return
  i.up = up
  i.movedAt = M.clock
  i.sinkAt = undefined
  if (!fireInput(i.e, up ? 'Open' : 'Close')) log(`sinners: ${i.name} refused ${up ? 'Open' : 'Close'}`)
  if (i.rumble !== undefined) stopSound(i.rumble)
  i.rumble = emitSound(i.e, SINNER_RUMBLE_SOUND)
  if (i.rumble === undefined) log(`sinners: no rumble (${SINNER_RUMBLE_SOUND})`)
  log(`sinners: ${i.name} ${up ? 'rising' : 'sinking'}`)
}

// Sinks an island at once, quietly (the match is over, or the map just loaded: it's already down).
function resetIsland(s: Sinner, quiet: boolean): void {
  const i = s.island
  if (i === undefined) return
  if (i.rumble !== undefined) stopSound(i.rumble)
  i.rumble = undefined
  i.sinkAt = undefined
  if (quiet) { i.up = false; fireInput(i.e, 'Close'); return }
  moveIsland(s, false)
}

function islandsTick(s: Sinner): void {
  const i = s.island
  if (i === undefined) return
  if (i.rumble !== undefined && M.clock - i.movedAt >= SINNER_RISE_TIME) {
    stopSound(i.rumble) // the island has stopped
    i.rumble = undefined
  }
  if (i.up && i.sinkAt !== undefined && M.clock >= i.sinkAt) moveIsland(s, false)
}

// ---------------------------------------------------------------- the drop from the sky
function facingIn(at: Vector): number {
  return (Math.atan2(-at.y, -at.x) * 180) / Math.PI // toward the middle, as the map's spawn points face
}

function startDrop(s: Sinner): void {
  s.state = 'dropping'
  s.dropAt = M.clock
  const position = { x: s.at.x, y: s.at.y, z: s.at.z + SINNER_DROP_HEIGHT }
  const facing = { pitch: 0, yaw: facingIn(s.at), roll: 0 }
  // A mod model (createModel). prop_dynamic and prop_dynamic_override are both deleted by the game: the
  // Sinner's model has physics prop data (tested 16 Nov 2026).
  const o = createModel({ resource: SINNER_MODEL, position, facing })
  s.faller = o === undefined ? undefined : { move: (p) => { o.move(p, facing) }, remove: () => { o.remove() } }
  if (s.faller === undefined) log(`sinners: the game refused ${s.name}'s falling model; it appears without the drop`)
}

function land(s: Sinner): void {
  s.faller?.remove()
  s.faller = undefined
  if (createParticle({ resource: SINNER_LAND_EFFECT, position: s.at }) === undefined) log(`sinners: no landing effect (${SINNER_LAND_EFFECT})`)
  emitSound(s.island?.e ?? s.camp, SINNER_LAND_SOUND)
  s.state = 'waiting'
  s.askedAt = M.clock
  setDisabled(s, false)
  fireInput(s.camp, 'SpawnNeutrals')
}

// A pit Sinner stands on its island, but the game places a spawning Sinner on the walkable ground it knows,
// which under an island that rises is the pit floor (tested 16 Nov 2026: they dropped through the islands).
// So every frame it is put back on its spot.
function pin(s: Sinner): void {
  const u = s.unit
  if (u === undefined || s.island === undefined) return
  const p = entityPosition(u)
  if (p === undefined) return
  if (Math.abs(p.position.z - s.at.z) <= PIN_SLACK && Math.hypot(p.position.x - s.at.x, p.position.y - s.at.y) <= PIN_SLACK) return
  if (!s.pinLogged) {
    s.pinLogged = true
    log(`sinners: ${s.name} was at z ${Math.round(p.position.z)}; put back on its island`)
  }
  moveEntity(u, s.at, p.facing, { x: 0, y: 0, z: 0 })
}

// Every frame: the falling Sinners speed up as they fall, and land on time; the pit Sinners stay on their islands.
function dropsFrame(): void {
  for (const s of sinners) {
    if (s.state === 'up') pin(s)
    if (s.state !== 'dropping') continue
    const t = (M.clock - s.dropAt) / SINNER_DROP_TIME
    if (t >= 1) { land(s); continue }
    s.faller?.move({ x: s.at.x, y: s.at.y, z: s.at.z + SINNER_DROP_HEIGHT * (1 - t * t) })
  }
}

function cancelDrop(s: Sinner): void {
  s.faller?.remove()
  s.faller = undefined
  if (s.state === 'dropping') s.state = 'waiting'
}

// The live Sinner standing at this camp, if any.
function unitAt(s: Sinner): number | undefined {
  for (const e of findEntities(SINNER_CLASS)) {
    const p = entityPosition(e)?.position
    if (p === undefined || Math.hypot(p.x - s.at.x, p.y - s.at.y) > NEAR) continue
    if ((healthOf(e) ?? 1) > 0) return e
  }
  return undefined
}

/** sinnersHold keeps every Sinner away (team select). Call when a map is ready. */
export function sinnersHold(): void {
  live = false
  sinners = find()
  for (const s of sinners) {
    cancelDrop(s)
    setDisabled(s, true)
    fireInput(s.camp, 'RemoveNeutrals')
    resetIsland(s, true)
  }
  log(`sinners: ${sinners.length} held until their time, ${sinners.filter((s) => s.island !== undefined).length} islands sunk`)
}

/** sinnersStart sets each Sinner's first time (the match has started). */
export function sinnersStart(): void {
  if (sinners.length === 0) sinners = find()
  live = true
  nextTick = 0
  for (const s of sinners) {
    cancelDrop(s)
    s.state = 'waiting'
    s.dueAt = M.liveAt + (s.kind === 'pit' ? SINNER_PIT_AT : SINNER_EDGE_AT)
    s.askedAt = undefined
    s.unit = undefined
    s.hits = []
  }
}

/** sinnersStop removes every Sinner (the match is over). */
export function sinnersStop(): void {
  live = false
  for (const s of sinners) {
    cancelDrop(s)
    setDisabled(s, true)
    fireInput(s.camp, 'RemoveNeutrals')
    s.hits = []
    if (s.island?.up === true) resetIsland(s, true) // sinks, without a rumble (nothing would stop it)
  }
}

/** sinnersDamaged counts heavy melee hits on a Sinner. Call from onDamaged. */
export function sinnersDamaged(hit: DamagedEvent): void {
  if (!live || M.phase !== 'live' || hit.attacker === 0) return
  const s = sinners.find((x) => x.state === 'up' && x.unit === hit.victim)
  if (s === undefined) return
  const m = memberByPawn(hit.attacker)
  const team = m === undefined ? undefined : cast.pawn(m.player)?.team
  if (m === undefined || team === undefined) return
  if (!isMelee(hit.ability)) return
  const heavy = isHeavy(m.player.slot)
  log(`sinners: ${m.name} hit ${s.name} (${heavy ? 'heavy' : 'light'}, ${Math.round(hit.healthBefore)} -> ${Math.round(hit.healthBefore - hit.healthLost)} health, vault ${s.vault})`)
  if (!heavy) return
  const last = s.lastHitBy.get(m.player.slot) ?? -99
  if (M.clock - last < SAME_SWING) return
  s.lastHitBy.set(m.player.slot, M.clock)
  s.hits.push({ team, name: m.name, at: M.clock })
}

/** sinnersHealth notes a Sinner's health after any hit (heavy or not), so its health when it goes is known. */
export function sinnersHealth(hit: DamagedEvent): void {
  const s = sinners.find((x) => x.state === 'up' && x.unit === hit.victim)
  if (s !== undefined) s.health = Math.max(0, hit.healthBefore - hit.healthLost)
}

// Pays every hit older than SINNER_SETTLE: none of those was the last.
function settle(s: Sinner): void {
  while (s.hits.length > 0 && M.clock - s.hits[0].at >= SINNER_SETTLE) {
    const h = s.hits.shift()!
    gainTickets(h.team, SINNER_HIT_TICKETS, `${h.name} hit ${s.name}`)
  }
}

// The Sinner is gone: its newest hit was the last (jackpot or nothing); any earlier ones pay as usual.
function cleared(s: Sinner, healthLeft: number): void {
  const jackpot = SINNER_JACKPOT_STATE !== undefined ? s.jackpotSeen : healthLeft > 0
  log(`sinners: ${s.name} cleared (${jackpot ? 'jackpot' : 'no jackpot'}; health left ${healthLeft}, last vault state ${s.vault})`)
  const last = s.hits.pop()
  for (const h of s.hits) gainTickets(h.team, SINNER_HIT_TICKETS, `${h.name} hit ${s.name}`)
  if (last !== undefined && jackpot) gainTickets(last.team, SINNER_JACKPOT_TICKETS, `${last.name} won ${s.name}'s jackpot`)
  s.hits = []
}

/** sinnersTick runs the Sinners. Call every frame during the match: the drops move every frame, the rest
 * works four times a second. */
export function sinnersTick(): void {
  if (!live) return
  dropsFrame()
  if (M.clock < nextTick) return
  nextTick = M.clock + TICK
  for (const s of sinners) {
    islandsTick(s)
    switch (s.state) {
      case 'waiting': {
        const u = unitAt(s)
        if (u !== undefined) {
          if (s.askedAt === undefined) {
            fireInput(s.camp, 'RemoveNeutrals') // the game spawned it on its own: not yet
            break
          }
          s.state = 'up'
          s.unit = u
          s.health = healthOf(u) ?? 0
          s.vault = vaultOf(u)
          s.jackpotSeen = false
          s.hits = []
          s.lastHitBy.clear()
          s.pinLogged = false
          pin(s)
          log(`sinners: ${s.name} up (vault state ${s.vault})`)
          break
        }
        if (s.island !== undefined && !s.island.up && M.clock >= s.dueAt - SINNER_RISE_TIME) moveIsland(s, true)
        if (M.clock < s.dueAt) break
        if (s.askedAt === undefined) {
          // Its island must be all the way up before it lands.
          if (s.island === undefined || (s.island.up && M.clock - s.island.movedAt >= SINNER_RISE_TIME)) startDrop(s)
        } else if (M.clock - s.askedAt > 5) {
          s.askedAt = M.clock // asked again: nothing showed in 5 s
          setDisabled(s, false)
          fireInput(s.camp, 'SpawnNeutrals')
        }
        break
      }
      case 'dropping':
        break // dropsFrame
      case 'up': {
        const u = s.unit!
        const hp = healthOf(u)
        const gone = hp === undefined || hp <= 0 || entityPosition(u) === undefined
        if (!gone) {
          s.health = hp!
          const v = vaultOf(u)
          if (v !== s.vault) log(`sinners: ${s.name} vault state ${s.vault} -> ${v} (health ${hp})`)
          s.vault = v
          if (SINNER_JACKPOT_STATE !== undefined && v === SINNER_JACKPOT_STATE) s.jackpotSeen = true
          settle(s)
          break
        }
        cleared(s, hp ?? s.health)
        setDisabled(s, true) // the game must not bring it back on its own cycle
        s.state = 'waiting'
        s.unit = undefined
        s.askedAt = undefined
        s.dueAt = M.clock + SINNER_RESPAWN
        if (s.island !== undefined) s.island.sinkAt = M.clock + SINNER_SINK_DELAY
        log(`sinners: ${s.name} back in ${SINNER_RESPAWN} s`)
        break
      }
    }
  }
}
