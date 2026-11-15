// Portal looks: the Unstable Rift ("koth" in the game files) at each portal, at 3x the game's size.
// Looks only: minions still go in by distance (PORTAL_REACH in minions.ts).
//
// The effects are our copies of the Rift's look pieces, compiled from the sources in tools/rift/src
// (tools/compile_rift.cmd) into content/particles/, which the build ships to every player as the mod's
// own addon. Each piece is played on its own, so the copies have no child effects.
// The game's own Rift objective is turned off: the map has no spot for it, so it showed in the middle.

import { createParticle, entityPosition, fireInput, findEntities, log, serverCommand, type Vector, type WorldObject } from 'modlock'
import { RIFT_FORWARD, RIFT_HEIGHT } from './config'
import { PORTALS } from './layout'

export const RIFT_PARTICLES = [
  'particles/{addon}/rift_portal_model.vpcf', // the upright portal shape
  'particles/{addon}/rift_outline.vpcf', // the glowing jagged edge
  'particles/{addon}/rift_outline_edge.vpcf',
  'particles/{addon}/rift_sparks.vpcf',
  'particles/{addon}/rift_dimension.vpcf', // the star field
  'particles/{addon}/rift_decal_edge.vpcf', // the glowing outline on the ground
  'particles/{addon}/rift_light.vpcf', // its light
]
export const RIFT_MODELS = ['models/particle/koth_rift_model_fx.vmdl']

// The ground outline draws at the effect's own position, on the floor. The rift itself draws at control
// point 10, which the game's Rift sets to its own spot (unset, it sits at the map's 0,0,0), so each piece
// sets it to the rift's middle. The pieces are left unturned: turned, the star field stood out of the wall.
const RIFT_POINT = 10

interface Piece {
  resource: string
  position: Vector
  middle: Vector
}

let placed: WorldObject[] = []
let queue: Piece[] = [] // pieces still to play, one per frame: a particle can take over 100 ms to create

/** riftsReset forgets the last map's effects, which went with it. Call when a map loads. */
export function riftsReset(): void {
  placed = []
  queue = []
}

/** placeRifts queues the rift at both portals; riftsTick plays it. Call once the map has loaded. */
export function placeRifts(): void {
  for (const o of placed) o.remove()
  placed = []
  queue = []
  for (const portal of Object.values(PORTALS)) {
    const into = portal.y > 0 ? -1 : 1 // toward the middle of the arena
    const position = { x: portal.x, y: portal.y + into * RIFT_FORWARD, z: portal.z }
    const middle = { ...position, z: position.z + RIFT_HEIGHT }
    for (const resource of RIFT_PARTICLES) queue.push({ resource, position, middle })
  }
}

/** riftsTick plays one queued piece. Call every frame. */
export function riftsTick(): void {
  const piece = queue.shift()
  if (piece === undefined) return
  const o = createParticle({ resource: piece.resource, position: piece.position, point: { index: RIFT_POINT, position: piece.middle } })
  if (o !== undefined) placed.push(o)
  else log(`rift: ${piece.resource} did not start`)
}

/** gameRiftOff turns the game's own Rift objective off and removes any already placed. Call once the map has loaded. */
export function gameRiftOff(): void {
  serverCommand('citadel_koth_enabled false')
  for (const cls of ['citadel_item_koth_spawner', 'info_koth_spawn_location']) {
    for (const e of findEntities(cls)) {
      const at = entityPosition(e)?.position
      log(`rift: removed the game's ${cls}${at === undefined ? '' : ` at (${Math.round(at.x)}, ${Math.round(at.y)})`}`)
      fireInput(e, 'Kill')
    }
  }
}
