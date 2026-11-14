// Shops. The map has a buy volume (trigger_item_shop) in each spawn room and a marker for
// each shop model (info_target_server_only named arena_shop_..._model). Deadlock models crash this Hammer build when it
// draws them, so the mod creates the shops themselves (citadel_shop_prop_dynamic, Deadlock's shop entity,
// which the game opens and closes along with its trigger) at the markers.
// The shop is made with createEntity, not modlock/entities: that import adds a 1 MB table of every game
// entity to the built mod.
import { createEntity, entityName, entityPosition, findEntities, fireInput, log, players, readField, writeField, type Vector } from 'modlock'

import { cast } from './match'

export const SHOP_MODEL = 'models/props_gameplay/shop/shop_01.vmdl'

export function placeShops() {
  let n = 0
  for (const e of findEntities('info_target_server_only')) {
    const name = entityName(e) ?? ''
    if (!name.startsWith('arena_shop_') || !name.endsWith('_model')) continue
    const at = entityPosition(e)
    if (at === undefined) continue
    const lane = 0
    const team = name.includes('amber') ? 2 : 3
    const shop = createEntity({
      designerName: 'citadel_shop_prop_dynamic', subclass: '', team, position: at.position, facing: at.facing, transmitAlways: false,
      keyValues: [
        { key: 'model', value: { text: SHOP_MODEL } },
        { key: 'LaneNum', value: { integer: lane } },
        { key: 'IdleAnim', value: { text: 'idle' } },
        { key: 'solid', value: { integer: 6 } },
      ],
    })
    if (shop === undefined) { log(`FAILED to create shop ${name}`); continue }
    if (!fireInput(shop, 'SetShopOpen', { boolean: true })) log(`shop ${name}: SetShopOpen was refused`)
    n++
  }
  log(`shops created: ${n}`)
}

// The game doesn't mark heroes as inside the buy volumes on a custom map, so the mod does it: a hero standing in
// their own team's shop area (512 x 512, up to 300 high, around each trigger_item_shop) is put in the shop zone.
interface Zone { at: Vector; team: number }
let zones: Zone[] = []
export function loadShopZones() {
  zones = []
  for (const e of findEntities('trigger_item_shop')) {
    const at = entityPosition(e)?.position
    const team = readField(e, 'CBaseEntity', 'm_iTeamNum', 'int32') as number | undefined
    if (at !== undefined) zones.push({ at, team: team ?? 0 })
  }
  log(`shop zones: ${zones.length}`)
}

const HALF = 256
/** Call often (every few frames): keeps heroes' shop-zone flag right. */
export function shopTick() {
  for (const c of players()) {
    const pawn = cast.pawn(c.player) // Cast's cached read: player.pawn() can take over 100 ms
    if (pawn === undefined) continue
    const p = pawn.position
    const inside = zones.some((z) => (z.team === 0 || z.team === pawn.team) &&
      Math.abs(p.x - z.at.x) <= HALF && Math.abs(p.y - z.at.y) <= HALF && p.z - (z.at.z - 128) < 300)
    const zone = readField(pawn.entity, 'CCitadelPlayerPawn', 'm_bInItemShopZone', 'bool')
    if (zone !== inside) writeField(pawn.entity, 'CCitadelPlayerPawn', 'm_bInItemShopZone', 'bool', inside)
  }
}
