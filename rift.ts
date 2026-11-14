// Portal looks: the Unstable Rift ("koth" in the game files) at each portal, at 3x the game's size.
// Looks only: minions still go in by distance (PORTAL_REACH in minions.ts).
//
// The effects are our copies of the Rift's look pieces (tools/rift/make_rift_vpcf.py), compiled with
// tools/compile_rift.cmd and packed into maps/hl_arena_pit.vpk under the map's own folder (modlock publish
// lets a map hold only its own files), so they ship with the map. A map recompile leaves them out until
// they are packed in again (tools/rift/vpkpack.py).
// The game's own Rift objective is turned off: the map has no spot for it, so it showed in the middle.

import { createEntity, entityPosition, fireInput, findEntities, log, removeEntity, serverCommand } from 'modlock'
import { RIFT_FORWARD, RIFT_HEIGHT } from './config'
import { PORTALS } from './layout'

export const RIFT_PARTICLES = [
  'maps/hl_arena_pit/particles/rift_portal_model.vpcf', // the upright portal shape
  'maps/hl_arena_pit/particles/rift_outline.vpcf', // the glowing jagged edge (its sparks are a child effect)
  'maps/hl_arena_pit/particles/rift_outline_edge.vpcf',
  'maps/hl_arena_pit/particles/rift_sparks.vpcf',
  'maps/hl_arena_pit/particles/rift_dimension.vpcf', // the star field
  'maps/hl_arena_pit/particles/rift_decal_edge.vpcf', // the glowing outline on the ground
  'maps/hl_arena_pit/particles/rift_light.vpcf', // its light
]
export const RIFT_MODELS = ['models/particle/koth_rift_model_fx.vmdl']

// createParticle only plays particles/*.vpcf, and a map may only hold files in its own folder, so the
// rift is played the way a map plays effects: an info_particle_system per piece. The ground outline draws
// at the entity's own position, on the floor. The rift itself draws at control point 10, which the game's
// Rift sets to its own spot (unset, it sits at the map's 0,0,0), so each piece sets it to the rift's
// middle (data_cp). The pieces are left unturned: turned, the star field stood out of the wall.
const RIFT_POINT = 10
const NEUTRAL = 4
const NO_SUBCLASS = '' // plain map entities have no game data entry

let placed: number[] = []

/** riftsReset forgets the last map's effects, which went with it. Call when a map loads. */
export function riftsReset(): void {
  placed = []
}

/** placeRifts plays the rift at both portals. Call once the map has loaded. */
export function placeRifts(): void {
  for (const e of placed) removeEntity(e)
  placed = []
  for (const portal of Object.values(PORTALS)) {
    const into = portal.y > 0 ? -1 : 1 // toward the middle of the arena
    const position = { x: portal.x, y: portal.y + into * RIFT_FORWARD, z: portal.z }
    const middle = { ...position, z: position.z + RIFT_HEIGHT }
    for (const effect of RIFT_PARTICLES) {
      const e = createEntity({
        designerName: 'info_particle_system', subclass: NO_SUBCLASS, team: NEUTRAL, position,
        keyValues: [
          { key: 'effect_name', value: { text: effect } },
          { key: 'start_active', value: { boolean: true } },
          { key: 'data_cp', value: { integer: RIFT_POINT } },
          { key: 'data_cp_value', value: { vector: middle } },
        ],
      })
      if (e === undefined) continue
      placed.push(e)
      fireInput(e, 'Start')
    }
  }
  if (placed.length < 2 * RIFT_PARTICLES.length) log(`rift: only ${placed.length} of ${2 * RIFT_PARTICLES.length} effects started`)
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
