// What each player sees: team select (with ready-up and test bots) and the hero pick, then during the
// match a ticket strip under the game's top bar, and a results card at the end.
import { type Child, heroes, type Player, Score, show, TopStrip } from 'modlock'

import { B } from './bonus'
import { addTestBot, removeTestBot } from './bots' // Bots
import {
  BONUS_MOVING_AT,
  BONUS_VICTORY_SECONDS,
  GO_SECONDS,
  HUD_REBUILD_SECONDS,
  KNOCKBACK_PERCENT_MAX,
  RESPAWN_OPTIONS,
  SOUL_SCALE_MAX,
  SOUL_SCALE_MIN,
  START_SOULS_MAX,
  TICKET_MAX,
  TICKET_MIN,
} from './config'
import {
  AMBER,
  cast,
  changeBonusRound,
  changeKnockback,
  changeRespawn,
  changeSouls,
  changeStartSouls,
  changeTickets,
  chooseTeam,
  host,
  pickTimeLeft,
  heroTitle,
  lobbyProblem,
  lockIn,
  M,
  type Member,
  members,
  patronName,
  pickHero,
  readyCount,
  SAPPHIRE,
  secondsUntil,
  setStartSouls,
  TEAM_SIZE,
  teamMembers,
  toggleReady,
} from './match'
import { type StatRow, statRows } from './stats'
import { T } from './tickets'

const AMBER_COLOR = '#ffb340'
const SAPPHIRE_COLOR = '#4da6ff'
const GOLD = '#f5c542'
const TEXT = '#ffffff'
const DIM = '#9aa7b4'
const GOOD = '#5ee07a'
const CARD = '#121a24f2'

const color = (team: number | undefined) => (team === AMBER ? AMBER_COLOR : team === SAPPHIRE ? SAPPHIRE_COLOR : DIM)
const PURPLE = '#b05cff'

// Each redraw only sends what changed, so a screen the player's game dropped would stay gone. The match
// screen gets a new key (which rebuilds it whole) when the player respawns and every HUD_REBUILD_SECONDS.
const rebuilds = new WeakMap<Member, { alive: boolean; build: number; nextAt: number }>()
function liveBuild(m: Member): number {
  const pawn = cast.pawn(m.player)
  const alive = pawn !== undefined && pawn.health > 0
  let r = rebuilds.get(m)
  if (r === undefined) rebuilds.set(m, (r = { alive, build: 0, nextAt: M.clock + HUD_REBUILD_SECONDS }))
  if ((alive && !r.alive) || M.clock >= r.nextAt) {
    r.build++
    r.nextAt = M.clock + HUD_REBUILD_SECONDS
  }
  r.alive = alive
  return r.build
}

/** drawAll redraws every player's screen from the match state. */
export function drawAll(): void {
  if (M.reloading) return
  for (const m of members()) {
    if (m.bot) continue // Bots: bots have no screen
    if (M.phase === 'seating') show(m.player, <Intro viewer={m} />)
    else if (M.phase === 'live') show(m.player, <Live viewer={m} build={liveBuild(m)} />)
    else if (M.phase === 'bonus') show(m.player, <BonusRound viewer={m} />)
    else if (M.phase === 'results') show(m.player, <Results viewer={m} />)
    else show(m.player, <Screen viewer={m} />)
  }
}

function Screen(props: { viewer: Member }) {
  return (
    <panel
      style={{
        width: '100%',
        height: '100%',
        // A soft vignette, so the arena behind the picker stays visible.
        gradient: { shape: 'radial', colors: ['#0a0f1620', '#03050acc'] },
      }}
    >
      {M.phase === 'lobby' ? <Lobby viewer={props.viewer} /> : <HeroPick viewer={props.viewer} />}
    </panel>
  )
}

function Title() {
  return (
    <panel style={{ flow: 'down', width: 'fill' }}>
      <label style={{ fontSize: 44, face: 'block', uppercase: true, letterSpacing: 3, horizontalAlign: 'center', color: PURPLE, margin: [0, 0, 20, 0] }}>Shattered Arena</label>
    </panel>
  )
}

// ---------------------------------------------------------------- lobby
function Lobby(props: { viewer: Member }) {
  const m = props.viewer
  const { ready, total } = readyCount()
  const status = M.countdownAt !== undefined ? `Everyone is ready. Hero select in ${secondsUntil(M.countdownAt)}` : lobbyProblem()
  return (
    <panel
      enter={{ opacity: 0, translate: [0, 24] }}
      style={{
        flow: 'down',
        horizontalAlign: 'center',
        verticalAlign: 'center',
        width: 760,
        padding: [26, 28, 24, 28],
        background: CARD,
        borderRadius: 8,
        boxShadow: { blur: 40, color: '#000000aa' },
        transition: 0.25,
      }}
    >
      <Title />
      <HostSettings viewer={m} />
      <panel style={{ flow: 'right', width: 'fill' }}>
        <TeamColumn team={AMBER} viewer={m} />
        <TeamColumn team={SAPPHIRE} viewer={m} />
      </panel>
      <label style={{ fontSize: 17, bold: true, horizontalAlign: 'center', color: TEXT, margin: [18, 0, 8, 0] }}>{`Ready: ${ready} / ${total}`}</label>
      <ReadyButton viewer={m} />
      {status === undefined ? null : (
        <label style={{ fontSize: 14, horizontalAlign: 'center', color: M.countdownAt !== undefined ? GOLD : DIM, margin: [10, 0, 0, 0] }}>{status}</label>
      )}
    </panel>
  )
}

// The host (the first player in) sets the match options with − and +; everyone else sees the values.
// The rows are left-aligned in a centred block, so their labels and controls line up.
function HostSettings(props: { viewer: Member }) {
  return (
    <panel style={{ flow: 'down', horizontalAlign: 'center', margin: [0, 0, 14, 0] }}>
      <HostSetting viewer={props.viewer} label="Tickets per team" value={`${M.startTickets}`}
        change={changeTickets} atMin={M.startTickets <= TICKET_MIN} atMax={M.startTickets >= TICKET_MAX} />
      <HostSetting viewer={props.viewer} label="Respawn time" value={`${M.respawnSeconds} s`}
        change={changeRespawn} atMin={M.respawnSeconds <= RESPAWN_OPTIONS[0]} atMax={M.respawnSeconds >= RESPAWN_OPTIONS[RESPAWN_OPTIONS.length - 1]} />
      <HostSetting viewer={props.viewer} label="Souls gain" value={`${Math.round(M.soulScale * 100)}%`}
        change={changeSouls} atMin={M.soulScale <= SOUL_SCALE_MIN} atMax={M.soulScale >= SOUL_SCALE_MAX} />
      <StartSoulsSetting viewer={props.viewer} />
      <HostSetting viewer={props.viewer} label="Melee knockback" value={`${M.knockback}%`}
        change={changeKnockback} atMin={M.knockback <= 0} atMax={M.knockback >= KNOCKBACK_PERCENT_MAX} />
      <HostSetting viewer={props.viewer} label="Bonus round" value={M.bonusRound ? 'On' : 'Off'}
        change={changeBonusRound} atMin={!M.bonusRound} atMax={M.bonusRound} />
    </panel>
  )
}

function HostSetting(props: {
  viewer: Member
  label: string
  value: string
  change: (player: Player, steps: number) => void
  atMin: boolean
  atMax: boolean
  extra?: Child // shown to the host after the + button
}) {
  const h = host()
  const mine = h === props.viewer
  const step = (label: string, steps: number, off: boolean) => (
    <button
      disabled={off}
      sound="UI.MainMenu.Activate"
      hoverSound="UI.MainMenu.Hover"
      onPress={(player) => props.change(player, steps)}
      style={{ verticalAlign: 'center', width: 34, height: 30, borderRadius: 4, background: off ? '#2a313a' : '#ffffff1a', transition: 0.15 }}
      hover={{ background: '#ffffff33' }}
    >
      <label style={{ fontSize: 18, bold: true, horizontalAlign: 'center', verticalAlign: 'center', color: off ? DIM : TEXT }}>{label}</label>
    </button>
  )
  return (
    <panel style={{ flow: 'right', horizontalAlign: 'left', margin: [0, 0, 6, 0] }}>
      <label style={{ verticalAlign: 'center', width: 140, fontSize: 15, color: DIM, margin: [0, 12, 0, 0] }}>{props.label}</label>
      {mine ? step('−', -1, props.atMin) : null}
      <label style={{ verticalAlign: 'center', width: 96, fontSize: 22, face: 'block', textAlign: 'center', color: GOLD }}>{props.value}</label>
      {mine ? step('+', 1, props.atMax) : null}
      {mine ? props.extra ?? null : null}
      {mine || h === undefined ? null : <label style={{ verticalAlign: 'center', fontSize: 13, color: DIM, margin: [0, 0, 0, 12] }}>{`set by ${h.name}`}</label>}
    </panel>
  )
}

// Starting souls: - and + step through the usual amounts, and the host can also type any amount (such as
// 5000, 5,000 or 5k) into the box. The box is never filled in from the mod, so nothing it sends back can
// overwrite what is being typed. On Hyperline typed text doesn't reach the mod; the buttons do.
function StartSoulsSetting(props: { viewer: Member }) {
  return (
    <HostSetting viewer={props.viewer} label="Starting souls" value={commas(M.startSouls)} change={changeStartSouls}
      atMin={M.startSouls <= 0} atMax={M.startSouls >= START_SOULS_MAX}
      extra={
        <entry
          placeholder="or type"
          maxLength={8}
          onChange={(player, text) => {
            const souls = parseSouls(text)
            if (souls !== undefined) setStartSouls(player, souls)
          }}
          style={{ verticalAlign: 'center', width: 96, height: 30, fontSize: 15, color: TEXT, padding: [4, 8], margin: [0, 0, 0, 10], borderRadius: 4, background: '#ffffff1a' }}
        />
      }
    />
  )
}

/** parseSouls reads a typed amount: digits, commas allowed, with an optional k for thousands. Empty is 0. */
function parseSouls(text: string): number | undefined {
  const t = text.replace(/[,\s]/g, '').toLowerCase()
  if (t === '') return 0
  const match = /^(\d+(?:\.\d+)?)(k?)$/.exec(t)
  if (match === null) return undefined
  return Number(match[1]) * (match[2] === 'k' ? 1000 : 1)
}

function ReadyButton(props: { viewer: Member }) {
  const m = props.viewer
  const noTeam = m.team === undefined
  return (
    <button
      disabled={noTeam}
      sound="UI.MainMenu.Activate"
      hoverSound="UI.MainMenu.Hover"
      onPress={(player) => toggleReady(player)}
      style={{
        horizontalAlign: 'center',
        width: 280,
        padding: [12, 0],
        borderRadius: 4,
        background: noTeam ? '#2a313a' : m.ready ? '#1b222b' : GOLD,
        borderWidth: m.ready ? 2 : 0,
        borderColor: '#ffffff40',
        transition: 0.15,
      }}
      hover={{ brightness: 1.15 }}
    >
      <label style={{ fontSize: 18, face: 'block', uppercase: true, horizontalAlign: 'center', color: noTeam ? DIM : m.ready ? TEXT : '#151a20' }}>
        {noTeam ? 'Pick a team' : m.ready ? 'Not ready' : 'Ready'}
      </label>
    </button>
  )
}

function TeamColumn(props: { team: number; viewer: Member }) {
  const { team, viewer } = props
  const c = color(team)
  const mine = viewer.team === team
  const list = teamMembers(team)
  const full = list.length >= TEAM_SIZE
  const open = Math.max(0, TEAM_SIZE - list.length)
  return (
    <panel style={{ flow: 'down', width: 'fill', margin: [0, 6], padding: 10, borderRadius: 6, background: `${c}${mine ? '26' : '12'}`, transition: 0.2 }}>
      <panel style={{ flow: 'right', width: 'fill', margin: [2, 4, 8, 4] }}>
        <label style={{ width: 'fill', fontSize: 18, face: 'block', uppercase: true, letterSpacing: 1, color: c }}>{patronName(team)}</label>
        <label style={{ fontSize: 14, color: DIM }}>{`${list.length} / ${TEAM_SIZE}`}</label>
      </panel>
      {list.map((m) => (
        <PlayerRow member={m} own={m === viewer} />
      ))}
      {Array.from({ length: open }, () => (
        <panel style={{ width: 'fill', height: 38, margin: [3, 0], padding: [0, 10], borderRadius: 4, background: '#0000002e' }}>
          <label style={{ verticalAlign: 'center', fontSize: 13, color: '#ffffff3a' }}>Open</label>
        </panel>
      ))}
      <panel style={{ flow: 'right', horizontalAlign: 'center', height: 40, margin: [8, 0, 0, 0] }}>
        {mine || full ? null : (
          <button
            sound="UI.MainMenu.Activate"
            hoverSound="UI.MainMenu.Hover"
            onPress={(player) => chooseTeam(player, team)}
            style={{ horizontalAlign: 'center', verticalAlign: 'center', padding: [6, 16], borderRadius: 4, borderWidth: 2, borderColor: c, background: '#00000040', transition: 0.15 }}
            hover={{ background: `${c}40` }}
          >
            <label style={{ fontSize: 13, bold: true, color: c }}>Join this team</label>
          </button>
        )}
        {/* Bots: "+ bot" adds a bot to this team. */}
        {full ? null : (
          <button
            sound="UI.MainMenu.Activate"
            hoverSound="UI.MainMenu.Hover"
            onPress={() => addTestBot(team)}
            style={{ verticalAlign: 'center', margin: [0, 0, 0, 8], padding: [6, 12], borderRadius: 4, borderWidth: 2, borderColor: '#ffffffaa', background: '#00000040', transition: 0.15 }}
            hover={{ background: '#ffffff26' }}
          >
            <label style={{ fontSize: 13, bold: true, color: TEXT }}>+ bot</label>
          </button>
        )}
        {full && !mine ? <label style={{ verticalAlign: 'center', fontSize: 13, color: DIM }}>Team full</label> : null}
      </panel>
    </panel>
  )
}

function Avatar(props: { member: Member }) {
  const m = props.member
  return m.bot ? (
    // Bots: a badge in place of the Steam picture.
    <panel style={{ width: 30, height: 22, verticalAlign: 'center', borderRadius: 3, background: '#ffffff1a' }}>
      <label style={{ horizontalAlign: 'center', verticalAlign: 'center', fontSize: 10, bold: true, color: DIM }}>BOT</label>
    </panel>
  ) : (
    <avatar steamId={m.steamId} style={{ width: 26, height: 26, borderRadius: 13, verticalAlign: 'center' }} />
  )
}

function PlayerRow(props: { member: Member; own: boolean }) {
  const { member: m, own } = props
  return (
    <panel
      style={{ flow: 'right', width: 'fill', height: 38, margin: [3, 0], padding: [0, 8], borderRadius: 4, background: '#0000004d', borderWidth: own ? 2 : 0, borderColor: GOLD }}
    >
      <Avatar member={m} />
      <label style={{ width: 'fill', verticalAlign: 'center', margin: [0, 0, 0, 10], fontSize: 15, bold: own, color: TEXT, noWrap: true, textOverflow: 'ellipsis' }}>
        {own ? `${m.name} (you)` : m.name}
      </label>
      {m.bot ? (
        // Bots: "×" removes the bot.
        <button onPress={() => removeTestBot(m)} style={{ verticalAlign: 'center', width: 24, height: 24, borderRadius: 3, background: '#ffffff14' }} hover={{ background: '#ff5a5a66' }}>
          <label style={{ horizontalAlign: 'center', verticalAlign: 'center', fontSize: 13, bold: true, color: TEXT }}>×</label>
        </button>
      ) : (
        <label style={{ verticalAlign: 'center', fontSize: 13, color: m.ready ? GOOD : DIM }}>{m.ready ? 'Ready' : 'Waiting'}</label>
      )}
    </panel>
  )
}

// --------------------------------------------------------------- heroes
const PICKER_COLUMNS = 10
// The hero list never changes, so its rows (by title) and the lookup by name are made once, not on every
// redraw for every player.
const HERO_ROWS = chunk([...heroes].sort((a, b) => a.title.localeCompare(b.title)), PICKER_COLUMNS)
const HERO_BY_NAME = new Map(heroes.map((h) => [h.name, h]))

/** lockedByTeammates lists the heroes the viewer's teammates have locked in, and who has each. */
function lockedByTeammates(viewer: Member): Map<string, Member> {
  const taken = new Map<string, Member>()
  if (viewer.team === undefined) return taken
  for (const o of members()) {
    if (o !== viewer && o.team === viewer.team && o.locked && o.hero !== undefined && !taken.has(o.hero)) taken.set(o.hero, o)
  }
  return taken
}

function HeroPick(props: { viewer: Member }) {
  const m = props.viewer
  const team = m.team
  const locked = lockedByTeammates(m) // worked out once for the whole grid
  const done = M.allPickedAt !== undefined
  const status = done
    ? 'Everyone is locked in. Heading into the arena...'
    : team === undefined
      ? `Watching hero select · ${pickTimeLeft()}s`
      : m.locked
        ? `Locked in · waiting for the others · ${pickTimeLeft()}s`
        : `Pick your hero · ${pickTimeLeft()}s`
  return (
    <panel
      enter={{ opacity: 0, translate: [0, 24] }}
      style={{ flow: 'down', horizontalAlign: 'center', verticalAlign: 'center', padding: [14, 22, 14, 22], background: CARD, borderRadius: 8, boxShadow: { blur: 40, color: '#000000aa' } }}
    >
      <label style={{ fontSize: 34, face: 'block', uppercase: true, letterSpacing: 3, horizontalAlign: 'center', color: PURPLE }}>Shattered Arena</label>
      <label style={{ fontSize: 18, bold: true, horizontalAlign: 'center', color: done || m.locked ? GOOD : GOLD, margin: [2, 0, 8, 0] }}>{status}</label>
      <panel style={{ flow: 'right', width: 'fill', margin: [0, 0, 8, 0] }}>
        <PickColumn team={AMBER} viewer={m} />
        <PickColumn team={SAPPHIRE} viewer={m} />
      </panel>
      {team === undefined
        ? null
        : HERO_ROWS.map((row) => (
            <panel style={{ flow: 'right', horizontalAlign: 'center' }}>
              {row.map((hero) => {
                const taken = locked.get(hero.name) // a teammate locked it in
                const mine = m.hero === hero.name
                const c = color(team)
                const blocked = taken !== undefined || m.locked
                return (
                  <button
                    disabled={blocked}
                    tooltip={taken === undefined ? hero.title : `${hero.title} (${taken.name} has it)`}
                    hoverSound="UI.MainMenu.Hover"
                    sound="UI.MainMenu.Activate"
                    onPress={(player) => pickHero(player, hero.name)}
                    style={{
                      flow: 'down',
                      saturation: taken !== undefined ? 0 : 1,
                      width: 68,
                      margin: 2,
                      padding: 3,
                      borderRadius: 4,
                      background: mine ? `${c}55` : '#ffffff0f',
                      borderWidth: 2,
                      borderColor: mine ? c : '#00000000',
                      opacity: taken !== undefined ? 0.25 : mine ? 1 : blocked ? 0.6 : 1,
                      transition: 0.12,
                    }}
                    hover={{ background: `${c}33`, brightness: 1.15 }}
                  >
                    <hero hero={hero.id} look="vertical" scaling="cover" style={{ width: 58, height: 72, borderRadius: 3 }} />
                    <label style={{ fontSize: 11, color: mine ? TEXT : DIM, horizontalAlign: 'center', margin: [3, 0, 0, 0], noWrap: true, textOverflow: 'shrink' }}>{hero.title}</label>
                  </button>
                )
              })}
            </panel>
          ))}
      {team === undefined ? null : <LockButton viewer={m} />}
    </panel>
  )
}

function LockButton(props: { viewer: Member }) {
  const m = props.viewer
  const none = m.hero === undefined
  const text = m.locked ? `Locked in: ${heroTitle(m.hero)}` : none ? 'Pick a hero' : `Lock in ${heroTitle(m.hero)}`
  return (
    <button
      disabled={none || m.locked}
      sound="UI.MainMenu.Activate"
      hoverSound="UI.MainMenu.Hover"
      onPress={(player) => lockIn(player)}
      style={{ horizontalAlign: 'center', width: 320, margin: [10, 0, 0, 0], padding: [10, 0], borderRadius: 4, background: none ? '#2a313a' : m.locked ? '#1b222b' : GOLD, borderWidth: m.locked ? 2 : 0, borderColor: GOOD, transition: 0.15 }}
      hover={{ brightness: 1.15 }}
    >
      <label style={{ fontSize: 18, face: 'block', uppercase: true, horizontalAlign: 'center', color: none ? DIM : m.locked ? GOOD : '#151a20' }}>{text}</label>
    </button>
  )
}

// One team's players. Locked picks show to everyone; your teammates' selections show to your team, so
// you can see what they are about to lock in.
function PickColumn(props: { team: number; viewer: Member }) {
  const { team, viewer } = props
  const c = color(team)
  return (
    <panel style={{ flow: 'down', width: 'fill', margin: [0, 6], padding: 8, borderRadius: 6, background: `${c}${viewer.team === team ? '26' : '12'}` }}>
      <label style={{ fontSize: 16, face: 'block', uppercase: true, letterSpacing: 1, color: c, margin: [0, 4, 4, 4] }}>{patronName(team)}</label>
      {teamMembers(team).map((m) => {
        const shown = m.hero !== undefined && (m.locked || m === viewer || viewer.team === team)
        const hero = shown && m.hero !== undefined ? HERO_BY_NAME.get(m.hero) : undefined
        return (
          <panel style={{ flow: 'right', width: 'fill', height: 32, margin: [1, 0], padding: [0, 8], borderRadius: 4, background: '#0000004d', borderWidth: m === viewer ? 2 : 0, borderColor: GOLD }}>
            {hero === undefined ? (
              <panel style={{ width: 22, height: 28, verticalAlign: 'center', borderRadius: 3, background: '#ffffff14' }} />
            ) : (
              <hero hero={hero.id} look="vertical" scaling="cover" style={{ width: 22, height: 28, verticalAlign: 'center', borderRadius: 3, opacity: m.locked ? 1 : 0.5 }} />
            )}
            <label style={{ width: 'fill', verticalAlign: 'center', margin: [0, 0, 0, 10], fontSize: 14, color: TEXT, noWrap: true, textOverflow: 'ellipsis' }}>
              {`${m.name}${m === viewer ? ' (you)' : ''}`}
            </label>
            <label style={{ verticalAlign: 'center', fontSize: 13, color: m.locked ? GOOD : DIM }}>
              {m.locked ? (hero?.title ?? 'Locked') : hero !== undefined ? `${hero.title}?` : 'Picking…'}
            </label>
          </panel>
        )
      })}
    </panel>
  )
}

/** chunk splits a list into rows of size (Panorama's wrapping flow stacks rows). */
function chunk<T>(list: readonly T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size))
  return rows
}

// ---------------------------------------------------------------- match
// The ticket strip sits under the game's own top bar (which keeps the clock and heroes): both
// teams' tickets with the viewer's team first. (Kills show in the game's own kill feed.)
// The cinematic frame: black bars along the top and bottom, with a title and a line under it near the bottom.
function Cinematic(props: { title: string; tone: string; line?: string; lineShown?: boolean }) {
  return (
    <panel style={{ width: '100%', height: '100%' }}>
      <panel style={{ width: '100%', height: 90, verticalAlign: 'top', background: '#000000' }} />
      <panel style={{ width: '100%', height: 90, verticalAlign: 'bottom', background: '#000000' }} />
      <panel enter={{ opacity: 0, translate: [0, 24] }} style={{ flow: 'down', horizontalAlign: 'center', verticalAlign: 'bottom', margin: [0, 0, 130, 0] }}>
        <label style={{ fontSize: 64, face: 'block', uppercase: true, letterSpacing: 4, horizontalAlign: 'center', color: props.tone }}>{props.title}</label>
        <label style={{ fontSize: 20, horizontalAlign: 'center', color: TEXT, opacity: props.lineShown === false ? 0 : 1, transition: 0.4 }}>{props.line ?? ''}</label>
      </panel>
    </panel>
  )
}

// A countdown number, or GO!, in the middle of the screen.
function Count(props: { text: string | undefined }) {
  if (props.text === undefined) return <panel />
  return (
    <label key={`count-${props.text}`} enter={{ opacity: 0, scale: 1.6 }}
      style={{ horizontalAlign: 'center', verticalAlign: 'center', margin: [0, 0, 260, 0], fontSize: 150, face: 'block', color: GOLD }}>{props.text}</label>
  )
}

// The start of a match: the cinematic frame over the view from above (black until the viewer's camera is
// there, which covers their hero being swapped in and moved), then the countdown.
function Intro(props: { viewer: Member }) {
  if (M.counting) {
    return (
      <panel key="intro-count" style={{ width: '100%', height: '100%' }}>
        <Count text={`${Math.max(1, secondsUntil(M.goAt))}`} />
      </panel>
    )
  }
  return (
    <panel key="intro" style={{ width: '100%', height: '100%', background: props.viewer.intro ? '#00000000' : '#000000', transition: 0.5 }}>
      <Cinematic title="Shattered Arena" tone={GOLD} line={M.goAt === undefined ? 'Waiting for everyone...' : 'Drain the enemy tickets. Mind the pits.'} />
    </panel>
  )
}

function Live(props: { viewer: Member; build: number }) {
  const m = props.viewer
  const mine = m.team === SAPPHIRE ? SAPPHIRE : AMBER
  const theirs = mine === AMBER ? SAPPHIRE : AMBER
  return (
    <panel key={`live-${props.build}`} style={{ width: '100%', height: '100%' }}>
      <TopStrip heading="Tickets" keepTeamBar={true}>
        <Score points={[T.tickets[mine], T.tickets[theirs]]} tones={[mine === AMBER ? 'amber' : 'sapphire', theirs === AMBER ? 'amber' : 'sapphire']} />
      </TopStrip>
      <Count text={M.clock - M.liveAt < GO_SECONDS ? 'GO!' : undefined} />
    </panel>
  )
}

// The bonus round: each team's heroes still standing, the viewer's own first, and the seconds left.
function BonusRound(props: { viewer: Member }) {
  const mine = props.viewer.team === SAPPHIRE ? SAPPHIRE : AMBER
  const theirs = mine === AMBER ? SAPPHIRE : AMBER
  // The countdown to the fight, then GO! for a moment.
  const count = B.stage === 'countdown' ? `${Math.max(1, secondsUntil(B.stageEnds))}` : B.stage === 'fight' && M.clock - B.foughtAt < GO_SECONDS ? 'GO!' : undefined
  if (B.stage === 'victory') {
    // Over the Patron shot: the winner, then where everyone is going.
    const w = M.winner ?? AMBER
    return (
      <panel key="bonus-victory" style={{ width: '100%', height: '100%' }}>
        <Cinematic title={`${patronName(w)} wins`} tone={color(w)} line="Moving to the Bonus Round" lineShown={B.stageEnds - M.clock <= BONUS_VICTORY_SECONDS - BONUS_MOVING_AT} />
      </panel>
    )
  }
  if (B.stage === 'reveal') {
    return (
      <panel key="bonus-reveal" style={{ width: '100%', height: '100%' }}>
        <Cinematic title="Bonus Round" tone={GOLD} line="Be the last team standing. No ultimates." />
      </panel>
    )
  }
  return (
    <panel key="bonus" style={{ width: '100%', height: '100%' }}>
      <TopStrip heading={B.stage === 'fight' ? `Bonus round: ${secondsUntil(B.endsAt)}` : 'Bonus round'} keepTeamBar={true}>
        <Score points={[B.alive[mine], B.alive[theirs]]} tones={[mine === AMBER ? 'amber' : 'sapphire', theirs === AMBER ? 'amber' : 'sapphire']} />
      </TopStrip>
      <Count text={count} />
    </panel>
  )
}

// Results columns after the player's name: label and width.
const STAT_COLUMNS: readonly [string, number][] = [['K / D / A', 110], ['Pit throws', 90], ['Hero damage', 110], ['Net worth', 100]]

function Results(props: { viewer: Member }) {
  const m = props.viewer
  const w = M.winner ?? AMBER
  const won = m.team === w
  const title = m.team === undefined ? `${patronName(w)} wins` : won ? 'Victory' : 'Defeat'
  const rows = statRows()
  const team = (t: number) => (
    <panel style={{ flow: 'down', width: 'fill', margin: [6, 0, 0, 0] }}>
      <panel style={{ flow: 'right', width: 'fill', padding: [8, 12], borderRadius: 4, background: `${color(t)}22` }}>
        <label style={{ width: 'fill', fontSize: 18, face: 'block', uppercase: true, color: color(t) }}>{patronName(t)}</label>
        <label style={{ fontSize: 15, color: TEXT, margin: [0, 18, 0, 0] }}>{`${T.tickets[t]} tickets`}</label>
        <label style={{ fontSize: 15, color: DIM, margin: [0, 18, 0, 0] }}>{`${T.heroKills[t]} kills`}</label>
        <label style={{ fontSize: 15, color: PURPLE }}>{`${T.pitKills[t]} pit kills`}</label>
      </panel>
      {rows.filter((r) => r.team === t).map((r) => <StatLine row={r} you={r.member === m} />)}
    </panel>
  )
  return (
    <panel style={{ width: '100%', height: '100%', gradient: { shape: 'radial', colors: ['#0a0f1640', '#03050add'] } }}>
      <panel
        enter={{ opacity: 0, translate: [0, 24] }}
        style={{ flow: 'down', horizontalAlign: 'center', verticalAlign: 'center', width: 860, padding: [26, 28, 24, 28], background: CARD, borderRadius: 8, boxShadow: { blur: 40, color: '#000000aa' } }}
      >
        <label style={{ fontSize: m.team === undefined ? 36 : 52, face: 'block', uppercase: true, letterSpacing: 3, horizontalAlign: 'center', color: won || m.team === undefined ? GOLD : '#ff6060' }}>{title}</label>
        <label style={{ fontSize: 15, horizontalAlign: 'center', color: DIM, margin: [2, 0, M.bonusWinner === undefined ? 14 : 2, 0] }}>{`${patronName(w)} drained the enemy tickets`}</label>
        {M.bonusWinner === undefined ? undefined : (
          <label style={{ fontSize: 15, horizontalAlign: 'center', color: PURPLE, margin: [0, 0, 14, 0] }}>
            {M.bonusWinner === 'draw' ? 'Bonus round: a draw' : `Bonus round: ${patronName(M.bonusWinner)} was the last team standing`}
          </label>
        )}
        <panel style={{ flow: 'right', width: 'fill', padding: [0, 12] }}>
          <label style={{ width: 'fill', fontSize: 12, uppercase: true, color: DIM }}>Player</label>
          {STAT_COLUMNS.map(([label, width]) => (
            <label style={{ width, fontSize: 12, uppercase: true, horizontalAlign: 'right', color: DIM }}>{label}</label>
          ))}
        </panel>
        {team(w)}
        {team(w === AMBER ? SAPPHIRE : AMBER)}
        <label style={{ fontSize: 14, horizontalAlign: 'center', color: DIM, margin: [16, 0, 0, 0] }}>{`Back to team select in ${secondsUntil(M.resultsEnd)}`}</label>
      </panel>
    </panel>
  )
}

// One player's line on the results card. The viewer's own line is highlighted.
function StatLine(props: { row: StatRow; you: boolean }) {
  const r = props.row
  const cell = (text: string, width: number, tint = TEXT) => (
    <label style={{ width, fontSize: 15, horizontalAlign: 'right', color: tint }}>{text}</label>
  )
  const [kda, throws, damage, worth] = STAT_COLUMNS.map(([, width]) => width)
  return (
    <panel style={{ flow: 'right', width: 'fill', padding: [5, 12], margin: [2, 0, 0, 0], borderRadius: 3, background: props.you ? '#ffffff14' : '#00000000' }}>
      <panel style={{ flow: 'right', width: 'fill' }}>
        <label style={{ verticalAlign: 'center', fontSize: 15, bold: props.you, color: TEXT }}>{r.name}</label>
        <label style={{ verticalAlign: 'center', fontSize: 13, color: DIM, margin: [0, 0, 0, 8] }}>{r.hero === undefined ? '' : heroTitle(r.hero)}</label>
        {r.mvp ? (
          <label style={{ verticalAlign: 'center', fontSize: 12, bold: true, color: '#000000', background: GOLD, borderRadius: 3, padding: [1, 6], margin: [0, 0, 0, 8] }}>MVP</label>
        ) : null}
      </panel>
      {r.scored ? cell(`${r.kills} / ${r.deaths} / ${r.assists}`, kda) : cell('–', kda, DIM)}
      {cell(`${r.pitThrows}`, throws, r.pitThrows > 0 ? PURPLE : DIM)}
      {r.scored ? cell(short(r.damage), damage) : cell('–', damage, DIM)}
      {r.scored ? cell(short(r.netWorth), worth, GOLD) : cell('–', worth, DIM)}
    </panel>
  )
}

/** commas writes a whole number in full, such as 9,567. */
function commas(n: number): string {
  return `${Math.round(n)}`.replace(/\B(?=(\d{3})+$)/g, ',')
}

/** short writes a number the way the game does, such as 950, 12.3k or 120k. */
function short(n: number): string {
  if (n < 1000) return `${Math.round(n)}`
  const k = n / 1000
  return `${k >= 100 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)}k`
}
