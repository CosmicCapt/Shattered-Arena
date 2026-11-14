// The bonus round: after a match is won, both teams are put on a small platform of their own (layout's
// BONUS) with a pit all round it, and the last team with a hero standing wins the round. The match's
// winner is already settled; this is for fun.
//
//   victory    BONUS_VICTORY_SECONDS: everyone is frozen where they stand (dead heroes are revived), the
//              screen blinks black and comes back on a still view of the winning team's Patron (a player
//              who turns their view is turned back). The game's HUD is hidden; the mod's screen (hud.tsx)
//              names the winner, then says "Moving to the Bonus Round", and the screen fades to black.
//   reveal     BONUS_REVEAL_SECONDS: everyone is on the platform, healed and frozen, and every camera
//              shows the whole bonus arena from the side (this one the player may turn), still without
//              the game's HUD.
//   countdown  BONUS_COUNTDOWN: the cameras are back on the heroes, each team facing the other, the HUD
//              is back and the screen (hud.tsx) counts down to GO!
//   fight      BONUS_SECONDS at most, with every cooldown ended at its start, except that nobody has their
//              ultimate (held on a long cooldown). Nobody respawns: a hero who dies or falls is out and
//              watches the others. A team with nobody left loses; when the time
//              runs out the team with more heroes left wins, and equal numbers are a draw.
//
// The shots are cinema.ts's: a camera looks at its target from the way its hero faces, so each shot turns
// the heroes first.
//
// match.ts starts it from endMatch (whenBonus) and shows the results card when it ends (showResults).
import { log, type Pawn, type Vector } from 'modlock'
import { cutShot, shoot } from './cinema'
import { BONUS_COUNTDOWN, BONUS_CUT, BONUS_FADE, BONUS_NO_RESPAWN, BONUS_REVEAL_SECONDS, BONUS_SECONDS, BONUS_VICTORY_SECONDS } from './config'
import { BONUS, PIT_KILL_Z } from './layout'
import { patronSpot } from './patrons'
import { AMBER, cast, hideGameHud, M, type Member, patronName, SAPPHIRE, setRespawnTime, showResults, teamName } from './match'

type Stage = 'off' | 'victory' | 'reveal' | 'countdown' | 'fight'

interface Entry {
  m: Member
  team: number
  spot: Vector
  set: Stage // the last stage this hero was set up for (moved, turned, camera)
  nextTry: number // when to ask for a revive or a move again
  out: boolean // fight: dead or fallen
  watching: number | undefined // out: the hero entity their camera follows
}

export const B = {
  stage: 'off' as Stage,
  stageEnds: 0, // victory, reveal and countdown: when the stage ends
  foughtAt: 0, // fight: when it began
  endsAt: 0, // fight: when the time runs out
  alive: { [AMBER]: 0, [SAPPHIRE]: 0 } as Record<number, number>,
}

let entries: Entry[] = []
let cutAt = 0 // victory: when the cameras cut to the Patron, behind the black screen
let faded = false
let nextUltLock = 0

const STRAY = 250 // a hero this far from their place on the platform is moved back
// The Patron shot: a point up the Patron's body, above the base wall, seen from out in the arena and a
// little below.
const PATRON_LOOK_UP = 950
const PATRON_SHOT = { distance: 2000, pitch: -6 }
const ULT_SLOT = 3 // the ultimate's ability key
const ULT_LOCK = 9999 // seconds of cooldown an ultimate is held on
// The arena shot: the middle of the platform from the side, looking down on it.
const ARENA_SHOT = { distance: 2100, pitch: 20, yaw: 180, height: 120 }

/** bonusReset forgets the round when a new map loads. */
export function bonusReset(): void {
  entries = []
  B.stage = 'off'
}


/** bonusStart begins the round with every hero on a team. It refuses when a team has no hero. */
export function bonusStart(): boolean {
  entries = []
  const count: Record<number, number> = { [AMBER]: 0, [SAPPHIRE]: 0 }
  for (const m of cast.members()) {
    const team = cast.pawn(m.player)?.team
    if (team !== AMBER && team !== SAPPHIRE) continue
    const spots = BONUS.spawns[team]
    entries.push({ m, team, spot: spots[count[team]++ % spots.length], set: 'off', nextTry: 0, out: false, watching: undefined })
  }
  if (count[AMBER] === 0 || count[SAPPHIRE] === 0) {
    entries = []
    return false
  }
  setRespawnTime(BONUS_NO_RESPAWN)
  B.stage = 'victory'
  B.stageEnds = M.clock + BONUS_VICTORY_SECONDS
  B.alive = count
  faded = false
  hideGameHud(true)
  cutAt = M.clock + BONUS_CUT
  for (const e of entries) {
    // Held at once, so nobody fights on; the black screen hides the camera's move to the Patron.
    if (cast.pawn(e.m.player)!.health > 0) e.m.frozen = e.m.player.freeze(true)
    if (e.m.bot) continue
    e.m.player.screenEffect('black', { fadeIn: BONUS_CUT, hold: 0.5, fadeOut: 0.5 })
  }
  log(`bonus: started, ${count[AMBER]} Amber and ${count[SAPPHIRE]} Sapphire`)
  return true
}

/** bonusTick runs the round. Call every frame while the match's phase is 'bonus'. */
export function bonusTick(): void {
  switch (B.stage) {
    case 'victory': return victory()
    case 'reveal': return reveal()
    case 'countdown': return countdown()
    case 'fight': return fight()
  }
}

// Each team faces the other across the middle line.
function facing(team: number): { pitch: number; yaw: number; roll: number } {
  return { pitch: 0, yaw: BONUS.spawns[team][0].y > BONUS.centre.y ? 270 : 90, roll: 0 }
}

// The hero, alive, once it is time to try them again; a dead one is asked to revive.
function ready(e: Entry): Pawn | undefined {
  const pawn = cast.pawn(e.m.player)
  if (pawn === undefined || M.clock < e.nextTry) return undefined
  if (pawn.health <= 0) {
    e.m.player.respawn()
    e.nextTry = M.clock + 0.3
    return undefined
  }
  return pawn
}

// Moves or turns a hero and holds it there. Released first: a frozen hero would not move.
function put(e: Entry, position: Vector, pitch: number, yaw: number): boolean {
  if (e.m.frozen) e.m.player.freeze(false)
  const moved = e.m.player.teleport(position, { pitch, yaw, roll: 0 }, { x: 0, y: 0, z: 0 })
  e.m.frozen = e.m.player.freeze(true)
  return moved
}

function victory(): void {
  const winner = M.winner ?? AMBER
  const patron = patronSpot(winner)
  const yaw = patron.y > 0 ? 90 : 270 // toward the Patron from the arena side
  for (const e of entries) {
    if (e.set === 'victory' || M.clock < cutAt) continue
    const pawn = ready(e)
    if (pawn === undefined) continue
    put(e, pawn.position, PATRON_SHOT.pitch, yaw)
    if (!e.m.bot) shoot(e.m.player, { x: patron.x, y: patron.y, z: patron.z + PATRON_LOOK_UP }, PATRON_SHOT.distance, BONUS_VICTORY_SECONDS + 2, { pitch: PATRON_SHOT.pitch, yaw })
    e.set = 'victory'
  }
  const left = B.stageEnds - M.clock
  if (!faded && left <= BONUS_FADE) {
    faded = true
    for (const e of entries) if (!e.m.bot) e.m.player.screenEffect('black', { fadeIn: BONUS_FADE, hold: 0.5, fadeOut: 0.8 })
  }
  if (left > 0) return
  B.stage = 'reveal'
  B.stageEnds = M.clock + BONUS_REVEAL_SECONDS
}

function reveal(): void {
  const centre = { x: BONUS.centre.x, y: BONUS.centre.y, z: BONUS.centre.z + ARENA_SHOT.height }
  for (const e of entries) {
    if (e.set === 'reveal') continue
    const pawn = ready(e)
    if (pawn === undefined) continue
    const moved = put(e, e.spot, ARENA_SHOT.pitch, ARENA_SHOT.yaw)
    e.m.player.heal(100000)
    if (!e.m.bot) shoot(e.m.player, centre, ARENA_SHOT.distance, BONUS_REVEAL_SECONDS + 2)
    log(`bonus: ${e.m.name} placed ${moved}`)
    e.set = 'reveal'
  }
  if (M.clock < B.stageEnds) return
  B.stage = 'countdown'
  B.stageEnds = M.clock + BONUS_COUNTDOWN
  hideGameHud(false)
}

function countdown(): void {
  for (const e of entries) {
    const pawn = ready(e)
    if (pawn === undefined) continue
    const off = Math.hypot(pawn.position.x - e.spot.x, pawn.position.y - e.spot.y)
    if (e.set === 'countdown' && off < STRAY) continue
    cutShot(e.m.player)
    put(e, e.spot, 0, facing(e.team).yaw)
    e.set = 'countdown'
    e.nextTry = M.clock + 0.5 // then checked again, in case the game's own respawn moved them
  }
  if (M.clock >= B.stageEnds) startFight()
}

function startFight(): void {
  B.stage = 'fight'
  B.foughtAt = M.clock
  B.endsAt = M.clock + BONUS_SECONDS
  for (const e of entries) {
    const pawn = cast.pawn(e.m.player)
    cutShot(e.m.player)
    if (e.m.frozen) e.m.player.freeze(false)
    e.m.frozen = false
    if (!e.m.bot) e.m.player.centerText('')
    if (pawn === undefined || pawn.health <= 0 || e.set !== 'countdown') {
      e.out = true
      continue
    }
    // Every ability and item is ready, but for the ultimate.
    for (const a of e.m.player.abilities()) if (a.slot !== ULT_SLOT) e.m.player.refreshAbility(a.name)
    lockUlt(e)
    e.m.player.restoreStamina()
  }
  nextUltLock = M.clock + 1
  log('bonus: fight')
}

// Holds a hero's ultimate on a long cooldown. Asked again through the fight, since an item can end a cooldown.
function lockUlt(e: Entry): void {
  const now = M.lastFrame ?? 0 // the game's time, which cooldowns are kept in
  for (const a of e.m.player.abilities()) {
    if (a.slot !== ULT_SLOT || a.cooldownEnd > now + BONUS_SECONDS) continue
    if (!e.m.player.setAbility({ ability: a.name, cooldownEnd: now + ULT_LOCK })) log(`bonus: could not hold ${e.m.name}'s ${a.name}`)
  }
}

function fight(): void {
  const alive: Record<number, number> = { [AMBER]: 0, [SAPPHIRE]: 0 }
  for (const e of entries) {
    if (e.out) continue
    const pawn = cast.pawn(e.m.player)
    if (pawn !== undefined && pawn.health > 0 && pawn.position.z < PIT_KILL_Z) e.m.player.kill()
    if (pawn === undefined || pawn.health <= 0 || pawn.position.z < PIT_KILL_Z) {
      e.out = true
      log(`bonus: ${e.m.name} is out`)
      continue
    }
    alive[e.team]++
  }
  B.alive = alive
  if (M.clock >= nextUltLock) {
    nextUltLock = M.clock + 1
    for (const e of entries) if (!e.out) lockUlt(e)
  }
  for (const e of entries) if (e.out && !e.m.bot) follow(e)
  if (alive[AMBER] === 0 || alive[SAPPHIRE] === 0 || M.clock >= B.endsAt) {
    finish(alive[AMBER] > alive[SAPPHIRE] ? AMBER : alive[SAPPHIRE] > alive[AMBER] ? SAPPHIRE : 'draw')
  }
}

// An out player's camera follows a living teammate, or an enemy once no teammate is left.
function follow(e: Entry): void {
  const living = entries.filter((o) => !o.out)
  const target = living.find((o) => o.team === e.team) ?? living[0]
  const entity = target === undefined ? undefined : cast.pawn(target.m.player)?.entity
  if (entity === undefined || entity === e.watching) return
  e.watching = entity
  if (!e.m.player.watch(entity, true)) log(`bonus: ${e.m.name} could not watch ${target!.m.name}`)
}

function finish(winner: number | 'draw'): void {
  B.stage = 'off'
  M.bonusWinner = winner
  log(`bonus: ${winner === 'draw' ? 'a draw' : `${teamName(winner)} wins`} (${B.alive[AMBER]} Amber, ${B.alive[SAPPHIRE]} Sapphire left)`)
  for (const e of entries) {
    if (e.m.bot) continue
    if (e.watching !== undefined) e.m.player.unwatch()
    e.m.player.announce('BONUS ROUND', winner === 'draw' ? 'A draw.' : `${patronName(winner)} is the last team standing.`)
  }
  entries = []
  showResults(false)
}
