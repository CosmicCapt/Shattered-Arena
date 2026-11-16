// What each player sees: team select (with ready-up and test bots) and the hero pick, each filling the
// screen in black with a team down each side, then during the match the mod's own top bar (heroes, clock,
// tickets) and the rift bars, and the results scoreboard at the end.
import { type Child, heroes, type Player, show } from 'modlock'

import { B } from '../bonus/bonus'
import { riftProgress } from '../arena/minions'
import { addTestBot, removeTestBot } from '../match/bots' // Bots
import {
  BONUS_MOVING_AT,
  BONUS_VICTORY_SECONDS,
  GO_SECONDS,
  HUD_REBUILD_SECONDS,
  KNOCKBACK_PERCENT_MAX,
  RESPAWN_OPTIONS,
  RIFT_KILLS,
  SOUL_SCALE_MAX,
  SOUL_SCALE_MIN,
  START_SOULS_MAX,
  TICKET_MAX,
  TICKET_MIN,
} from '../config'
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
} from '../match/match'
import { type StatRow, statRows } from '../match/stats'
import { T } from '../rules/tickets'

// The HUD kit's colours (modlock's theme), so these screens match the ticket strip.
const AMBER_COLOR = '#f0a530' // team names and headings
const SAPPHIRE_COLOR = '#7d9fe0'
const AMBER_EDGE = '#d4860b' // team panel edges
const SAPPHIRE_EDGE = '#4d75c3'
const GOLD = '#ebc934'
const TEXT = '#ffefd7'
const MUTED = '#bfb3a1'
const DIM = '#8a857a'
const GOOD = '#36c47f'
const BAD = '#ff6a3d'
const INK = '#10130d' // text on a filled button
const BLACK = '#0b0d09' // the screens' background
const PLATE = '#151611'
const RAISED = '#1e1f19'
const LIT = '#2b2a24'
const PURPLE = '#b05cff'

const color = (team: number | undefined) => (team === AMBER ? AMBER_COLOR : team === SAPPHIRE ? SAPPHIRE_COLOR : DIM)
const edge = (team: number) => (team === AMBER ? AMBER_EDGE : SAPPHIRE_EDGE)
const panelTint = (team: number) => (team === AMBER ? '#21170a' : '#0e1626')
const rowTint = (team: number) => (team === AMBER ? '#2c1f0d' : '#152036')

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

// Team select and the hero pick fill the screen in black: one team down each side, the rest in the middle.
function Screen(props: { viewer: Member }) {
  return (
    <panel style={{ width: '100%', height: '100%', background: BLACK }}>
      <panel style={{ flow: 'right', width: 'fill', height: 'fill', margin: 56 }}>
        {M.phase === 'lobby' ? <Lobby viewer={props.viewer} /> : <HeroPick viewer={props.viewer} />}
      </panel>
    </panel>
  )
}

function Title(props: { size: number; line: string; tone?: string }) {
  return (
    <panel style={{ flow: 'down', horizontalAlign: 'center' }}>
      <label style={{ fontSize: props.size, face: 'block', uppercase: true, letterSpacing: 4, horizontalAlign: 'center', textAlign: 'center', noWrap: true, color: PURPLE }}>Shattered Arena</label>
      <label style={{ fontSize: 22, face: 'block', uppercase: true, letterSpacing: 3, horizontalAlign: 'center', color: props.tone ?? MUTED, margin: [4, 0, 0, 0] }}>{props.line}</label>
    </panel>
  )
}

/** Tag is a small outlined word, such as Host, Bot or Ready. */
function Tag(props: { text: string; tone: string; filled?: boolean }) {
  return (
    <label
      style={{
        verticalAlign: 'center',
        fontSize: 12,
        face: 'block',
        uppercase: true,
        padding: [2, 8],
        borderRadius: 4,
        borderWidth: 1,
        borderColor: props.tone,
        background: props.filled === true ? props.tone : '#00000000',
        color: props.filled === true ? INK : props.tone,
      }}
    >
      {props.text}
    </label>
  )
}

// ---------------------------------------------------------------- lobby
function Lobby(props: { viewer: Member }) {
  const m = props.viewer
  const { ready, total } = readyCount()
  const status = M.countdownAt !== undefined ? `Everyone is ready. Hero select in ${secondsUntil(M.countdownAt)}` : lobbyProblem()
  return (
    <panel enter={{ opacity: 0 }} style={{ flow: 'right', width: 'fill', height: 'fill', transition: 0.25 }}>
      <TeamColumn team={AMBER} viewer={m} />
      <panel style={{ flow: 'down', width: 'fill', verticalAlign: 'center', margin: [0, 48] }}>
        <Title size={60} line="Team select" />
        <HostSettings viewer={m} />
        <label style={{ fontSize: 22, face: 'block', uppercase: true, horizontalAlign: 'center', color: TEXT, margin: [40, 0, 14, 0] }}>{`Ready: ${ready} / ${total}`}</label>
        <ReadyButton viewer={m} />
        <label style={{ fontSize: 18, horizontalAlign: 'center', color: M.countdownAt !== undefined ? GOLD : MUTED, margin: [16, 0, 0, 0] }}>
          {status ?? 'Everyone ready starts the hero pick'}
        </label>
      </panel>
      <TeamColumn team={SAPPHIRE} viewer={m} />
    </panel>
  )
}

// Everyone sees the match options; only the host (the first player in) has − and + to change them.
function HostSettings(props: { viewer: Member }) {
  const h = host()
  const mine = h === props.viewer
  return (
    <panel style={{ flow: 'down', horizontalAlign: 'center', margin: [44, 0, 0, 0], padding: [22, 28, 18, 28], borderRadius: 8, background: PLATE, borderWidth: 1, borderColor: LIT }}>
      <panel style={{ flow: 'right', width: 'fill', margin: [0, 0, 10, 0] }}>
        <label style={{ width: 'fill', verticalAlign: 'center', fontSize: 18, face: 'block', uppercase: true, color: TEXT }}>Match settings</label>
        {mine ? <Tag text="You can change these" tone={GOLD} /> : <Tag text={h === undefined ? 'Set by the host' : `Set by ${h.name}`} tone={MUTED} />}
      </panel>
      <HostSetting mine={mine} label="Tickets per team" value={`${M.startTickets}`}
        change={changeTickets} atMin={M.startTickets <= TICKET_MIN} atMax={M.startTickets >= TICKET_MAX} />
      <HostSetting mine={mine} label="Respawn time" value={`${M.respawnSeconds} s`}
        change={changeRespawn} atMin={M.respawnSeconds <= RESPAWN_OPTIONS[0]} atMax={M.respawnSeconds >= RESPAWN_OPTIONS[RESPAWN_OPTIONS.length - 1]} />
      <HostSetting mine={mine} label="Souls gain" value={`${Math.round(M.soulScale * 100)}%`}
        change={changeSouls} atMin={M.soulScale <= SOUL_SCALE_MIN} atMax={M.soulScale >= SOUL_SCALE_MAX} />
      <StartSoulsSetting mine={mine} />
      <HostSetting mine={mine} label="Melee knockback" value={`${M.knockback}%`}
        change={changeKnockback} atMin={M.knockback <= 0} atMax={M.knockback >= KNOCKBACK_PERCENT_MAX} />
      <HostSetting mine={mine} label="Bonus round" value={M.bonusRound ? 'On' : 'Off'}
        change={changeBonusRound} atMin={!M.bonusRound} atMax={M.bonusRound} />
    </panel>
  )
}

const STEP_SIZE = 36
const TYPED_WIDTH = 106 // the typed souls box and its gap; the other rows keep the space so they line up

function HostSetting(props: {
  mine: boolean
  label: string
  value: string
  change: (player: Player, steps: number) => void
  atMin: boolean
  atMax: boolean
  extra?: Child // shown to the host after the + button
}) {
  const step = (label: string, steps: number, off: boolean) =>
    props.mine ? (
      <button
        disabled={off}
        sound="UI.MainMenu.Activate"
        hoverSound="UI.MainMenu.Hover"
        onPress={(player) => props.change(player, steps)}
        style={{ verticalAlign: 'center', width: STEP_SIZE, height: STEP_SIZE, borderRadius: 4, background: RAISED, borderWidth: 1, borderColor: off ? LIT : '#ffefd740', transition: 0.15 }}
        hover={{ background: LIT }}
      >
        <label style={{ fontSize: 20, bold: true, horizontalAlign: 'center', verticalAlign: 'center', color: off ? DIM : TEXT }}>{label}</label>
      </button>
    ) : (
      <panel style={{ width: STEP_SIZE, height: STEP_SIZE }} />
    )
  return (
    <panel style={{ flow: 'right', height: 48 }}>
      <label style={{ verticalAlign: 'center', width: 190, fontSize: 18, color: MUTED, margin: [0, 14, 0, 0] }}>{props.label}</label>
      {step('−', -1, props.atMin)}
      <label style={{ verticalAlign: 'center', width: 118, fontSize: 26, face: 'block', textAlign: 'center', color: GOLD }}>{props.value}</label>
      {step('+', 1, props.atMax)}
      {props.mine && props.extra !== undefined ? props.extra : <panel style={{ width: TYPED_WIDTH, height: STEP_SIZE }} />}
    </panel>
  )
}

// Starting souls: - and + step through the usual amounts, and the host can also type any amount (such as
// 5000, 5,000 or 5k) into the box. The box is never filled in from the mod, so nothing it sends back can
// overwrite what is being typed. On Hyperline typed text doesn't reach the mod; the buttons do.
function StartSoulsSetting(props: { mine: boolean }) {
  return (
    <HostSetting mine={props.mine} label="Starting souls" value={commas(M.startSouls)} change={changeStartSouls}
      atMin={M.startSouls <= 0} atMax={M.startSouls >= START_SOULS_MAX}
      extra={
        <entry
          placeholder="or type"
          maxLength={8}
          onChange={(player, text) => {
            const souls = parseSouls(text)
            if (souls !== undefined) setStartSouls(player, souls)
          }}
          style={{ verticalAlign: 'center', width: TYPED_WIDTH - 10, height: STEP_SIZE, fontSize: 15, color: TEXT, padding: [4, 10], margin: [0, 0, 0, 10], borderRadius: 4, background: PLATE, borderWidth: 1, borderColor: '#ffefd740' }}
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
        width: 340,
        height: 64,
        borderRadius: 4,
        background: noTeam ? RAISED : m.ready ? RAISED : TEXT,
        borderWidth: noTeam || m.ready ? 1 : 0,
        borderColor: m.ready ? '#ffefd760' : LIT,
        transition: 0.15,
      }}
      hover={{ brightness: 1.15 }}
    >
      <label style={{ fontSize: 26, face: 'block', uppercase: true, horizontalAlign: 'center', verticalAlign: 'center', color: noTeam ? DIM : m.ready ? TEXT : INK }}>
        {noTeam ? 'Pick a team' : m.ready ? 'Not ready' : 'Ready up'}
      </label>
    </button>
  )
}

/** TeamPanel is one team's side of the screen: its name, then its rows. */
function TeamPanel(props: { team: number; viewer: Member; width: number; children?: Child }) {
  const { team } = props
  return (
    <panel style={{ flow: 'down', width: props.width, height: 'fill', padding: [32, 28], borderRadius: 8, background: panelTint(team), borderWidth: 1, borderColor: `${edge(team)}55` }}>
      {props.children}
    </panel>
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
    <TeamPanel team={team} viewer={viewer} width={500}>
      <panel style={{ flow: 'right', width: 'fill', margin: [0, 0, 20, 0] }}>
        <label style={{ width: 'fill', fontSize: 34, face: 'block', uppercase: true, letterSpacing: 1, color: c }}>{patronName(team)}</label>
        <label style={{ verticalAlign: 'bottom', fontSize: 20, face: 'block', color: MUTED }}>{`${list.length} / ${TEAM_SIZE}`}</label>
      </panel>
      {list.map((m) => (
        <PlayerRow member={m} own={m === viewer} />
      ))}
      {Array.from({ length: open }, () => (
        <panel style={{ width: 'fill', height: 64, margin: [0, 0, 10, 0], padding: [0, 18], borderRadius: 4, background: rowTint(team) }}>
          <label style={{ verticalAlign: 'center', fontSize: 17, color: DIM }}>Open</label>
        </panel>
      ))}
      <panel style={{ width: 'fill', height: 'fill' }} />
      <panel style={{ flow: 'right', horizontalAlign: 'center', height: 48 }}>
        {mine || full ? null : (
          <button
            sound="UI.MainMenu.Activate"
            hoverSound="UI.MainMenu.Hover"
            onPress={(player) => chooseTeam(player, team)}
            style={{ verticalAlign: 'center', height: 48, padding: [0, 22], borderRadius: 4, borderWidth: 2, borderColor: c, background: '#00000000', transition: 0.15 }}
            hover={{ background: `${edge(team)}40` }}
          >
            <label style={{ verticalAlign: 'center', fontSize: 17, face: 'block', uppercase: true, color: c }}>Join this team</label>
          </button>
        )}
        {mine ? (
          <panel style={{ verticalAlign: 'center', height: 48, padding: [0, 22], borderRadius: 4, borderWidth: 1, borderColor: LIT, background: RAISED }}>
            <label style={{ verticalAlign: 'center', fontSize: 17, face: 'block', uppercase: true, color: DIM }}>You are here</label>
          </panel>
        ) : null}
        {/* Bots: "+ bot" adds a bot to this team. */}
        {full ? null : (
          <button
            sound="UI.MainMenu.Activate"
            hoverSound="UI.MainMenu.Hover"
            onPress={() => addTestBot(team)}
            style={{ verticalAlign: 'center', height: 48, margin: [0, 0, 0, 12], padding: [0, 22], borderRadius: 4, borderWidth: 1, borderColor: '#ffefd740', background: RAISED, transition: 0.15 }}
            hover={{ background: LIT }}
          >
            <label style={{ verticalAlign: 'center', fontSize: 17, face: 'block', uppercase: true, color: TEXT }}>+ Bot</label>
          </button>
        )}
        {full && !mine ? <label style={{ verticalAlign: 'center', fontSize: 17, color: DIM }}>Team full</label> : null}
      </panel>
    </TeamPanel>
  )
}

function Avatar(props: { member: Member }) {
  const m = props.member
  return m.bot ? (
    // Bots: a badge in place of the Steam picture.
    <panel style={{ width: 40, height: 40, verticalAlign: 'center', borderRadius: 20, background: LIT }}>
      <label style={{ horizontalAlign: 'center', verticalAlign: 'center', fontSize: 11, bold: true, color: DIM }}>BOT</label>
    </panel>
  ) : (
    <avatar steamId={m.steamId} style={{ width: 40, height: 40, borderRadius: 20, verticalAlign: 'center' }} />
  )
}

function PlayerRow(props: { member: Member; own: boolean }) {
  const { member: m, own } = props
  const team = m.team ?? AMBER
  return (
    <panel
      style={{ flow: 'right', width: 'fill', height: 64, margin: [0, 0, 10, 0], padding: [0, 16], borderRadius: 4, background: rowTint(team), borderWidth: 2, borderColor: own ? edge(team) : '#00000000' }}
    >
      <Avatar member={m} />
      <label style={{ verticalAlign: 'center', maxWidth: 230, margin: [0, 0, 0, 14], fontSize: 18, bold: true, color: TEXT, noWrap: true, textOverflow: 'ellipsis' }}>
        {own ? `${m.name} (you)` : m.name}
      </label>
      {host() === m ? <panel style={{ verticalAlign: 'center', margin: [0, 0, 0, 10] }}><Tag text="Host" tone={GOLD} /></panel> : null}
      <panel style={{ width: 'fill', height: 10 }} />
      {m.bot ? (
        // Bots: "×" removes the bot.
        <panel style={{ flow: 'right', verticalAlign: 'center' }}>
          <Tag text="Bot" tone={DIM} />
          <button onPress={() => removeTestBot(m)} tooltip="Remove this bot" style={{ verticalAlign: 'center', width: 28, height: 28, margin: [0, 0, 0, 10], borderRadius: 4, background: RAISED }} hover={{ background: '#ff5a3d66' }}>
            <label style={{ horizontalAlign: 'center', verticalAlign: 'center', fontSize: 15, bold: true, color: TEXT }}>×</label>
          </button>
        </panel>
      ) : m.ready ? (
        <Tag text="Ready" tone={GOOD} />
      ) : (
        <label style={{ verticalAlign: 'center', fontSize: 15, color: DIM }}>Not ready</label>
      )}
    </panel>
  )
}

// --------------------------------------------------------------- heroes
const PICKER_COLUMNS = 10
// The hero list never changes, so its rows (by title) and the lookup by name are made once, not on every
// redraw for every player. Each row is centred, so a short last row sits in the middle.
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
    <panel enter={{ opacity: 0 }} style={{ flow: 'right', width: 'fill', height: 'fill' }}>
      <PickColumn team={AMBER} viewer={m} />
      <panel style={{ flow: 'down', width: 'fill', verticalAlign: 'center', margin: [0, 36] }}>
        <Title size={60} line={status} tone={done || m.locked ? GOOD : GOLD} />
        {team === undefined ? null : (
          <panel style={{ flow: 'down', horizontalAlign: 'center', margin: [28, 0, 0, 0] }}>
            {HERO_ROWS.map((row) => (
              <panel style={{ flow: 'right', horizontalAlign: 'center' }}>
                {row.map((hero) => {
                  const taken = locked.get(hero.name) // a teammate locked it in
                  const mine = m.hero === hero.name
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
                        width: 76,
                        margin: 4,
                        padding: 2,
                        borderRadius: 4,
                        background: mine ? '#fd736d33' : RAISED,
                        borderWidth: 2,
                        borderColor: mine ? '#fd736d' : '#00000000',
                        opacity: taken !== undefined ? 0.3 : mine ? 1 : blocked ? 0.6 : 1,
                        transition: 0.12,
                      }}
                      hover={{ background: LIT, brightness: 1.15 }}
                    >
                      <hero hero={hero.id} look="vertical" scaling="cover" style={{ width: 68, height: 84, borderRadius: 3 }} />
                      <label style={{ fontSize: 12, color: mine ? TEXT : MUTED, horizontalAlign: 'center', margin: [3, 0, 1, 0], noWrap: true, textOverflow: 'shrink' }}>{hero.title}</label>
                    </button>
                  )
                })}
              </panel>
            ))}
          </panel>
        )}
        {team === undefined ? null : <LockButton viewer={m} />}
        {team === undefined ? null : (
          <label style={{ fontSize: 16, horizontalAlign: 'center', color: MUTED, margin: [12, 0, 0, 0] }}>Faded heroes are taken by a teammate</label>
        )}
      </panel>
      <PickColumn team={SAPPHIRE} viewer={m} />
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
      style={{ horizontalAlign: 'center', width: 400, height: 64, margin: [28, 0, 0, 0], borderRadius: 4, background: none || m.locked ? RAISED : TEXT, borderWidth: m.locked ? 2 : none ? 1 : 0, borderColor: m.locked ? GOOD : LIT, transition: 0.15 }}
      hover={{ brightness: 1.15 }}
    >
      <label style={{ fontSize: 26, face: 'block', uppercase: true, horizontalAlign: 'center', verticalAlign: 'center', color: none ? DIM : m.locked ? GOOD : INK }}>{text}</label>
    </button>
  )
}

// One team's players. Locked picks show to everyone, with the hero's portrait and name by the player's
// name; your teammates' selections show to your team, faded, so you can see what they are about to lock in.
function PickColumn(props: { team: number; viewer: Member }) {
  const { team, viewer } = props
  return (
    <TeamPanel team={team} viewer={viewer} width={420}>
      <label style={{ fontSize: 32, face: 'block', uppercase: true, letterSpacing: 1, color: color(team), margin: [0, 0, 20, 0] }}>{patronName(team)}</label>
      {teamMembers(team).map((m) => {
        const shown = m.hero !== undefined && (m.locked || m === viewer || viewer.team === team)
        const hero = shown && m.hero !== undefined ? HERO_BY_NAME.get(m.hero) : undefined
        return (
          <panel style={{ flow: 'right', width: 'fill', height: 76, margin: [0, 0, 10, 0], padding: [0, 14, 0, 8], borderRadius: 4, background: rowTint(team), borderWidth: 2, borderColor: m === viewer ? edge(team) : '#00000000' }}>
            {hero === undefined ? (
              <panel style={{ width: 56, height: 56, verticalAlign: 'center', borderRadius: 4, background: RAISED, borderWidth: 1, borderColor: '#ffefd733' }} />
            ) : (
              <hero hero={hero.id} look="small" scaling="cover"
                style={{ width: 56, height: 56, verticalAlign: 'center', borderRadius: 4, borderWidth: m.locked ? 2 : 0, borderColor: edge(team), opacity: m.locked ? 1 : 0.5 }} />
            )}
            <label style={{ width: 'fill', verticalAlign: 'center', margin: [0, 10, 0, 14], fontSize: 18, bold: true, color: TEXT, noWrap: true, textOverflow: 'ellipsis' }}>
              {`${m.name}${m === viewer ? ' (you)' : ''}`}
            </label>
            {m.locked ? (
              <label style={{ verticalAlign: 'center', fontSize: 16, face: 'block', uppercase: true, color: TEXT }}>{hero?.title ?? 'Locked'}</label>
            ) : (
              <label style={{ verticalAlign: 'center', fontSize: 16, color: hero !== undefined ? MUTED : DIM }}>{hero !== undefined ? `${hero.title}…` : 'Picking…'}</label>
            )}
          </panel>
        )
      })}
    </TeamPanel>
  )
}

/** chunk splits a list into rows of size (Panorama's wrapping flow stacks rows). */
function chunk<T>(list: readonly T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size))
  return rows
}

// ---------------------------------------------------------------- match
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
  return (
    <panel key={`live-${props.build}`} style={{ width: '100%', height: '100%' }}>
      <TopBar viewer={props.viewer} />
      <RiftBars viewer={props.viewer} />
      <Count text={M.clock - M.liveAt < GO_SECONDS ? 'GO!' : undefined} />
    </panel>
  )
}

// ---------------------------------------------------------------- the top bar
// The game's own top bar is hidden (match.ts): its team counters show team souls, which mean nothing here.
// In its place: the viewer's team on the left and the other on the right, each hero in a ring of its
// team's colour, greyed with the seconds to its respawn while dead, with a dot under it that lights gold
// while its ultimate is ready; in the middle the match clock and the tickets, or in the bonus round its
// timer and the heroes left.
const PORTRAIT = 60
const RING = 3
const HERO_STEP = 74 // a hero's width in the bar, with the gap
const ULT_SLOT = 3
const ULT_CHECK_SECONDS = 1 // player.abilities() can take 20 ms: each hero's is read once a second at most

interface Watch {
  alive: boolean
  diedAt: number
  ultReady: boolean
  ultCheckAt: number
}
const watched = new WeakMap<Member, Watch>()

/** watch keeps each hero's alive state, when it died, and whether its ultimate is ready. */
function watch(m: Member, index: number): Watch {
  let w = watched.get(m)
  if (w === undefined) watched.set(m, (w = { alive: true, diedAt: 0, ultReady: false, ultCheckAt: M.clock + index * 0.08 }))
  const pawn = cast.pawn(m.player)
  const alive = pawn !== undefined && pawn.health > 0
  if (w.alive && !alive) w.diedAt = M.clock
  w.alive = alive
  if (M.clock >= w.ultCheckAt) {
    w.ultCheckAt = M.clock + ULT_CHECK_SECONDS
    const ult = alive ? m.player.abilities().find((a) => a.slot === ULT_SLOT) : undefined
    // Cooldowns are kept in the game's time (M.lastFrame), not the mod's own clock (M.clock).
    w.ultReady = ult !== undefined && (ult.upgrades & 1) !== 0 && ult.cooldownEnd <= (M.lastFrame ?? 0)
  }
  return w
}

function TopBar(props: { viewer: Member; bonus?: boolean }) {
  const v = props.viewer
  const mine = v.team === SAPPHIRE ? SAPPHIRE : AMBER
  const theirs = mine === AMBER ? SAPPHIRE : AMBER
  const all = members()
  // The viewer's team: the viewer nearest the middle, then the rest outward. The other team outward too.
  const own = teamMembers(mine).filter((m) => m.hero !== undefined)
  own.sort((a, b) => (a === v ? -1 : b === v ? 1 : 0))
  const other = teamMembers(theirs).filter((m) => m.hero !== undefined)
  const heroes = (list: Member[], team: number, reversed: boolean) => {
    const cells = list.map((m) => <BarHero member={m} team={team} you={m === v} bonus={props.bonus === true} w={watch(m, all.indexOf(m))} />)
    return <panel style={{ flow: 'right', width: HERO_STEP * TEAM_SIZE }}>{reversed ? cells.reverse() : cells}</panel>
  }
  const clock = Math.max(0, Math.floor(M.clock - M.liveAt))
  const left = heroes(own, mine, true)
  return (
    <panel style={{ flow: 'right', horizontalAlign: 'center', margin: [8, 0, 0, 0] }}>
      <panel style={{ flow: 'right', width: HERO_STEP * TEAM_SIZE }}>
        <panel style={{ width: HERO_STEP * (TEAM_SIZE - own.length), height: 10 }} />
        {left}
      </panel>
      <panel style={{ flow: 'down', width: 300, height: 104, margin: [0, 16], padding: [8, 0], borderRadius: 8, background: '#000000d9', borderWidth: 1, borderColor: LIT }}>
        {props.bonus === true ? (
          <label style={{ horizontalAlign: 'center', fontSize: 17, face: 'block', uppercase: true, color: GOLD }}>
            {B.stage === 'fight' ? `Bonus round  ${clockText(secondsUntil(B.endsAt))}` : 'Bonus round'}
          </label>
        ) : (
          <label style={{ horizontalAlign: 'center', fontSize: 17, face: 'block', color: TEXT }}>{clockText(clock)}</label>
        )}
        <panel style={{ flow: 'right', horizontalAlign: 'center', margin: [2, 0, 0, 0] }}>
          <label style={{ width: 110, textAlign: 'right', fontSize: 44, face: 'block', color: color(mine) }}>{`${props.bonus === true ? B.alive[mine] : T.tickets[mine]}`}</label>
          <label style={{ width: 36, textAlign: 'center', fontSize: 40, face: 'block', color: MUTED }}>:</label>
          <label style={{ width: 110, textAlign: 'left', fontSize: 44, face: 'block', color: color(theirs) }}>{`${props.bonus === true ? B.alive[theirs] : T.tickets[theirs]}`}</label>
        </panel>
        <label style={{ horizontalAlign: 'center', fontSize: 13, face: 'block', uppercase: true, letterSpacing: 1, color: MUTED }}>{props.bonus === true ? 'Heroes left' : 'Tickets'}</label>
      </panel>
      {heroes(other, theirs, false)}
    </panel>
  )
}

function BarHero(props: { member: Member; team: number; you: boolean; bonus: boolean; w: Watch }) {
  const { member: m, w } = props
  const hero = m.hero === undefined ? undefined : HERO_BY_NAME.get(m.hero)
  const respawn = Math.ceil(w.diedAt + M.respawnSeconds - M.clock)
  const size = PORTRAIT + RING * 2
  return (
    <panel style={{ flow: 'down', width: HERO_STEP }}>
      <panel style={{ horizontalAlign: 'center', width: size, height: size, padding: RING, borderRadius: size / 2, background: edge(props.team) }}>
        {hero === undefined ? null : (
          <hero hero={hero.id} look="small" scaling="cover" tooltip={`${m.name} · ${hero.title}`}
            style={{ width: PORTRAIT, height: PORTRAIT, borderRadius: PORTRAIT / 2, saturation: w.alive ? 1 : 0, brightness: w.alive ? 1 : 0.55 }} />
        )}
        {!w.alive && !props.bonus && respawn > 0 ? (
          <label style={{ horizontalAlign: 'center', verticalAlign: 'center', fontSize: 26, face: 'block', color: TEXT }}>{`${respawn}`}</label>
        ) : null}
      </panel>
      {props.bonus ? (
        <panel style={{ height: 18, margin: [6, 0, 0, 0] }} />
      ) : (
        <panel style={{ horizontalAlign: 'center', width: 18, height: 18, margin: [6, 0, 0, 0], borderRadius: 9,
          background: w.ultReady ? GOLD : '#10130dcc', borderWidth: w.ultReady ? 0 : 2, borderColor: DIM }}>
          {w.ultReady ? <panel style={{ horizontalAlign: 'center', verticalAlign: 'center', width: 6, height: 6, borderRadius: 3, background: INK }} /> : null}
        </panel>
      )}
      {props.you ? <label style={{ horizontalAlign: 'center', fontSize: 11, face: 'block', uppercase: true, color: TEXT, margin: [3, 0, 0, 0] }}>You</label> : null}
    </panel>
  )
}

/** clockText writes seconds as m:ss. */
function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`
}

// ---------------------------------------------------------------- the rift bars
// Bottom right, during the match only: each team's progress to its next rift wave (one notch for each
// enemy death, RIFT_KILLS to a wave), the viewer's team first; the colours tell them apart.
const RIFT_TRACK = 240

function RiftBars(props: { viewer: Member }) {
  const mine = props.viewer.team === SAPPHIRE ? SAPPHIRE : AMBER
  const theirs = mine === AMBER ? SAPPHIRE : AMBER
  const bar = (team: number) => {
    const n = riftProgress(team)
    return (
      <panel style={{ flow: 'down', width: 50 }}>
        <panel style={{ horizontalAlign: 'center', width: 22, height: RIFT_TRACK, borderRadius: 4, background: RAISED, borderWidth: 1, borderColor: '#3c3a34' }}>
          <panel style={{ verticalAlign: 'bottom', horizontalAlign: 'center', width: 16, height: Math.round(((RIFT_TRACK - 6) * n) / RIFT_KILLS), margin: [0, 0, 3, 0], borderRadius: 3, background: edge(team), transition: 0.3 }} />
          {Array.from({ length: RIFT_KILLS - 1 }, (_, i) => (
            <panel style={{ verticalAlign: 'bottom', horizontalAlign: 'center', width: 18, height: 1, margin: [0, 0, Math.round((RIFT_TRACK * (i + 1)) / RIFT_KILLS), 0], background: '#000000a0' }} />
          ))}
        </panel>
        <label style={{ horizontalAlign: 'center', fontSize: 14, face: 'block', color: color(team), margin: [8, 0, 0, 0] }}>{`${n}/${RIFT_KILLS}`}</label>
      </panel>
    )
  }
  return (
    <panel style={{ flow: 'down', horizontalAlign: 'right', verticalAlign: 'bottom', width: 110, margin: [0, 20, 8, 0], padding: [12, 5, 10, 5], borderRadius: 8, background: '#000000d9', borderWidth: 1, borderColor: LIT }}>
      <label style={{ horizontalAlign: 'center', fontSize: 16, face: 'block', uppercase: true, color: '#cd96ff' }}>Rift</label>
      <label style={{ horizontalAlign: 'center', fontSize: 11, face: 'block', uppercase: true, color: MUTED, margin: [0, 0, 12, 0] }}>Minions</label>
      <panel style={{ flow: 'right', horizontalAlign: 'center' }}>
        {bar(mine)}
        {bar(theirs)}
      </panel>
    </panel>
  )
}

// The bonus round: the top bar with each team's heroes still standing and the seconds left (no rift bars).
function BonusRound(props: { viewer: Member }) {
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
      <TopBar viewer={props.viewer} bonus={true} />
      <Count text={count} />
    </panel>
  )
}

// The results columns: the player (name, hero icon, MVP), then the stats, then the items. The team banners
// use the same columns, so each team total sits over the column it adds up: kills over K / D / A, pit
// kills over pit throws, and tickets across hero damage and net worth.
const COL = { player: 390, kda: 130, throws: 110, damage: 130, worth: 120 }
const COL_GAP = 16
const MAX_ITEMS = 16
const SLOT_TINT = { weapon: '#c97a2c', vitality: '#5fa84a', spirit: '#9a62d6' }

function Results(props: { viewer: Member }) {
  const m = props.viewer
  const w = M.winner ?? AMBER
  const won = m.team === w
  const title = m.team === undefined ? `${patronName(w)} wins` : won ? 'Victory' : 'Defeat'
  const rows = statRows()
  const cell = (width: number, child: Child) => <panel style={{ width, height: 'fill', margin: [0, COL_GAP, 0, 0] }}>{child}</panel>
  const total = (value: number, label: string, tone: string) => (
    <panel style={{ flow: 'right', verticalAlign: 'center' }}>
      <label style={{ verticalAlign: 'bottom', fontSize: 26, face: 'block', color: tone }}>{`${value}`}</label>
      <label style={{ verticalAlign: 'bottom', fontSize: 14, face: 'block', uppercase: true, color: MUTED, margin: [0, 0, 3, 8] }}>{label}</label>
    </panel>
  )
  const team = (t: number) => (
    <panel style={{ flow: 'down', width: 'fill' }}>
      <panel style={{ flow: 'right', width: 'fill', height: 56, margin: [10, 0, 0, 0], padding: [0, 20], borderRadius: 4, background: panelTint(t), borderWidth: 1, borderColor: edge(t) }}>
        {cell(COL.player, <label style={{ verticalAlign: 'center', fontSize: 26, face: 'block', uppercase: true, color: color(t) }}>{patronName(t)}</label>)}
        {cell(COL.kda, total(T.heroKills[t], 'kills', TEXT))}
        {cell(COL.throws, total(T.pitKills[t], 'pit kills', PURPLE))}
        {cell(COL.damage + COL_GAP + COL.worth, <panel style={{ horizontalAlign: 'center', verticalAlign: 'center' }}>{total(T.tickets[t], 'tickets', GOLD)}</panel>)}
      </panel>
      {rows.filter((r) => r.team === t).map((r) => <StatLine row={r} you={r.member === m} />)}
    </panel>
  )
  const head = (width: number, text: string) => cell(width, <label style={{ fontSize: 14, face: 'block', uppercase: true, color: MUTED }}>{text}</label>)
  return (
    <panel style={{ width: '100%', height: '100%', background: BLACK }}>
    <panel enter={{ opacity: 0 }} style={{ flow: 'down', width: 'fill', height: 'fill', margin: [44, 80, 36, 80] }}>
      <label style={{ fontSize: m.team === undefined ? 72 : 96, face: 'block', uppercase: true, letterSpacing: 6, horizontalAlign: 'center', color: won || m.team === undefined ? GOLD : BAD }}>{title}</label>
      <panel style={{ flow: 'right', width: 'fill', margin: [28, 0, 0, 0], padding: [0, 20] }}>
        {head(COL.player, 'Player')}
        {head(COL.kda, 'K / D / A')}
        {head(COL.throws, 'Pit throws')}
        {head(COL.damage, 'Hero damage')}
        {head(COL.worth, 'Net worth')}
        <label style={{ fontSize: 14, face: 'block', uppercase: true, color: MUTED }}>Items</label>
      </panel>
      {team(w)}
      {team(w === AMBER ? SAPPHIRE : AMBER)}
      <panel style={{ width: 'fill', height: 'fill' }} />
      <BonusLine viewer={m} />
      <label style={{ fontSize: 17, horizontalAlign: 'center', color: MUTED, margin: [18, 0, 0, 0] }}>{`Back to team select in ${secondsUntil(M.resultsEnd)}`}</label>
    </panel>
    </panel>
  )
}

// Whether the viewer's team won the bonus round. Nothing shows when there was no bonus round.
function BonusLine(props: { viewer: Member }) {
  const b = M.bonusWinner
  if (b === undefined) return <panel />
  const t = props.viewer.team
  const [text, tone] =
    b === 'draw' ? ['Draw', MUTED] : t === undefined ? [`${patronName(b)} won`, color(b)] : t === b ? ['Won', GOOD] : ['Lost', BAD]
  return (
    <panel style={{ flow: 'down', horizontalAlign: 'center' }}>
      <label style={{ fontSize: 18, face: 'block', uppercase: true, letterSpacing: 3, horizontalAlign: 'center', color: MUTED }}>Bonus round</label>
      <label style={{ fontSize: t === undefined ? 36 : 48, face: 'block', uppercase: true, horizontalAlign: 'center', color: tone, margin: [6, 0, 0, 0] }}>{text}</label>
    </panel>
  )
}

// One player's line on the results card. The viewer's own line is highlighted.
function StatLine(props: { row: StatRow; you: boolean }) {
  const r = props.row
  const hero = r.hero === undefined ? undefined : HERO_BY_NAME.get(r.hero)
  const cell = (text: string, width: number, tint = TEXT) => (
    <label style={{ width, verticalAlign: 'center', fontSize: 18, color: tint, margin: [0, COL_GAP, 0, 0] }}>{text}</label>
  )
  return (
    <panel style={{ flow: 'down', width: 'fill' }}>
    <panel style={{ flow: 'right', width: 'fill', height: 45, padding: [0, 20], background: props.you ? LIT : '#00000000' }}>
      <panel style={{ flow: 'right', width: COL.player, height: 'fill', margin: [0, COL_GAP, 0, 0] }}>
        <label style={{ verticalAlign: 'center', maxWidth: 230, fontSize: 18, bold: props.you, color: TEXT, noWrap: true, textOverflow: 'ellipsis' }}>{r.name}</label>
        {hero === undefined ? null : (
          <hero hero={hero.id} look="small" scaling="cover" tooltip={hero.title}
            style={{ width: 34, height: 34, verticalAlign: 'center', margin: [0, 0, 0, 12], borderRadius: 4, borderWidth: 1, borderColor: LIT }} />
        )}
        {r.mvp ? <panel style={{ verticalAlign: 'center', margin: [0, 0, 0, 10] }}><Tag text="MVP" tone={GOLD} filled={true} /></panel> : null}
      </panel>
      {r.scored ? cell(`${r.kills} / ${r.deaths} / ${r.assists}`, COL.kda) : cell('–', COL.kda, DIM)}
      {cell(`${r.pitThrows}`, COL.throws, r.pitThrows > 0 ? PURPLE : MUTED)}
      {r.scored ? cell(short(r.damage), COL.damage) : cell('–', COL.damage, DIM)}
      {r.scored ? cell(short(r.netWorth), COL.worth, GOLD) : cell('–', COL.worth, DIM)}
      <panel style={{ flow: 'right', verticalAlign: 'center' }}>
        {r.items.slice(0, MAX_ITEMS).map((it) => (
          <image src={it.icon} item={it.name} scaling="fit"
            style={{ width: 26, height: 26, margin: [0, 3, 0, 0], padding: 2, borderRadius: 3, background: `${SLOT_TINT[it.slot]}33`, borderWidth: 1, borderColor: SLOT_TINT[it.slot] }} />
        ))}
      </panel>
    </panel>
    <panel style={{ width: 'fill', height: 1, background: LIT }} />
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
