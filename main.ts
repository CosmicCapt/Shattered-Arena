// Shattered Arena: Deadlock's take on SMITE's Corrupted Arena, on the custom map hl_arena_pit (mod.json).
// Two teams with the same tickets (the host sets how many); the first at 0 loses. Tickets are lost when
// a hero dies (pits too), a minion dies, or an enemy minion walks into your portal (amounts in config.ts).
//
// Files:
//   config.ts     every setting           layout.ts   map positions (generated with the map)
//   match.ts      team select, hero pick, seating, match, results (all on one map)
//   tickets.ts    tickets, hero deaths, pit kills and their credit
//   souls.ts      minion and kill souls shared by the whole team
//   stats.ts      each player's kills, deaths, pit throws and more, for the results card
//   minions.ts    minion waves walked along their routes, minion deaths, portal entries
//   base.ts       bases heal your team and burn enemies; the Walkers can't be destroyed
//   camps.ts      camps and their bridge buffs
//   knockback.ts  an enemy's heavy melee pushes you back
//   bonus.ts      the bonus round on its own platform, after a match is won
//   shops.ts      shop models and shop zones
//   rift.ts       the portals' look: the Unstable Rift at 3x
//   lockdown.ts   no cheats and no hero swaps (console and pause menu)
//   hud.tsx       team select, hero pick, ticket strip, results
//   lobbycam.ts   the camera over the arena behind team select
//   bots.ts       test bots from team select (lines marked "Bots" elsewhere)
//   content/      the mod's own effects (the Rift copies), shipped to every player
//   tools/        make and compile the map and the Rift effects (tools/README.md)
import { log, onDamage, onDamaged, onFrame, onInput, onStart, onWorld, precache, serverCommand } from 'modlock'

import { baseTick, towerDamage, towersReset, towersTick } from './base'
import { drawAll } from './hud'
import { MAP } from './layout'
import { allowDuplicateHeroes, cast, frame as matchFrame, M, members, whenBonus, whenLive, whenOver, world as matchWorld } from './match'
import { minionDamaged, minionsStart, minionTick, RIFT_MINION_EFFECT, stopMinions } from './minions'
import { loadShopZones, placeShops, SHOP_MODEL, shopTick } from './shops'
import { soulsDamaged, soulsStart, soulsTick } from './souls'
import { statsEnd, statsStart } from './stats'
import { ticketsDamaged, ticketsReset, ticketsTick } from './tickets'
import { BUFF_MODELS, BUFF_PARTICLES, campsHold, campsPrepare, campsStart, campsStop, campsTick } from './camps'
import { knockbackDamage, knockbackInput, knockbackReset, knockbackTick, knockbackWatch } from './knockback'
import { bonusReset, bonusStart, bonusTick } from './bonus'
import { holdShots } from './cinema'
import { PATRON_MODELS, patronsReset, placePatrons } from './patrons'
import { gameRiftOff, placeRifts, RIFT_MODELS, RIFT_PARTICLES, riftsReset, riftsTick } from './rift'
import { cheatsOff, lockdownStart, lockdownTick } from './lockdown'

let mapName = ''
let worldStart: number | undefined // game time of the first frame on this map
let ready = false // the map's entities are set up
let nextHud = 0

onStart(() => {
  precache({ resources: [SHOP_MODEL, ...BUFF_MODELS] })
  // Separate call, so a refused particle can't stop the models loading.
  if (!precache({ resources: BUFF_PARTICLES })) log('precache refused the bridge buff effects')
  if (!precache({ resources: [...RIFT_MODELS, ...RIFT_PARTICLES] })) log('precache refused the rift effects')
  if (!precache({ resources: Object.values(PATRON_MODELS) })) log('precache refused the Patron models')
  if (!precache({ resources: [RIFT_MINION_EFFECT] })) log('precache refused the rift minion effect')
  knockbackWatch() // the melee key, to tell heavy melee from light
  lockdownStart() // no cheats or hero swaps
})

onWorld((map) => {
  mapName = map
  cheatsOff() // before the mod changes any setting: turning cheats off resets the cheat-protected ones
  worldStart = undefined
  ready = false
  stopMinions()
  towersReset()
  knockbackReset()
  riftsReset()
  patronsReset()
  bonusReset()
  matchWorld()
  log(`world loaded: ${map}${map === MAP ? '' : ` (expected ${MAP}: set "map" in mod.json)`}`)
})

whenLive(() => {
  ticketsReset()
  statsStart()
  soulsStart()
  minionsStart()
  campsStart()
})
whenBonus(bonusStart)
whenOver(() => {
  statsEnd() // for the results card
  stopMinions()
  campsStop()
})

onDamage((hit) => {
  knockbackDamage(hit)
  return towerDamage(hit)
})
onDamaged((hit) => {
  ticketsDamaged(hit)
  minionDamaged(hit)
  soulsDamaged(hit)
})
onInput((player, pressed, released) => knockbackInput(player, pressed, released))

onFrame((f) => {
  if (worldStart === undefined || f.timeSeconds < worldStart) worldStart = f.timeSeconds
  if (!ready && f.timeSeconds - worldStart > 3) {
    ready = true // give the map a moment to settle
    serverCommand('citadel_trooper_spawn_enabled true') // the mod's minions are troopers
    serverCommand('citadel_npc_spawn_enabled true')
    allowDuplicateHeroes() // both teams may play the same hero
    if (mapName === MAP) {
      placeShops()
      loadShopZones()
      gameRiftOff() // the game's own Rift objective has no place here
      placeRifts() // the portals' look, played one piece a frame by riftsTick
      placePatrons() // the Patrons over the spawns
      campsHold() // no camps in team select; they spawn when the match starts
    }
  }
  matchFrame(f.timeSeconds)
  lockdownTick(M.clock)
  holdShots(members().filter((m) => !m.bot).map((m) => m.player), (p) => cast.pawn(p))
  if (ready && M.phase === 'live') {
    ticketsTick()
    soulsTick()
    knockbackTick()
    campsTick()
    minionTick()
    baseTick()
  }
  if (ready && M.phase === 'bonus') {
    knockbackTick()
    bonusTick()
  }
  // Camp spawners are made during the hero pick and seating: a slow frame there isn't felt.
  if (ready && (M.phase === 'heroes' || M.phase === 'seating')) campsPrepare()
  if (ready) riftsTick()
  if (ready && f.tick % 8n === 0n) shopTick()
  if (ready) towersTick(f.timeSeconds)
  if (f.timeSeconds >= nextHud || f.timeSeconds < nextHud - 1) {
    nextHud = f.timeSeconds + 0.25 // redraw 4 times a second (only changes are sent)
    drawAll()
  }
})
