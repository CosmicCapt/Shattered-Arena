// Camera shots for the cinematic moments (the match intro, the winner's Patron, the bonus arena).
//
// A shot points a player's camera at a point from a distance. The camera looks the way the player's hero
// does, so the caller turns the hero first (teleport with a facing). A locked shot stays still: a player
// who turns their view is turned back, which needs their hero frozen, as the callers keep it.
import { type CameraMove, curve, type Pawn, playCamera, type Player, type Vector } from 'modlock'

const CONTEXT = 'arena-cinema'
const HELD_VIEW = 0.5 // degrees a locked view may turn before it is turned back

interface Shot {
  move: CameraMove
  lock: { pitch: number; yaw: number } | undefined
}
const shots = new Map<number, Shot>() // by player slot

/** shoot points the player's camera at target from distance, for seconds or until cutShot. lock is the facing a still shot holds. */
export function shoot(player: Player, target: Vector, distance: number, seconds: number, lock?: { pitch: number; yaw: number }): boolean {
  cutShot(player)
  const move = playCamera(player, { tracks: { target: curve.hold(target, seconds), distance: curve.hold(distance, seconds) }, context: CONTEXT, priority: 6 })
  if (move === undefined) return false
  shots.set(player.slot, { move, lock })
  return true
}

/** cutShot gives the player their normal camera back. */
export function cutShot(player: Player): void {
  const shot = shots.get(player.slot)
  if (shot === undefined) return
  shot.move.cancel()
  player.clearCamera(CONTEXT)
  shots.delete(player.slot)
}

/** holdShots keeps the locked shots still. Call every frame, with how to find a player's hero. */
export function holdShots(players: readonly Player[], pawnOf: (player: Player) => Pawn | undefined): void {
  if (shots.size === 0) return
  for (const player of players) {
    const lock = shots.get(player.slot)?.lock
    if (lock === undefined) continue
    const pawn = pawnOf(player)
    if (pawn === undefined || pawn.health <= 0) continue
    if (Math.abs(pawn.eyeAngles.pitch - lock.pitch) <= HELD_VIEW && Math.abs(((lock.yaw - pawn.eyeAngles.yaw + 540) % 360) - 180) <= HELD_VIEW) continue
    // Released for the turn: a frozen hero does not take it.
    player.freeze(false)
    player.teleport(pawn.position, { pitch: lock.pitch, yaw: lock.yaw, roll: 0 }, { x: 0, y: 0, z: 0 })
    player.freeze(true)
  }
}

/** shotsReset forgets every shot when a new map loads. */
export function shotsReset(): void {
  shots.clear()
}
