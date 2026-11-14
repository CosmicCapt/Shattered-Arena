// The backdrop behind team select and the hero pick: each player's camera looks across the arena from
// their team's portal, with the pits in view.
import { type CameraMove, curve, type Pawn, playCamera, type Player } from 'modlock'

import { CENTRE, PORTALS } from './layout'

const TARGET_HEIGHT = 120 // look at the floor in the middle of the arena
const DISTANCE = 2400 // how far back from that point the camera sits, along the way the hero faces
const HOLD_SECONDS = 3600 // long enough for any lobby; cancelled when the match starts
const CONTEXT = 'arena-lobby'

const cams = new Map<number, { entity: number; team: number; move: CameraMove }>() // by player slot

/**
 * lobbyCamera points the player's camera at the middle of the arena from their team's side. It only
 * restarts the camera when the hero or the team changes.
 */
export function lobbyCamera(player: Player, pawn: Pawn, team: number): void {
  const cam = cams.get(player.slot)
  if (cam !== undefined && cam.entity === pawn.entity && cam.team === team) return
  releaseCamera(player)
  const side = PORTALS[team] ?? PORTALS[2]
  // A point a little toward the player's side, so the far half of the arena fills the view.
  const target = { x: CENTRE.x, y: CENTRE.y + side.y * 0.15, z: CENTRE.z + TARGET_HEIGHT }
  const move = playCamera(player, {
    tracks: {
      target: curve.hold(target, HOLD_SECONDS),
      distance: curve.hold(DISTANCE, HOLD_SECONDS),
    },
    context: CONTEXT,
    priority: 5,
  })
  if (move !== undefined) cams.set(player.slot, { entity: pawn.entity, team, move })
}

/** releaseCamera gives the player their normal camera back. */
export function releaseCamera(player: Player): void {
  const cam = cams.get(player.slot)
  if (cam === undefined) return
  cam.move.cancel()
  player.clearCamera(CONTEXT)
  cams.delete(player.slot)
}

/** camerasReset forgets everything when a new map loads. */
export function camerasReset(): void {
  cams.clear()
}
