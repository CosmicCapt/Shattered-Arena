// The two Patrons, floating above their team's spawn as decoration: The Hidden King (Amber, +Y) and The
// Archmother (Sapphire, -Y), from the game's own Patron models. Plain prop_dynamic entities with their
// collision turned off: no health and no health bar, nothing can hit or kill them or bump into them.
import { createEntity, fireInput, log, removeEntity, type Vector } from 'modlock'
import { BONUS_PATRON_BACK, BONUS_PATRON_HEIGHT, PATRON_FORWARD, PATRON_HEIGHT, PATRON_SCALE } from '../config'
import { BONUS, SPAWNS } from './layout'

const AMBER = 2
const SAPPHIRE = 3
export const PATRON_MODELS: Record<number, string> = {
  [AMBER]: 'models/npc/patron_amber/patron_amber.vmdl', // The Hidden King
  [SAPPHIRE]: 'models/npc/patron_sapphire/patron_sapphire.vmdl', // The Archmother
}
const NEUTRAL = 4
const NOT_SOLID = 0

let placed: number[] = []

/** patronsReset forgets the last map's Patrons, which went with it. Call when a map loads. */
export function patronsReset(): void {
  placed = []
}

/** placePatrons puts each Patron above its team's spawn, facing the middle of the arena. Call once the map has loaded. */
/** patronSpot is where a team's Patron hovers in the arena: over its spawn, a little toward the middle. */
export function patronSpot(team: number): Vector {
  const spawn = SPAWNS[team]
  return { x: spawn.x, y: spawn.y - Math.sign(spawn.y) * PATRON_FORWARD, z: PATRON_HEIGHT }
}

export function placePatrons(): void {
  for (const e of placed) removeEntity(e)
  placed = []
  for (const team of [AMBER, SAPPHIRE]) {
    const spot = patronSpot(team)
    place(team, spot, spot.y > 0 ? 270 : 90)
    // The bonus arena's pair hover low over its pit, behind each team's half of the platform.
    const side = Math.sign(BONUS.spawns[team][0].y - BONUS.centre.y)
    place(team, { x: BONUS.centre.x, y: BONUS.centre.y + side * BONUS_PATRON_BACK, z: BONUS_PATRON_HEIGHT }, side > 0 ? 270 : 90)
  }
  log(`patrons placed: ${placed.length}`)
}

// One Patron, facing yaw (toward the middle of its arena).
function place(team: number, position: Vector, yaw: number): void {
  const e = createEntity({
    designerName: 'prop_dynamic', subclass: '', team: NEUTRAL, position,
    facing: { pitch: 0, yaw, roll: 0 },
    transmitAlways: true, // seen from across the arena
    keyValues: [
      { key: 'model', value: { text: PATRON_MODELS[team] } },
      { key: 'solid', value: { integer: NOT_SOLID } },
      { key: 'modelscale', value: { number: PATRON_SCALE } },
    ],
  })
  if (e === undefined) { log(`patrons: the game refused the ${team === AMBER ? 'Hidden King' : 'Archmother'}`); return }
  // The solid key value alone left the Hidden King's collision on: an invisible wall in front of the
  // Amber shop. DisableCollision turns it off for good.
  if (!fireInput(e, 'DisableCollision')) log(`patrons: the ${team === AMBER ? 'Hidden King' : 'Archmother'} refused DisableCollision`)
  placed.push(e)
}
