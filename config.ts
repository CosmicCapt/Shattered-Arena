// Every setting Shattered Arena uses, in one place. Positions on the map are in layout.ts
// (generated with the map by tools/build_arena_v1.py).

// ------------------------------------------------------------------ tickets
export const START_TICKETS = 500 // each team by default; the first team at 0 loses
// The host (the first player in) can change the tickets on team select, in these steps and bounds.
export const TICKET_STEP = 100
export const TICKET_MIN = 100
export const TICKET_MAX = 2000
export const HERO_KILL_TICKETS = 5 // a hero dies (any way, pits included): their team loses this
export const MINION_KILL_TICKETS = 1 // a minion dies: its team loses this...
export const MINION_TICKET_FLOOR = 10 // ...unless the team is at this many tickets or fewer
export const PORTAL_TICKETS = 1 // a minion walks into the enemy portal: the enemy loses this

// Souls (souls.ts): minion and hero kills pay every player on the killing team the same.
// MINION_SOULS and MINION_SOULS_PER_MINUTE match the game's own citadel_minion_gold_reward and
// citadel_minion_gold_reward_bonus_per_minute.
export const MINION_SOULS = 25 // each player on the team, for a minion killed by one of them
export const MINION_SOULS_PER_MINUTE = 1 // plus this per whole minute since the match started
export const SOUL_SCALE = 0.5 // minion and hero kill souls are this share of normal by default (1 = normal)
// The host can change it on team select, in these steps and bounds.
export const SOUL_SCALE_STEP = 0.25
export const SOUL_SCALE_MIN = 0.25
export const SOUL_SCALE_MAX = 2
export const KILL_WATCH_SECONDS = 3.5 // a hero kill's souls (orb included) are counted for this long
export const ASSIST_SECONDS = 10 // enemy heroes who hit the victim this recently shared the kill (the game's rule)

// ------------------------------------------------------------------ teams
export const AMBER = 2 // base at +Y
export const SAPPHIRE = 3 // base at -Y
export const TEAM_SIZE = 6 // up to 6v6

// ------------------------------------------------------------------ pits
// A hero below layout's PIT_KILL_Z dies. The kill is credited to the last enemy hero who hit them
// within this many seconds (the game gives that hero the kill and its souls).
export const PIT_CREDIT_SECONDS = 6

// ------------------------------------------------------------------ melee knockback
// An enemy hero's heavy melee pushes you the way they face (light melee doesn't, nor does a parried hit).
export const KNOCKBACK_SPEED = 750 // units per second
export const KNOCKBACK_UP = 320 // lift, so the victim is knocked through the air instead of sliding
export const HEAVY_DRAINS_STAMINA = true // an unparried heavy melee hit on a hero empties their stamina
export const HEAVY_HOLD = 0.35 // the melee key held this long makes it a heavy melee
export const HEAVY_WINDOW = 1.2 // and that hero's melee hits for this long after are heavy
// The host can change how far the push throws, as a percent of KNOCKBACK_SPEED, on team select: 0 is no
// push at all (the hit still empties stamina).
export const KNOCKBACK_PERCENT = 100
export const KNOCKBACK_PERCENT_STEP = 25
export const KNOCKBACK_PERCENT_MAX = 200

// ------------------------------------------------------------------ minions
export const FIRST_WAVE_SECONDS = 30 // the first wave at 0:30, then every WAVE_SECONDS
export const WAVE_SECONDS = 30 // each team alternates its own left and right spawn every wave
export const MINION_SPEED = 300 // units per second along their route (the mod walks them)
export const FIGHT_RANGE = 700 // an enemy minion this close: the minion stops and fights (the game's AI has it)
export const FIGHT_HERO_RANGE = 550 // the same for an enemy hero
// 7 per wave: 5 normal and 2 healers
export const WAVE: readonly string[] = ['trooper_normal', 'trooper_normal', 'trooper_medic', 'trooper_normal', 'trooper_normal', 'trooper_medic', 'trooper_normal']

// Rift minions: every RIFT_KILLS enemy hero deaths, a team gets a row of the game's Rift Troopers (bigger,
// black, twice the health and damage) out of its own portal, straight down the middle.
export const RIFT_KILLS = 10
export const RIFT_WAVE: readonly string[] = ['trooper_normal', 'trooper_normal', 'trooper_normal', 'trooper_normal', 'trooper_normal'] // 5, as the game sends
export const RIFT_MINION_HEALTH = 3000 // each (a wave minion has 300)
export const RIFT_MINION_COLOR = 0x202020ff // the tint that makes them black, as 0xRRGGBBAA, when the game's own look can't be had
export const RIFT_PORTAL_TICKETS = 2 // a rift minion walks into the enemy portal: the enemy loses this
export const RIFT_SPACING = 110 // units between rift minions in their row
export const RIFT_SPAWN_FORWARD = 120 // units out from the portal's face where the row appears

// ------------------------------------------------------------------ portal looks (rift.ts)
// The Unstable Rift's look is played at each portal; minions still go in by PORTAL_REACH.
export const RIFT_FORWARD = 10 // units out from PORTALS (the portal block's arena-side face)
// The Patrons over each team's spawn (patrons.ts): the height of the model's base above the floor, how far
// toward the middle of the arena they stand from the spawn (clear of the outer wall's leaning top), and their size.
export const PATRON_HEIGHT = 400
export const PATRON_FORWARD = 350
export const PATRON_SCALE = 1
export const RIFT_HEIGHT = 190 // units above the floor for the rift's middle: the 3x rift's bottom meets the floor

// ------------------------------------------------------------------ camps
// Every camp spawns when the match starts. A cleared camp drops its bridge buff (blue casting, red gun,
// purple movement); once the buff is taken the camp comes back this many seconds later.
export const CAMP_RESPAWN = 120
// Sinner's Sacrifices (arena/sinners.ts): when they first come (match time, seconds), how soon they come
// back once cleared, and the tickets they give: per heavy melee hit (a Sinner takes four, then a fifth that is
// the jackpot or not), and for a last hit that is a jackpot (a last hit without one gives nothing). A hit is paid SINNER_SETTLE seconds later, when it is known not to
// be the last. SINNER_JACKPOT_STATE: the Sinner's vault state that means a jackpot, once learned from the
// log (undefined: a Sinner that goes while it still has health counts as a jackpot).
export const SINNER_PIT_AT = 300
export const SINNER_EDGE_AT = 600
export const SINNER_RESPAWN = 120
export const SINNER_HIT_TICKETS = 1
export const SINNER_JACKPOT_TICKETS = 6
export const SINNER_SETTLE = 1.6
export const SINNER_JACKPOT_STATE: number | undefined = 4 // seen on a jackpot finish (2 -> 4); unconfirmed whether a missed one also ends in 4
// Arrivals: a pit Sinner's island rises SINNER_RISE_TIME seconds before the Sinner is due (the map's mover is
// built to take this long: SINNER_ISLAND_RISE in tools/build_arena_v1.py; change both together) and sinks
// SINNER_SINK_DELAY seconds after it's cleared, with SINNER_RUMBLE_SOUND while it moves. Every Sinner falls
// SINNER_DROP_HEIGHT units in SINNER_DROP_TIME seconds and lands with SINNER_LAND_EFFECT and SINNER_LAND_SOUND
// (the game's own sound events and effects).
export const SINNER_RISE_TIME = 4
export const SINNER_SINK_DELAY = 3
export const SINNER_DROP_HEIGHT = 1400
export const SINNER_DROP_TIME = 1.2
export const SINNER_RUMBLE_SOUND = 'MidBoss.Arrive'
export const SINNER_LAND_SOUND = 'Koth.Spawn.Start'
export const SINNER_LAND_EFFECT = 'particles/abilities/tier2boss_stomp.vpcf'

// ------------------------------------------------------------------ respawns and bases
export const RESPAWN_SECONDS = 10 // every death, all match by default (set through the game's respawn ramps)
// The host can pick another respawn time on team select, from these.
export const RESPAWN_OPTIONS: readonly number[] = [3, 5, 10, 15, 20, 30]
// Souls every hero has when the match starts, in total (600 is what the game gives on its own). The host
// steps through START_SOULS_OPTIONS with - and + on team select, or types any amount up to START_SOULS_MAX
// (typing doesn't reach the mod on Hyperline, so the buttons are the way that always works).
export const START_SOULS = 600
export const START_SOULS_MAX = 100000
export const START_SOULS_OPTIONS: readonly number[] = [0, 600, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 100000]
// The ticket strip is rebuilt from scratch when a player respawns and this often, in case their game
// dropped it (the mod otherwise only sends changes).
export const HUD_REBUILD_SECONDS = 15
export const BASE_HEAL_PER_SECOND = 0.15 // share of max health per second in your own spawn room
export const BASE_ENEMY_DAMAGE_PER_SECOND = 0.25 // share of max health per second for an enemy in your spawn room

// ------------------------------------------------------------------ host switches (team select)
export const RANDOM_HEROES = false // everyone gets a random hero; the hero pick is a short reveal
export const RANDOM_REVEAL_SECONDS = 6 // the reveal stays up at least this long once everyone has a hero
export const DUPLICATE_HEROES = false // a hero may be on the same team more than once
export const RANDOM_TEAMS = false // everyone is shuffled into two even teams when the hero pick starts
// ------------------------------------------------------------------ match flow
export const TEAM_COUNTDOWN = 3 // lobby: seconds after everyone is ready
export const PICK_SECONDS = 45 // hero pick: everyone picks at once; unlocked players get their selection or a random hero
export const PICKED_COUNTDOWN = 3 // hero pick: seconds after everyone has locked in
export const SEAT_SECONDS = 20 // seating: wait this long for everyone to be on their pick
export const INTRO_SECONDS = 4 // once everyone is seated: the view from above the arena, before the countdown
export const GO_COUNTDOWN = 5 // then the countdown, frozen at the spawn, before the match starts
export const GO_SECONDS = 1 // GO! stays up this long into the match, and into the bonus round's fight
// The bonus round (bonus.ts), after a match is won. The host can turn it off on team select.
export const BONUS_ROUND = true
export const BONUS_VICTORY_SECONDS = 5 // first, every camera on the winning team's Patron
export const BONUS_MOVING_AT = 3 // seconds into that shot when "Moving to the Bonus Round" shows
export const BONUS_FADE = 0.6 // the screen goes black this long before the move to the platform
export const BONUS_CUT = 0.4 // the screen is black this long into the round, and the cameras cut to the Patron behind it
export const BONUS_REVEAL_SECONDS = 3 // then a view of the whole bonus arena from the side
export const BONUS_COUNTDOWN = 5 // then a countdown on the platform, frozen, before the fight
export const BONUS_SECONDS = 60 // the fight, at most
export const BONUS_NO_RESPAWN = 600 // the respawn time while it runs: longer than the round
export const BONUS_PATRON_BACK = 1250 // units from the platform's centre to each Patron behind its team
export const BONUS_PATRON_HEIGHT = 60 // the Patrons there hover low
export const RESULTS_SECONDS = 15 // the results card, then a fresh map and lobby
export const BOT_AI = true // Bots: bots play with the game's bot AI (citadel_solo_bot_match)
