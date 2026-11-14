// Bots: test bots added from the lobby's "+ bot" buttons.
//
// To remove bots from the mod later: delete this file, then delete every line
// (or block) marked "Bots" in match.ts and hud.tsx.
//
// A bot joins the team it was added for and is always ready. The hero it is added
// with is only a placeholder, as the players' heroes on team select are: bots pick
// after every player has locked in (match.ts). Modlock can't change a bot's hero,
// so a bot whose hero a teammate took is replaced by a new bot of the same name on
// a free hero (replaceBot). The game's bot AI plays it (BOT_AI in config.ts).
import { addBot, heroes, log } from 'modlock'

import { AMBER, cast, M, makeRoom, type Member, patronName, SAPPHIRE, TEAM_SIZE, teamMembers, teamName } from './match'

const pending = new Map<string, number>() // bot name -> the team it was added for
const picks = new Map<string, string>() // bot name -> the hero it was re-added on, which is its pick
let queued: { name: string; team: number; hero: string; at: number }[] = [] // bots to add again, once their old one is gone
const READD_AFTER = 0.5 // seconds between removing a bot and adding its replacement
const pendingHeroes = new Set<number>() // heroes of bots still joining
let counter = 0

/** addTestBot adds a bot to a team from the lobby's "+ bot" button. */
export function addTestBot(team: number): void {
  if (teamMembers(team).length + countPending(team) >= TEAM_SIZE) return
  if (!makeRoom(team, countPending(team))) {
    log(`bots: no room on ${teamName(team)} in the game`)
    return
  }
  counter++
  const name = `${patronName(team).replace(/^The /, '')} Bot ${counter}` // players see bot names
  // A hero nobody on this team plays (or is being added with), since a bot can't change hero later.
  const used = new Set<number>()
  for (const m of teamMembers(team)) {
    const id = cast.pawn(m.player)?.hero
    if (id !== undefined && id !== 0) used.add(id)
  }
  for (const h of pendingHeroes) used.add(h) // bots added a moment ago may not have a hero yet
  const free = heroes.filter((h) => !used.has(h.id))
  const hero = (free.length > 0 ? free : heroes)[Math.floor(Math.random() * (free.length > 0 ? free : heroes).length)]
  if (hero !== undefined) pendingHeroes.add(hero.id)
  pending.set(name, team)
  if (addBot({ name, team, hero: hero?.name }) === undefined) {
    pending.delete(name)
    log(`bots: could not add ${name}`)
    return
  }
  log(`bots: added ${name} to ${teamName(team)}`)
}

function countPending(team: number): number {
  let n = 0
  for (const t of pending.values()) if (t === team) n++
  return n
}

/** botJoined gives a bot the team it was added for and readies it. */
export function botJoined(m: Member): void {
  // A bot the lobby did not add (such as one from the console) joins the emptier side.
  m.team = pending.get(m.name) ?? (teamMembers(AMBER).length <= teamMembers(SAPPHIRE).length ? AMBER : SAPPHIRE)
  m.ready = true
  m.hero = picks.get(m.name)
  pending.delete(m.name)
  picks.delete(m.name)
}

/** replaceBot swaps a bot for a new one of the same name and team on another hero, which joins a moment later. */
export function replaceBot(m: Member, hero: string): void {
  if (!m.bot || m.team === undefined) return
  queued.push({ name: m.name, team: m.team, hero, at: M.clock + READD_AFTER })
  log(`bots: ${m.name} is coming back on ${hero}`)
  m.team = undefined // out of the pick until the game drops it
  m.player.removeBot()
}

/** botsJoining is how many replacement bots are still on their way. */
export function botsJoining(): number {
  return queued.length + picks.size
}

/** botsTick adds the replacement bots that are due. Call every frame during the hero pick. */
export function botsTick(): void {
  if (queued.length === 0 || M.clock < queued[0].at) return
  const next = queued.shift()!
  pending.set(next.name, next.team)
  picks.set(next.name, next.hero)
  if (addBot({ name: next.name, team: next.team, hero: next.hero }) === undefined) {
    pending.delete(next.name)
    picks.delete(next.name)
    log(`bots: could not add ${next.name} again`)
  }
}

/** removeTestBot takes a bot out from the lobby's "×" button. */
export function removeTestBot(m: Member): void {
  if (!m.bot) return
  m.player.removeBot()
  log(`bots: removed ${m.name}`)
}

/** botsReset forgets bots that were still joining when the map changed. */
export function botsReset(): void {
  pending.clear()
  pendingHeroes.clear()
  picks.clear()
  queued = []
}
