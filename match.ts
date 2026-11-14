// The match flow, all on one map (no reload until the match is over):
//
//   lobby    team select with ready-up and test bots; the clock is held at 0:00
//   heroes   everyone picks at once; the same hero can be on both teams, never twice on one
//   seating  everyone is put on their pick at their spawn and held still until all are in
//   live     the match: tickets, minions, pits (tickets.ts, minions.ts)
//   results  the winner is shown, then the map reloads into a fresh lobby
//
// The map is only reloaded after a match, so every hero, item and soul starts fresh for the next one.
// The hero pick runs on the match map (a reload in between made the mod's screens unreliable).
import {
  bystanderStates,
  Cast,
  cursorFree,
  freeCursor,
  heroes,
  hide,
  hideHud,
  holdMatchClock,
  holdModifierState,
  log,
  type Pawn,
  type Player,
  serverCommand,
  type Want,
} from 'modlock'
import { run } from 'modlock/console'

import { botJoined, botsJoining, botsReset, botsTick, replaceBot } from './bots' // Bots
import {
  AMBER,
  BOT_AI,
  GO_COUNTDOWN,
  INTRO_SECONDS,
  PICK_SECONDS,
  PICKED_COUNTDOWN,
  BONUS_ROUND,
  KNOCKBACK_PERCENT,
  KNOCKBACK_PERCENT_MAX,
  KNOCKBACK_PERCENT_STEP,
  RESPAWN_OPTIONS,
  RESPAWN_SECONDS,
  START_SOULS,
  START_SOULS_MAX,
  START_SOULS_OPTIONS,
  RESULTS_SECONDS,
  SAPPHIRE,
  SEAT_SECONDS,
  SOUL_SCALE,
  SOUL_SCALE_MAX,
  SOUL_SCALE_MIN,
  SOUL_SCALE_STEP,
  START_TICKETS,
  TEAM_COUNTDOWN,
  TEAM_SIZE,
  TICKET_MAX,
  TICKET_MIN,
  TICKET_STEP,
} from './config'
import { cutShot, shoot, shotsReset } from './cinema'
import { CENTRE, MAP, SPAWNS } from './layout'
import { camerasReset, lobbyCamera, releaseCamera } from './lobbycam'

export { AMBER, PICK_SECONDS, SAPPHIRE, TEAM_SIZE }

const NPC_IGNORE = 'MODIFIER_STATE_IGNORED_BY_NPC_TARGETING'
// In the lobby and hero pick each hero stands still and out of play.
const LOBBY_STATES: readonly string[] = [...bystanderStates, NPC_IGNORE]
const BOT_PICK_GAP = 0.4 // heroes: seconds between one bot's pick and the next
const BOT_PICK_LIMIT = 15 // heroes: seconds the bots get to pick, replacements included
const SEAT_RETRY = 6 // seating: ask for a pick again after this many seconds
// The match intro's shot: the middle of the arena from high above each player's own side, looking down.
const INTRO_SHOT = { distance: 5200, pitch: 62 }

// -------------------------------------------------------------------- types
type Phase = 'lobby' | 'heroes' | 'seating' | 'live' | 'bonus' | 'results'

export interface Member {
  player: Player
  name: string
  steamId: bigint // for the Steam picture
  bot: boolean // Bots
  team: number | undefined // 2 or 3, picked in the lobby
  ready: boolean // lobby ready-up
  hero: string | undefined // picked hero name, such as 'hero_atlas'
  locked: boolean // locked in their hero
  seated: boolean // seating: on their pick and team
  placed: boolean // seating: moved to the spawn
  intro: boolean // seating: their camera is on the view from above
  askedAt: number // seating: when their pick was last asked for
  frozen: boolean
  want: Want
  held: { entity: number; states: readonly string[] } | undefined
  nextCursorCheck: number
  joinOrder: number // the earliest player still here is the host
}

// ------------------------------------------------------------------- state
export const M = {
  phase: 'lobby' as Phase,
  // The mod's own clock: it adds up frame time.
  clock: 0,
  lastFrame: undefined as number | undefined,
  countdownAt: undefined as number | undefined, // lobby: the hero pick starts at this time
  pickEndsAt: 0, // heroes: the pick ends at this time
  allPickedAt: undefined as number | undefined, // heroes: when the last player locked in
  nextBotPick: 0, // heroes: when the next bot picks
  botPicksFrom: undefined as number | undefined, // heroes: when the bots began picking
  seatUntil: 0, // seating: start without anyone not on their pick by then
  introEnds: undefined as number | undefined, // seating: the view from above ends and the countdown starts at this time
  counting: false, // seating: the countdown is on
  goAt: undefined as number | undefined, // seating: the match starts at this time
  liveAt: 0, // when the match started
  startTickets: START_TICKETS, // each team's tickets next match; the host sets it on team select
  soulScale: SOUL_SCALE, // share of normal minion and kill souls; the host sets it on team select
  respawnSeconds: RESPAWN_SECONDS, // every respawn in the match; the host sets it on team select
  startSouls: START_SOULS, // souls each hero has when the match starts; the host sets it on team select
  knockback: KNOCKBACK_PERCENT, // heavy melee push, as a percent of normal; the host sets it on team select
  nextClockHold: 0,
  nextMinimapHide: 0,
  hudHidden: false, // the whole game HUD is hidden, for a cinematic shot
  bonusRound: BONUS_ROUND, // a bonus round after the match; the host sets it on team select
  winner: undefined as number | undefined, // results: the winning team
  bonusWinner: undefined as number | 'draw' | undefined, // results: who won the bonus round, when there was one
  resultsEnd: 0,
  reloading: false,
}

let onGo: (() => void) | undefined
let onEnd: (() => void) | undefined
let onBonus: (() => boolean) | undefined

/** whenLive sets what runs when the match starts (tickets, minions). */
export function whenLive(fn: () => void): void {
  onGo = fn
}
/** whenOver sets what runs when the match ends (stop minions). */
export function whenOver(fn: () => void): void {
  onEnd = fn
}

/** whenBonus sets what starts the bonus round; it returns false when the round can't be played. */
export function whenBonus(fn: () => boolean): void {
  onBonus = fn
}

const LOBBY_WANT: Want = { hero: 'any' }
const FREE: Want = {}

let joins = 0

export const cast = new Cast<Member>({
  join: ({ player, name, steamId, bot }) => {
    const m: Member = {
      player,
      name,
      steamId,
      bot,
      team: undefined,
      ready: false,
      hero: undefined,
      locked: false,
      seated: false,
      placed: false,
      intro: false,
      askedAt: 0,
      frozen: false,
      want: LOBBY_WANT,
      held: undefined,
      nextCursorCheck: 0,
      joinOrder: ++joins,
    }
    if (M.phase === 'live' || M.phase === 'seating' || M.phase === 'bonus' || M.phase === 'results') {
      m.want = FREE
      if (!bot) player.spectate() // they join at the next team select
    } else if (bot) {
      botJoined(m) // Bots
    }
    // A new player is seated on a hero by Cast in this same frame (LOBBY_WANT), so they skip the game's own
    // hero picker. Don't read their hero here (player.pawn()): that call can take over 100 ms.
    log(`joined: ${name}${bot ? ' (bot)' : ''}`)
    return m
  },
  leave: (m) => log(`left: ${m.name}`),
  want: (m) => m.want,
  bots: 'join', // Bots: bots become members like players
})

export function members(): Member[] {
  return cast.members()
}

/** host is the player who has been here longest (bots never host): they set the match options. */
export function host(): Member | undefined {
  let h: Member | undefined
  for (const m of members()) if (!m.bot && (h === undefined || m.joinOrder < h.joinOrder)) h = m
  return h
}

/** changeSouls moves the souls gain by steps of SOUL_SCALE_STEP, for the host on team select only. */
export function changeSouls(player: Player, steps: number): void {
  if (M.phase !== 'lobby' || cast.get(player) !== host()) return
  M.soulScale = Math.min(SOUL_SCALE_MAX, Math.max(SOUL_SCALE_MIN, M.soulScale + steps * SOUL_SCALE_STEP))
  log(`match: souls gain set to ${Math.round(M.soulScale * 100)}%`)
}

/** changeTickets moves next match's tickets by steps of TICKET_STEP, for the host on team select only. */
export function changeTickets(player: Player, steps: number): void {
  if (M.phase !== 'lobby' || cast.get(player) !== host()) return
  M.startTickets = Math.min(TICKET_MAX, Math.max(TICKET_MIN, M.startTickets + steps * TICKET_STEP))
  log(`match: tickets set to ${M.startTickets}`)
}

/** changeRespawn moves the respawn time along RESPAWN_OPTIONS, for the host on team select only. */
export function changeRespawn(player: Player, steps: number): void {
  if (M.phase !== 'lobby' || cast.get(player) !== host()) return
  M.respawnSeconds = stepOption(RESPAWN_OPTIONS, M.respawnSeconds, steps)
  log(`match: respawn time set to ${M.respawnSeconds} s`)
}

/** changeKnockback moves the heavy melee push by steps of KNOCKBACK_PERCENT_STEP, for the host on team select only. */
export function changeKnockback(player: Player, steps: number): void {
  if (M.phase !== 'lobby' || cast.get(player) !== host()) return
  M.knockback = Math.min(KNOCKBACK_PERCENT_MAX, Math.max(0, M.knockback + steps * KNOCKBACK_PERCENT_STEP))
  log(`match: melee knockback set to ${M.knockback}%`)
}

/** changeBonusRound turns the bonus round on (a step up) or off (a step down), for the host on team select only. */
export function changeBonusRound(player: Player, steps: number): void {
  if (M.phase !== 'lobby' || cast.get(player) !== host()) return
  M.bonusRound = steps > 0
  log(`match: bonus round ${M.bonusRound ? 'on' : 'off'}`)
}

/** changeStartSouls moves the starting souls to the next amount up or down in START_SOULS_OPTIONS (host only). */
export function changeStartSouls(player: Player, steps: number): void {
  const next = steps > 0 ? START_SOULS_OPTIONS.find((n) => n > M.startSouls) : [...START_SOULS_OPTIONS].reverse().find((n) => n < M.startSouls)
  if (next !== undefined) setStartSouls(player, next)
}

/** setStartSouls sets the starting souls (0 to START_SOULS_MAX), for the host on team select only. */
export function setStartSouls(player: Player, souls: number): void {
  if (M.phase !== 'lobby' || cast.get(player) !== host() || !Number.isFinite(souls)) return
  const n = Math.min(START_SOULS_MAX, Math.max(0, Math.round(souls)))
  if (n === M.startSouls) return
  M.startSouls = n
  log(`match: starting souls set to ${M.startSouls}`)
}

/** stepOption moves from value along a list of options by steps, stopping at either end. */
function stepOption(options: readonly number[], value: number, steps: number): number {
  let i = options.indexOf(value)
  if (i < 0) i = 0
  return options[Math.min(options.length - 1, Math.max(0, i + steps))]
}

/** inMatch lists the members playing the match (they have a team and a hero). */
function inMatch(): Member[] {
  return members().filter((m) => m.team !== undefined && m.hero !== undefined && m.locked)
}

/** teamName is the team's short name, for the log only. Players see patronName. */
export function teamName(team: number | undefined): string {
  return team === AMBER ? 'Amber' : team === SAPPHIRE ? 'Sapphire' : 'no team'
}

/** patronName is the team's name as players see it everywhere: its Patron. */
export function patronName(team: number): string {
  return team === AMBER ? 'The Hidden King' : 'The Archmother'
}

export function heroTitle(name: string | undefined): string {
  return heroes.find((h) => h.name === name)?.title ?? 'no hero'
}

export function teamMembers(team: number): Member[] {
  return members().filter((m) => m.team === team)
}

export function secondsUntil(at: number | undefined): number {
  return at === undefined ? 0 : Math.max(0, Math.ceil(at - M.clock))
}

function smallerTeam(): number {
  let amber = 0
  let sapphire = 0
  for (const m of members()) {
    const team = cast.pawn(m.player)?.team
    if (team === AMBER) amber++
    else if (team === SAPPHIRE) sapphire++
  }
  return amber <= sapphire ? AMBER : SAPPHIRE
}

/** randomHero picks a hero nobody on the viewer's team has locked in (any hero without a viewer). */
function randomHero(viewer: Member | undefined): string | undefined {
  const free = heroes.filter((h) => heroTakenBy(h.name, viewer) === undefined)
  const list = free.length > 0 ? free : heroes
  return list[Math.floor(Math.random() * list.length)]?.name
}

/**
 * heroTakenBy returns the viewer's teammate who has locked in a hero, if any. Both teams may play the
 * same hero; only one player per team may. The heroes everyone stands around as in the lobby are
 * placeholders and don't count.
 */
export function heroTakenBy(hero: string, viewer: Member | undefined): Member | undefined {
  if (viewer === undefined || viewer.team === undefined) return undefined
  return members().find((m) => m !== viewer && m.team === viewer.team && m.locked && m.hero === hero)
}

// Each member by their hero's entity, rebuilt every frame from Cast's read of the heroes, so the damage
// handlers (several lookups for every hit) don't search the member list.
const byPawn = new Map<number, Member>()

function indexPawns(): void {
  byPawn.clear()
  for (const m of members()) {
    const entity = cast.pawn(m.player)?.entity
    if (entity !== undefined && !byPawn.has(entity)) byPawn.set(entity, m)
  }
}

/** memberByPawn finds the member whose hero is this entity. */
export function memberByPawn(entity: number): Member | undefined {
  return entity === 0 ? undefined : byPawn.get(entity)
}

// ------------------------------------------------------- modifier states
function holdStates(m: Member, entity: number | undefined, states: readonly string[] | undefined): void {
  if (m.held !== undefined && (m.held.entity !== entity || m.held.states !== states)) {
    for (const s of m.held.states) holdModifierState(m.held.entity, s, false)
    m.held = undefined
  }
  if (entity !== undefined && states !== undefined && m.held === undefined) {
    for (const s of states) holdModifierState(entity, s, true)
    m.held = { entity, states }
  }
}

// A cursor can only be shown to a player with a hero, and a request sent while their game is still
// loading is lost, so this checks once a second and asks again while the cursor should be up.
function keepCursors(): void {
  for (const m of members()) {
    if (m.bot || M.clock < m.nextCursorCheck || cast.pawn(m.player) === undefined) continue
    m.nextCursorCheck = M.clock + 1
    if (cursorFree(m.player) !== true) freeCursor(m.player, true)
  }
}

// The minimap is hidden for everyone: it shows Deadlock's own map, not this arena. A request sent while a
// player's game is still loading is lost, and hide() before a reload drops it, so this asks again every 2 s.
// While M.hudHidden is set, the whole game HUD is hidden instead (the mod's own screen stays).
function keepMinimapHidden(): void {
  if (M.clock < M.nextMinimapHide) return
  M.nextMinimapHide = M.clock + 2
  for (const m of members()) if (!m.bot && cast.pawn(m.player) !== undefined) hideHud(m.player, [M.hudHidden ? 'all' : 'minimap'])
}

/** hideGameHud hides the whole game HUD for everyone, or brings it back (without the minimap), from the next frame. */
export function hideGameHud(hidden: boolean): void {
  M.hudHidden = hidden
  M.nextMinimapHide = 0
}

function holdClock(): void {
  if (M.clock < M.nextClockHold) return
  M.nextClockHold = M.clock + 1
  holdMatchClock(0)
}

// ---------------------------------------------------------------- lobby
export function chooseTeam(player: Player, team: number): void {
  const m = cast.get(player)
  if (m === undefined || M.phase !== 'lobby' || m.team === team) return
  if (teamMembers(team).length >= TEAM_SIZE) return
  m.team = team
  m.ready = false
  putOnGameTeam(m, team)
  cancelCountdown()
}

// The game has its own teams of up to 6 heroes, separate from the teams picked on the screen: a player
// waits on team select on whichever side the game put them. The game refuses a bot on a side it counts as
// full, so a player who picks a team is moved to that side in the game too, and a "+ bot" moves anyone in
// the way who picked the other team or none.

/** gameTeamCount is how many heroes the game has on a team now. */
function gameTeamCount(team: number): number {
  let n = 0
  for (const m of members()) if (cast.pawn(m.player)?.team === team) n++
  return n
}

/** putOnGameTeam moves a player's hero onto that team in the game, at that team's spawn. */
function putOnGameTeam(m: Member, team: number): void {
  const pawn = cast.pawn(m.player)
  if (m.bot || pawn === undefined || pawn.team === team) return
  if (!m.player.changeTeam(team)) {
    log(`match: could not move ${m.name} to ${teamName(team)}`)
    return
  }
  const spawn = SPAWNS[team]
  m.player.teleport({ x: spawn.x, y: spawn.y, z: spawn.z + 8 }, { pitch: 0, yaw: team === AMBER ? 270 : 90, roll: 0 }) // facing the middle of the arena
  log(`match: moved ${m.name} to ${teamName(team)} in the game`)
}

/**
 * makeRoom frees a place on a team in the game for a bot (joining is a place already taken), by moving
 * a player who didn't pick that team to the other side. It reports whether there is room.
 */
export function makeRoom(team: number, joining: number): boolean {
  if (gameTeamCount(team) + joining < TEAM_SIZE) return true
  const other = team === AMBER ? SAPPHIRE : AMBER
  for (const m of members()) {
    if (m.bot || m.team === team || cast.pawn(m.player)?.team !== team) continue
    if (gameTeamCount(other) >= TEAM_SIZE) return false
    putOnGameTeam(m, other)
    return true
  }
  return false
}

export function toggleReady(player: Player): void {
  const m = cast.get(player)
  if (m === undefined || m.team === undefined || M.phase !== 'lobby') return
  m.ready = !m.ready
  if (!m.ready) cancelCountdown()
}

function cancelCountdown(): void {
  M.countdownAt = undefined
}

export function readyCount(): { ready: number; total: number } {
  const all = members()
  return { ready: all.filter((m) => m.ready).length, total: all.length }
}

/** lobbyProblem says why the hero pick cannot start yet, or undefined when it can. */
export function lobbyProblem(): string | undefined {
  const all = members()
  if (all.length === 0) return 'Waiting for players'
  const noTeam = all.filter((m) => m.team === undefined)
  if (noTeam.length > 0) return `Waiting for ${noTeam.map((m) => m.name).join(', ')} to pick a team`
  const notReady = all.filter((m) => !m.ready)
  if (notReady.length > 0) return `Waiting for ${notReady.map((m) => m.name).join(', ')} to ready up`
  for (const team of [AMBER, SAPPHIRE]) {
    if (teamMembers(team).length === 0) return `${patronName(team)} needs at least one player (or add a bot)`
  }
  return undefined
}

// --------------------------------------------------------------- heroes
// Everyone picks at once. The same hero can be on both teams (citadel_allow_duplicate_heroes), but not
// twice on one team: a hero a teammate has locked in is taken. When the time runs out, anyone not locked
// in gets the hero they had selected if it is still free on their team, or else a random free one.
// Bots pick once every player has locked in, one after another: a bot keeps the hero it has if no
// teammate took it, and is otherwise replaced by a bot on a free hero (Modlock can't change a bot's hero).
export function pickTimeLeft(): number {
  return secondsUntil(M.pickEndsAt)
}

/** allowDuplicateHeroes lets both teams play the same hero. The game can reset it, so it is set often. */
export function allowDuplicateHeroes(): void {
  serverCommand('citadel_allow_duplicate_heroes true')
}

function startHeroSelect(): void {
  M.phase = 'heroes'
  M.countdownAt = undefined
  M.pickEndsAt = M.clock + PICK_SECONDS
  M.allPickedAt = undefined
  M.botPicksFrom = undefined
  allowDuplicateHeroes()
  for (const m of members()) {
    m.hero = undefined
    m.locked = false
  }
  for (const m of members()) {
    if (!m.bot && m.team !== undefined) m.player.announce('PICK YOUR HERO', `${PICK_SECONDS} seconds. No hero twice on your team.`)
  }
  log('match: hero pick')
}

/** pickHero selects a hero (not locked yet). A hero a teammate has locked in can't be selected. */
export function pickHero(player: Player, hero: string): void {
  const m = cast.get(player)
  if (m === undefined || M.phase !== 'heroes' || m.team === undefined || m.locked) return
  if (!heroes.some((h) => h.name === hero) || heroTakenBy(hero, m) !== undefined) return
  m.hero = hero
}

export function lockIn(player: Player): void {
  const m = cast.get(player)
  if (m === undefined || M.phase !== 'heroes' || m.team === undefined || m.locked || m.hero === undefined) return
  lockPick(m)
}

/** heroNameOf is the name of the hero the member plays now, if any. */
function heroNameOf(m: Member): string | undefined {
  const id = cast.pawn(m.player)?.hero
  return id === undefined || id === 0 ? undefined : heroes.find((h) => h.id === id)?.name
}

function lockPick(m: Member): void {
  if (m.bot) {
    // Bots: the hero it has (or was re-added on) is its pick, unless a teammate took it: then a new bot
    // on a free hero replaces it, and locks in when it joins.
    m.hero = heroNameOf(m) ?? m.hero
    if (m.hero === undefined || heroTakenBy(m.hero, m) !== undefined) {
      const free = randomHero(m)
      if (free !== undefined) {
        replaceBot(m, free)
        return
      }
    }
  } else if (m.hero === undefined || heroTakenBy(m.hero, m) !== undefined) {
    m.hero = randomHero(m)
  }
  m.locked = m.hero !== undefined
  log(`match: ${m.name} locked in ${heroTitle(m.hero)} (${teamName(m.team)})`)
  // A teammate who had only selected this hero loses the selection.
  for (const o of members()) {
    if (o !== m && o.team === m.team && !o.locked && o.hero === m.hero) o.hero = undefined
  }
}

function heroesTick(): void {
  const picking = members().filter((m) => m.team !== undefined)
  if (picking.length === 0) {
    resetToLobby('Everyone left hero select.')
    return
  }
  if (M.allPickedAt === undefined) {
    if (M.clock >= M.pickEndsAt) {
      for (const m of picking) {
        if (m.locked || m.bot) continue
        lockPick(m) // the selected hero if still free on the team, or a random one
      }
    }
    if (!picking.every((m) => m.locked || m.bot)) return
    // Bots: every player is in, so the bots pick, one every BOT_PICK_GAP. A replacement that never
    // joins is not waited for beyond BOT_PICK_LIMIT.
    M.botPicksFrom ??= M.clock
    const waited = M.clock - M.botPicksFrom > BOT_PICK_LIMIT
    botsTick()
    if (botsJoining() > 0 && !waited) return
    const bot = picking.find((m) => m.bot && !m.locked)
    if (bot !== undefined && waited) {
      for (const b of picking) if (b.bot && !b.locked) b.locked = (b.hero = heroNameOf(b) ?? b.hero) !== undefined
      log('match: the bots took too long to pick; going on with the heroes they have')
    } else if (bot !== undefined) {
      if (M.clock >= M.nextBotPick) {
        M.nextBotPick = M.clock + BOT_PICK_GAP
        lockPick(bot)
      }
      return
    }
    M.allPickedAt = M.clock
    return
  }
  if (M.clock - M.allPickedAt >= PICKED_COUNTDOWN) startSeating()
}

// -------------------------------------------------------------- seating
// Everyone in the match is put on their pick (on this map, without a reload), moved to their spawn
// and frozen, with the game's HUD hidden and their camera held on a view from above the arena. The clock
// stays at 0:00 until the last one is in; INTRO_SECONDS later the cameras and the HUD come back and the
// screen (hud.tsx) counts down to GO!
function startSeating(): void {
  M.phase = 'seating'
  allowDuplicateHeroes()
  M.seatUntil = M.clock + SEAT_SECONDS
  M.introEnds = undefined
  M.counting = false
  M.goAt = undefined
  hideGameHud(true)
  for (const m of members()) {
    cleanUpScreens(m)
    m.seated = false
    m.placed = false
    m.intro = false
    if (m.team === undefined || m.hero === undefined) {
      m.want = FREE
      if (!m.bot) m.player.spectate()
      continue
    }
    m.want = FREE // until their pick shows, so Cast never seats a random hero
    m.askedAt = M.clock
    if (!m.bot) m.player.selectHero(m.hero, m.team) // bots keep their hero (seatedOnPick)
  }
  log('match: seating everyone on their picks')
}

function seatedOnPick(m: Member): Pawn | undefined {
  const pawn = cast.pawn(m.player)
  if (m.bot) {
    // A bot is seated on whatever hero it has, on its team.
    if (pawn === undefined || pawn.hero === 0 || pawn.team !== m.team || pawn.health <= 0) return undefined
    m.hero = heroNameOf(m) ?? m.hero
    return pawn
  }
  const id = heroes.find((h) => h.name === m.hero)?.id
  return pawn !== undefined && pawn.hero !== 0 && (id === undefined || pawn.hero === id) && pawn.team === m.team && pawn.health > 0
    ? pawn
    : undefined
}

function seatingTick(): void {
  holdClock()
  const players = inMatch()
  for (const m of players) {
    const pawn = seatedOnPick(m)
    if (pawn === undefined) {
      if (!m.seated && !m.bot && M.clock - m.askedAt > SEAT_RETRY) {
        m.askedAt = M.clock // a request can be lost: ask again
        m.player.selectHero(m.hero!, m.team!)
        log(`match: asking again for ${m.name}'s hero`)
      }
      continue
    }
    if (!m.seated) {
      m.seated = true
      m.want = { hero: 'any', team: m.team, respawn: M.respawnSeconds } // keep this hero and team from now on
      log(`match: ${m.name} is on ${heroTitle(m.hero)}`)
    }
    const yaw = m.team === AMBER ? 270 : 90 // facing the middle of the arena
    if (!m.placed) {
      const spawn = SPAWNS[m.team!]
      const i = teamMembers(m.team!).indexOf(m)
      const x = spawn.x + (i - 2.5) * 140
      // Looking down while the view from above is up (the camera looks the way the hero does), level after.
      m.placed = m.player.teleport({ x, y: spawn.y, z: spawn.z + 8 }, { pitch: M.counting ? 0 : INTRO_SHOT.pitch, yaw, roll: 0 })
    }
    if (!m.frozen) m.frozen = m.player.freeze(true)
    if (!m.intro && !m.bot && m.placed && !M.counting) {
      m.intro = shoot(m.player, CENTRE, INTRO_SHOT.distance, SEAT_SECONDS + INTRO_SECONDS + 5, { pitch: INTRO_SHOT.pitch, yaw })
    }
  }
  if (M.goAt === undefined) {
    const waiting = players.filter((m) => !m.seated || !m.placed)
    if (waiting.length > 0 && M.clock < M.seatUntil) return
    if (waiting.length > 0) log(`match: starting without ${waiting.map((m) => m.name).join(', ')} on their pick`)
    if (!players.some((m) => m.seated)) {
      resetToLobby('Nobody made it onto their hero.')
      return
    }
    M.introEnds = M.clock + INTRO_SECONDS
    M.goAt = M.introEnds + GO_COUNTDOWN
  }
  if (!M.counting && M.clock >= M.introEnds!) startCountdown(players)
  if (M.clock >= M.goAt) go()
}

// The view from above ends: every camera is back on its hero, looking level at the arena, and the HUD returns.
function startCountdown(players: Member[]): void {
  M.counting = true
  hideGameHud(false)
  for (const m of players) {
    if (!m.bot) cutShot(m.player)
    m.intro = false
    const pawn = cast.pawn(m.player)
    if (pawn === undefined || !m.placed) continue
    if (m.frozen) m.player.freeze(false)
    m.player.teleport(pawn.position, { pitch: 0, yaw: m.team === AMBER ? 270 : 90, roll: 0 }, { x: 0, y: 0, z: 0 })
    m.frozen = m.player.freeze(true)
  }
}

function go(): void {
  M.phase = 'live'
  M.goAt = undefined
  M.liveAt = M.clock
  hideGameHud(false)
  setRespawnTime(M.respawnSeconds)
  unlockItemSlots()
  holdMatchClock() // the clock runs from 0:00
  if (BOT_AI && members().some((m) => m.bot)) serverCommand('citadel_solo_bot_match true') // Bots
  for (const m of members()) {
    holdStates(m, undefined, undefined)
    if (!m.bot) cutShot(m.player)
    if (m.frozen) m.player.freeze(false)
    m.frozen = false
    if (m.seated) setSouls(m, M.startSouls)
  }
  log('match: live')
  onGo?.()
}

/** setSouls gives or takes souls so the member's hero holds exactly this many. */
function setSouls(m: Member, souls: number): void {
  const held = cast.pawn(m.player)?.souls
  if (held === undefined) return
  const change = souls - held
  if (change === 0) return
  if (m.player.adjustSouls(change, change < 0)) log(`match: ${m.name} starts with ${souls} souls (had ${held})`)
  else log(`match: could not set ${m.name}'s starting souls (${held} to ${souls})`)
}

/**
 * unlockItemSlots opens every item slot for both teams. Normally the last three (the flex slots) open as
 * the enemy Walkers fall, and this map has none to kill.
 */
function unlockItemSlots(): void {
  if (!serverCommand('citadel_unlock_flex_slots')) log('match: the game refused citadel_unlock_flex_slots')
}

/** setRespawnTime sets every respawn the game gives, all match long, to the same seconds. */
export function setRespawnTime(seconds: number): void {
  for (const ramp of ['min_ramp_1', 'min_ramp_2', 'min_ramp_3', 'max_ramp_1', 'max_ramp_2', 'max_ramp_3', 'max_respawn_time']) {
    serverCommand(`citadel_player_spawn_time_${ramp} ${seconds}`)
  }
}

// --------------------------------------------------------------- results
/** endMatch settles the winner, then plays the bonus round (when it is on) or goes straight to the results. */
export function endMatch(winner: number): void {
  if (M.phase !== 'live') return
  M.winner = winner
  M.bonusWinner = undefined
  onEnd?.()
  log(`match: ${teamName(winner)} wins`)
  if (M.bonusRound && onBonus?.() === true) {
    M.phase = 'bonus'
    return
  }
  showResults(true)
}

/** showResults freezes everyone on the results card, then the map reloads into a fresh lobby. */
export function showResults(announce: boolean): void {
  M.phase = 'results'
  const winner = M.winner ?? AMBER
  M.resultsEnd = M.clock + RESULTS_SECONDS
  for (const m of members()) {
    m.frozen = m.player.freeze(true)
    if (m.bot || !announce) continue
    m.player.announce(m.team === winner ? 'VICTORY' : m.team === undefined ? `${patronName(winner).toUpperCase()} WINS` : 'DEFEAT',
      `${patronName(winner)} drained the enemy tickets.`)
  }
}

/** everyoneLeft sends the game back to team select when no player is left on a team (only bots). */
function everyoneLeft(): boolean {
  if (M.reloading || members().some((m) => !m.bot && m.team !== undefined)) return false
  backToLobby('Every player left.')
  return true
}

function resultsTick(): void {
  if (M.clock >= M.resultsEnd && !M.reloading) backToLobby('Match over.')
}

// ---------------------------------------------------------------- lobby again
function cleanUpScreens(m: Member): void {
  holdStates(m, undefined, undefined)
  if (m.bot) return
  releaseCamera(m.player)
  cutShot(m.player)
  freeCursor(m.player, false)
}

/** backToLobby ends the match and reloads the map, so the next match starts fresh. */
function backToLobby(why: string): void {
  onEnd?.()
  for (const m of members()) {
    cleanUpScreens(m)
    if (!m.bot) hide(m.player) // the screen is drawn again from nothing on the new map
    if (m.frozen) m.player.freeze(false)
    m.frozen = false
    if (m.bot) m.player.removeBot() // Bots
  }
  if (BOT_AI) serverCommand('citadel_solo_bot_match false') // Bots
  M.reloading = true
  log(`match: back to lobby (${why}), reloading ${MAP}`)
  run('changelevel', MAP) // world() then opens the lobby
}

/** world is called when a map loads. */
export function world(): void {
  camerasReset()
  shotsReset()
  for (const m of members()) {
    m.held = undefined // the old heroes are gone
    m.nextCursorCheck = 0
  }
  resetToLobby(undefined)
}

function resetToLobby(why: string | undefined): void {
  if (why !== undefined) log(`match: ${why}`)
  M.phase = 'lobby'
  M.countdownAt = undefined
  M.goAt = undefined
  M.introEnds = undefined
  M.counting = false
  M.winner = undefined
  M.bonusWinner = undefined
  M.hudHidden = false
  M.reloading = false
  M.nextClockHold = 0
  botsReset() // Bots
  setRespawnTime(3)
  for (const m of members()) {
    m.team = undefined
    m.ready = false
    m.hero = undefined
    m.locked = false
    m.seated = false
    m.placed = false
    if (m.frozen) m.player.freeze(false)
    m.frozen = false
    m.want = LOBBY_WANT
    if (!m.bot && cast.pawn(m.player) === undefined) {
      const hero = randomHero(undefined)
      if (hero !== undefined) m.player.selectHero(hero, smallerTeam())
    }
  }
  log('match: lobby')
}

// ---------------------------------------------------------------- frames
export function frame(gameTime: number): void {
  const dt = M.lastFrame === undefined ? 0 : Math.min(0.25, Math.max(0, gameTime - M.lastFrame))
  M.lastFrame = gameTime
  M.clock += dt
  cast.frame(gameTime)
  indexPawns()
  if (!M.reloading) keepMinimapHidden()

  if (M.phase === 'lobby' || M.phase === 'heroes') {
    holdClock()
    keepCursors()
    for (const m of members()) {
      const pawn = cast.pawn(m.player)
      holdStates(m, pawn?.entity, LOBBY_STATES)
      if (pawn !== undefined && !m.bot) lobbyCamera(m.player, pawn, m.team ?? pawn.team)
    }
  }

  switch (M.phase) {
    case 'lobby':
      if (lobbyProblem() !== undefined) M.countdownAt = undefined
      else if (M.countdownAt === undefined) M.countdownAt = M.clock + TEAM_COUNTDOWN
      else if (M.clock >= M.countdownAt) startHeroSelect()
      return
    case 'heroes':
      heroesTick()
      return
    case 'seating':
      if (!everyoneLeft()) seatingTick()
      return
    case 'live':
    case 'bonus':
      everyoneLeft()
      return
    case 'results':
      resultsTick()
      return
  }
}
