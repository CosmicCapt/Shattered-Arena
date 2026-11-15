// No cheats and no hero swaps, as in a normal Deadlock match.
//   - Hero and team changes: selecthero, changeteam and jointeam are claimed here, so the game never runs
//     them. The pause menu's Change Hero sends selecthero, the same as typing it in the console, so this
//     closes both ways. Bot matches (citadel_solo_bot_match, which the bots' AI needs) otherwise let players
//     change hero mid-match.
//   - Cheats: sv_cheats is turned off when the mod starts and on every map. A mod can't claim noclip, god and
//     the other cheat commands: the engine runs real console commands itself and only hands the game (and
//     Modlock) the ones it doesn't know, such as selecthero. With sv_cheats off the engine refuses them all,
//     and the cheats that run in a player's own game too. Local modlock dev servers and Hyperline's both run
//     with cheats on otherwise.
//   - Turning cheats off resets every cheat-protected setting to the game's default. The mod sets five of
//     them (KEEP), so cheatCommand puts them back after the one cheat command the mod runs itself.
import { command, log, type Player, serverCommand, toast } from 'modlock'

const HERO_AND_TEAM = ['selecthero', 'changeteam', 'jointeam']

/** The cheat-protected settings the mod changes, with the values it keeps them at. */
const KEEP = [
  'citadel_koth_enabled false',
  'citadel_trooper_spawn_enabled true',
  'citadel_npc_spawn_enabled true',
  'citadel_powerup_spawn_enabled true',
  'citadel_pickup_spawner_enabled true',
]

const TOAST_GAP = 3 // seconds between "not allowed" messages to one player

const lastToast = new Map<number, number>()
let clock = 0

function refuse(player: Player, name: string, args: string): void {
  log(`lockdown: refused ${name}${args === '' ? '' : ' ' + args} from slot ${player.slot}`)
  const last = lastToast.get(player.slot)
  if (last !== undefined && clock - last < TOAST_GAP) return
  lastToast.set(player.slot, clock)
  toast(player, "Changing hero or team isn't allowed in Shattered Arena", 3)
}

/** lockdownStart claims the hero and team commands and turns cheats off. Call once when the mod starts. */
export function lockdownStart(): void {
  for (const name of HERO_AND_TEAM) command(name, (player, args) => refuse(player, name, args))
  cheatsOff()
}

/** cheatsOff turns cheats off. Call when a map loads, before the mod changes any setting. */
export function cheatsOff(): void {
  if (!serverCommand('sv_cheats false')) log('lockdown: the game refused sv_cheats false')
}

/** lockdownTick keeps the clock the "not allowed" messages are spaced by. Call every frame. */
export function lockdownTick(now: number): void {
  clock = now
}

/**
 * cheatCommand runs one cheat command at the server console with cheats on for that line only, then puts
 * back the cheat-protected settings that turning cheats off again resets.
 */
export function cheatCommand(line: string): boolean {
  const ran = serverCommand(`sv_cheats true; ${line}; sv_cheats false`)
  for (const setting of KEEP) serverCommand(setting)
  return ran
}
