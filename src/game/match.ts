import { AudioManager } from './audio'
import { Ball } from './ball'
import {
  BALL,
  DIFFICULTY,
  FORMATION_433,
  FOUL,
  GOAL,
  MATCH_RULES,
  PITCH,
  PLAYER,
  clamp,
  dist2d,
} from './constants'
import type { InputManager } from './input'
import { PlayerEntity, type KitMaterials } from './player'
import { getRoster } from './teams'
import type {
  CameraMode,
  Difficulty,
  FullTimeResult,
  HudState,
  MatchConfig,
  MatchEvent,
  MatchSettings,
  PlayerData,
  SubResult,
  SubState,
  TeamIndex,
  TeamRoster,
} from './types'
import { updateMatchAI } from './ai'

interface Squad {
  roster: TeamRoster
  players: PlayerEntity[]
  /** suplentes (banco) y marca de los ya utilizados */
  bench: PlayerData[]
  benchUsed: boolean[]
  subsUsed: number
  attackDir: 1 | -1
  score: number
  possession: number
  shots: number
  onTarget: number
  fouls: number
  yellows: number
  reds: number
}

export interface RestartInfo {
  type: 'throwin' | 'corner' | 'goalkick'
  team: TeamIndex
  x: number
  z: number
}

export class Match {
  config: MatchConfig
  settings: MatchSettings
  difficulty: Difficulty
  diff: (typeof DIFFICULTY)[Difficulty] = DIFFICULTY.profesional
  squads: [Squad, Squad]
  ball = new Ball()
  phase: HudState['phase'] = 'kickoff'
  phaseTimer = 0
  clock = 0
  durationSec: number
  half: 1 | 2 = 1
  owner: PlayerEntity | null = null
  ownerHold = 0
  gkHold = 0
  lastTouchPlayer: PlayerEntity | null = null
  controlled: PlayerEntity | null = null
  switchHysteresis = 0
  charge = 0
  charging = false
  restart: RestartInfo | null = null
  events: MatchEvent[] = []
  audio: AudioManager
  input: InputManager
  kitMats: [KitMaterials, KitMaterials]
  /** excitación 0..1 para multitud/cámara */
  excitement = 0
  private shotWindow = 0
  private shotTeam: TeamIndex | null = null
  private pendingShot = false
  private lastOutWasNearMiss = false
  aiPassHint: PlayerEntity | null = null
  private ballPrevX = 0
  private celebrateScorer: string | null = null
  private celebrateTeam: TeamIndex | null = null
  private kickoffTeam: TeamIndex = 0
  private finished = false
  /** tarjeta mostrada en pantalla (con temporizador) */
  cardOverlay: HudState['cardOverlay'] = null
  private cardTimer = 0
  /** tiro libre / penal en curso */
  setPieceInfo: { type: 'freekick' | 'penalty'; team: TeamIndex; x: number; z: number } | null = null
  private setPieceTaker: PlayerEntity | null = null
  private setPieceReady = false

  constructor(
    config: MatchConfig,
    input: InputManager,
    audio: AudioManager,
    kitMats: [KitMaterials, KitMaterials],
  ) {
    this.config = config
    this.settings = config.settings
    this.difficulty = config.settings.difficulty
    this.diff = DIFFICULTY[this.difficulty]
    this.durationSec = Math.max(30, config.settings.durationMin * 60)
    this.input = input
    this.audio = audio
    this.kitMats = kitMats

    const home = getRoster(config.homeTeamId)
    const away = getRoster(config.awayTeamId)
    this.squads = [this.buildSquad(home, 0, 1), this.buildSquad(away, 1, -1)]
    this.setupKickoff(0)
  }

  private buildSquad(roster: TeamRoster, team: TeamIndex, attackDir: 1 | -1): Squad {
    const players = roster.players.map(
      (data: PlayerData, i) =>
        new PlayerEntity(data, team, FORMATION_433[i].ax, FORMATION_433[i].az, this.kitMats[team]),
    )
    // el drenaje se escala con la duración real del partido para que el cansancio
    // importe tanto en un partido de 3 como de 8 minutos
    const drain = clamp(PLAYER.staminaDrainRef / this.durationSec, 0.25, 0.95)
    for (const p of players) p.staminaDrainRate = drain
    return {
      roster,
      players,
      bench: roster.bench,
      benchUsed: roster.bench.map(() => false),
      subsUsed: 0,
      attackDir,
      score: 0,
      possession: 0,
      shots: 0,
      onTarget: 0,
      fouls: 0,
      yellows: 0,
      reds: 0,
    }
  }

  get teams() {
    return this.squads
  }

  squad(team: TeamIndex): Squad {
    return this.squads[team]
  }

  /** Arco que ATACA el equipo (x del arco rival). */
  goalOf(team: TeamIndex): number {
    return this.squads[team].attackDir > 0 ? PITCH.L : 0
  }

  /** Arco que DEFIENDE el equipo. */
  ownGoalOf(team: TeamIndex): number {
    return this.squads[team].attackDir > 0 ? 0 : PITCH.L
  }

  minute(): number {
    return Math.min(90, Math.floor((this.clock / this.durationSec) * MATCH_RULES.realMinutesPerMatch))
  }

  addEvent(text: string, kind: MatchEvent['kind'] = 'info') {
    this.events.push({ minute: this.minute(), text, kind })
    if (this.events.length > 40) this.events.shift()
  }

  // ---------------------------------------------------------------- fases

  setupKickoff(kickingTeam: TeamIndex) {
    this.phase = 'kickoff'
    this.phaseTimer = MATCH_RULES.kickoffFreeze
    this.kickoffTeam = kickingTeam
    this.owner = null
    this.setPieceInfo = null
    this.setPieceTaker = null
    this.setPieceReady = false
    this.ball.reset()
    for (const sq of this.squads) this.placeFormation(sq, kickingTeam)
    const sqK = this.squads[kickingTeam]
    let taker = sqK.players[9] // FW central
    if (!taker || taker.sentOff) {
      taker = sqK.players.find((p) => !p.isGK && !p.sentOff) ?? taker
    }
    if (taker) {
      taker.teleport(PITCH.L / 2 - this.squads[kickingTeam].attackDir * 0.8, PITCH.W / 2)
      this.gainControl(taker)
    }
    this.controlled = kickingTeam === 0 ? (taker ?? null) : null
    this.audio.whistle(1)
  }

  private placeFormation(sq: Squad, kickingTeam: TeamIndex) {
    for (const p of sq.players) {
      if (p.sentOff) continue // el expulsado permanece fuera del campo
      let wx = sq.attackDir > 0 ? p.ax * PITCH.L : (1 - p.ax) * PITCH.L
      let wz = p.az * PITCH.W
      // todos en su propia mitad en el saque
      if (sq.attackDir > 0) wx = Math.min(wx, PITCH.L / 2 - 0.5)
      else wx = Math.max(wx, PITCH.L / 2 + 0.5)
      // rivales fuera del círculo central
      if (sq.attackDir !== this.squads[kickingTeam].attackDir) {
        const d = dist2d(wx, wz, PITCH.L / 2, PITCH.W / 2)
        if (d < PITCH.circleR + 1) {
          const ux = (wx - PITCH.L / 2) / (d || 1)
          const uz = (wz - PITCH.W / 2) / (d || 1)
          wx = PITCH.L / 2 + ux * (PITCH.circleR + 1.5)
          wz = PITCH.W / 2 + uz * (PITCH.circleR + 1.5)
        }
      }
      p.teleport(clamp(wx, 1, PITCH.L - 1), clamp(wz, 1, PITCH.W - 1))
      p.targetX = p.x
      p.targetZ = p.z
    }
  }

  private setRestart(info: RestartInfo) {
    this.phase = 'restart'
    this.phaseTimer = MATCH_RULES.restartFreeze
    this.restart = info
    this.ball.reset(info.x, info.z)
    this.owner = null
    const squad = this.squads[info.team]
    let best: PlayerEntity | null = null
    let bestD = Infinity
    for (const p of squad.players) {
      if (p.sentOff) continue
      if (info.type === 'goalkick' ? !p.isGK : p.isGK) continue
      const d = dist2d(p.x, p.z, info.x, info.z)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    if (best) {
      best.teleport(info.x - Math.sign(info.x - PITCH.L / 2) * 0.9, info.z)
      this.gainControl(best)
      if (info.team === 0) this.controlled = best
      else this.controlled = null
    }
  }

  private handleGoal(scoringTeam: TeamIndex) {
    const sq = this.squads[scoringTeam]
    sq.score++
    if (this.pendingShot && this.shotTeam === scoringTeam) {
      sq.onTarget++
    }
    const scorer = this.lastTouchPlayer
    const own = scorer && scorer.team !== scoringTeam
    const name = scorer ? scorer.data.name : 'desconocido'
    this.celebrateScorer = own ? `${name} (autogol)` : name
    this.celebrateTeam = scoringTeam
    this.phase = 'goal'
    this.phaseTimer = MATCH_RULES.goalCelebration
    this.owner = null
    this.pendingShot = false
    this.audio.goalRoar()
    this.excitement = 1
    this.addEvent(`¡GOL de ${this.celebrateScorer} (${sq.roster.def.short})!`, 'goal')
  }

  finishHalf() {
    this.phase = 'half'
    this.phaseTimer = MATCH_RULES.halfTimePause
    this.audio.whistle(2)
    this.addEvent('Final del primer tiempo', 'info')
  }

  private goFullTime() {
    this.phase = 'full'
    this.finished = true
    this.audio.whistle(3, true)
    this.addEvent('Final del partido', 'info')
  }

  get result(): FullTimeResult {
    const [h, a] = this.squads
    const tot = Math.max(0.001, h.possession + a.possession)
    return {
      home: h.roster.def,
      away: a.roster.def,
      score: [h.score, a.score],
      possession: [Math.round((h.possession / tot) * 100), Math.round((a.possession / tot) * 100)],
      shots: [h.shots, a.shots],
      onTarget: [h.onTarget, a.onTarget],
      fouls: [h.fouls, a.fouls],
      yellows: [h.yellows, a.yellows],
      reds: [h.reds, a.reds],
      events: [...this.events],
      difficulty: this.difficulty,
      durationSec: this.durationSec,
    }
  }

  get goalInfo() {
    return this.celebrateScorer && this.celebrateTeam !== null
      ? { team: this.celebrateTeam, scorer: this.celebrateScorer }
      : null
  }

  // ---------------------------------------------------------------- control del balón

  gainControl(p: PlayerEntity) {
    this.owner = p
    p.hasBall = true
    this.ownerHold = 0
    this.aiPassHint = null
    this.gkHold = p.isGK ? (p.team === 0 ? 2.5 : MATCH_RULES.gkHoldTime) : 0
    this.ball.lastTouch = p.team
    this.lastTouchPlayer = p
    if (p.team === 0) this.controlled = p
  }

  loseControl() {
    if (this.owner) this.owner.hasBall = false
    this.owner = null
  }

  private kickBall(p: PlayerEntity, dx: number, dz: number, speed: number, vz: number) {
    this.ball.kick(dx, dz, speed, vz)
    this.loseControl()
    p.kickCooldown = PLAYER.kickCooldown
    p.kickAnim = 0.32
    this.ball.lastTouch = p.team
    this.lastTouchPlayer = p
    this.aiPassHint = null
    this.audio.kick(clamp(speed / 28, 0.2, 1))
  }

  /** Pase raso o alto hacia el mejor compañero según dirección deseada. */
  doPass(p: PlayerEntity, aimX: number, aimZ: number, lofted = false) {
    if (p.kickCooldown > 0) return
    const receiver = this.pickPassTarget(p, aimX, aimZ, lofted)
    if (!receiver) {
      // despeje hacia adelante
      const dir = this.squads[p.team].attackDir
      this.kickBall(p, dir, (Math.random() - 0.5) * 20, 16, 4)
      return
    }
    const err = (1 - p.data.skill) * this.diff.passErr * (lofted ? 1.6 : 1)
    const noise = (Math.random() - 0.5) * 2 * err
    const cs = Math.cos(noise)
    const sn = Math.sin(noise)
    const dist = dist2d(p.x, p.z, receiver.x, receiver.z)
    const speed = lofted ? clamp(10 + dist * 0.42, 13, 20) : clamp(9 + dist * 0.55, 10, 21)
    // punto adelantado hacia donde corre el receptor
    const lead = lofted ? 0.35 : 0.45
    let dx = receiver.x + receiver.vx * lead - p.x
    let dz = receiver.z + receiver.vz * lead - p.z
    const rx = dx * cs - dz * sn
    const rz = dx * sn + dz * cs
    const vz = lofted ? clamp(dist * 0.32, 3, 8.5) : 0.35
    this.kickBall(p, rx, rz, speed, vz)
    if (p.team === 0 && !lofted) this.controlled = receiver
    if (p.team === 1) this.aiPassHint = receiver
  }

  private pickPassTarget(p: PlayerEntity, aimX: number, aimZ: number, lofted: boolean): PlayerEntity | null {
    const aimLen = Math.hypot(aimX, aimZ)
    const nx = aimLen > 0.1 ? aimX / aimLen : Math.sin(p.dir)
    const nz = aimLen > 0.1 ? aimZ / aimLen : Math.cos(p.dir)
    const squad = this.squads[p.team]
    let best: PlayerEntity | null = null
    let bestScore = -Infinity
    for (const mate of squad.players) {
      if (mate === p || mate.isGK || mate.sentOff) continue
      const dx = mate.x - p.x
      const dz = mate.z - p.z
      const d = Math.hypot(dx, dz)
      if (d < 2.5 || d > (lofted ? 55 : 34)) continue
      const dot = (dx / d) * nx + (dz / d) * nz
      if (!lofted && dot < 0.2) continue
      const open = this.closestOppDist(mate)
      let lanePen = 0
      if (!lofted) lanePen = this.laneBlocked(p, mate) ? 2.5 : 0
      const score = dot * 3 + open * 0.35 - d * 0.045 - lanePen
      if (score > bestScore) {
        bestScore = score
        best = mate
      }
    }
    return best
  }

  private closestOppDist(p: PlayerEntity): number {
    const opp = this.squads[p.team === 0 ? 1 : 0].players
    let d = Infinity
    for (const o of opp) {
      if (o.sentOff) continue
      d = Math.min(d, dist2d(o.x, o.z, p.x, p.z))
    }
    return d
  }

  private laneBlocked(from: PlayerEntity, to: PlayerEntity): boolean {
    const opp = this.squads[from.team === 0 ? 1 : 0].players
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = Math.hypot(dx, dz) || 1
    for (const o of opp) {
      if (o.sentOff) continue
      const t = clamp(((o.x - from.x) * dx + (o.z - from.z) * dz) / (len * len), 0.1, 0.9)
      const px = from.x + dx * t
      const pz = from.z + dz * t
      if (dist2d(o.x, o.z, px, pz) < 1.3) return true
    }
    return false
  }

  /** Disparo al arco. power 0..1, aim = componente perpendicular del input. */
  doShoot(p: PlayerEntity, power: number, aim: number) {
    if (p.kickCooldown > 0) return
    const gx = this.goalOf(p.team)
    const dirX = gx > p.x ? 1 : -1
    const dist = Math.abs(gx - p.x)
    const noise = (1 - p.data.skill) * this.diff.shootErr * (2 + dist * 0.06) + power * 0.04
    const angle = (Math.random() - 0.5) * 2 * noise
    let dz = GOAL.zCenter - p.z + aim * 3.4
    let dx = dirX * Math.max(8, dist)
    const cs = Math.cos(angle)
    const sn = Math.sin(angle)
    const rx = dx * cs - dz * sn
    const rz = dx * sn + dz * cs
    const speed = 18 + power * 12
    const vz = 0.5 + power * 3.1
    this.kickBall(p, rx, rz, speed, vz)
    this.squads[p.team].shots++
    this.pendingShot = true
    this.shotTeam = p.team
    this.shotWindow = 1.3
  }

  /** Entrada (presión): intenta robar el balón al dueño cercano. Puede cometer falta. */
  tryTackle(p: PlayerEntity) {
    if (p.tackleCd > 0 || p.stunTimer > 0) return
    p.tackleCd = PLAYER.tackleCooldown
    const owner = this.owner
    if (owner && owner.isGK && this.gkHold > 0) return // balón en manos del portero
    if (owner && owner.team !== p.team && dist2d(p.x, p.z, owner.x, owner.z) < PLAYER.tackleRange) {
      const prob = 0.45 + p.data.skill * 0.25 + this.diff.tackle * 0.15 - owner.data.skill * 0.2
      if (Math.random() < prob) {
        this.loseControl()
        this.ball.kick(p.vx + Math.sin(p.dir) * 4, p.vz + Math.cos(p.dir) * 4, 7, 0.4)
        this.ball.lastTouch = p.team
        this.lastTouchPlayer = p
        owner.stunTimer = 0.3
        this.audio.kick(0.3)
      } else {
        p.stunTimer = 0.35
        // entrada fallada con contacto: puede ser sancionada
        if (Math.random() < FOUL.standingFoulChance) {
          this.awardFoul(p, owner)
        }
      }
    } else if (!owner && dist2d(p.x, p.z, this.ball.x, this.ball.z) < PLAYER.tackleRange) {
      // empujón al balón libre
      this.ball.kick(Math.sin(p.dir), Math.cos(p.dir), 8, 0.5)
      this.ball.lastTouch = p.team
      this.lastTouchPlayer = p
      p.kickCooldown = 0.3
    }
  }

  slideTackle(p: PlayerEntity, dx: number, dz: number) {
    p.startSlide(dx, dz)
  }

  // ---------------------------------------------------------------- cambios

  /** Estado para la interfaz de cambios (titulares con resistencia + banco). */
  getSubState(team: TeamIndex): SubState {
    const sq = this.squads[team]
    return {
      used: sq.subsUsed,
      max: MATCH_RULES.maxSubs,
      onField: sq.players.map((p, i) => ({
        idx: i,
        num: p.data.num,
        name: p.data.name,
        role: p.data.role,
        stamina: Math.round(p.stamina),
        gk: p.isGK,
        sentOff: p.sentOff,
      })),
      bench: sq.bench.map((b, i) => ({
        idx: i,
        num: b.num,
        name: b.name,
        role: b.role,
        available: !sq.benchUsed[i],
      })),
    }
  }

  /**
   * Realiza un cambio: el titular conserva su puesto en la formación y el rig 3D;
   * solo se rebrandea (nombre, dorsal, atributos) y recupera resistencia.
   * Portero solo por portero (el rig del ARQ es distinto y su IA es especial).
   */
  makeSubstitution(team: TeamIndex, outIdx: number, benchIdx: number): SubResult {
    if (this.phase === 'full') return 'invalido'
    const sq = this.squads[team]
    if (sq.subsUsed >= MATCH_RULES.maxSubs) return 'limite'
    const out = sq.players[outIdx]
    const sub = sq.bench[benchIdx]
    if (!out || !sub || sq.benchUsed[benchIdx]) return 'invalido'
    if (out.sentOff) return 'invalido' // al expulsado no lo reemplaza nadie
    if (out.isGK !== (sub.role === 'GK')) return 'invalido'
    const oldName = out.data.name
    out.data = sub
    out.stamina = 100
    out.yellowCards = 0 // el que entra llega sin tarjetas
    sq.benchUsed[benchIdx] = true
    sq.subsUsed++
    this.addEvent(`Cambio ${sq.roster.def.short}: entra ${sub.name} por ${oldName}`, 'info')
    return 'ok'
  }

  private cpuSubTimer = 10

  /** La CPU reemplaza a sus jugadores más cansados a partir del minuto 50 (hasta 5 cambios). */
  private tryCpuSub() {
    const sq = this.squads[1]
    if (sq.subsUsed >= MATCH_RULES.maxSubs) return
    if (this.minute() < 50) return
    // puede hacer hasta dos cambios por revisión si hay varios fundidos
    for (let n = 0; n < 2; n++) {
      if (sq.subsUsed >= MATCH_RULES.maxSubs) return
      let worst: PlayerEntity | null = null
      let worstIdx = -1
      for (let i = 0; i < sq.players.length; i++) {
        const p = sq.players[i]
        if (p.isGK || p.sentOff) continue
        if (!worst || p.stamina < worst.stamina) {
          worst = p
          worstIdx = i
        }
      }
      if (!worst || worst.stamina > 62) return
      let bi = sq.bench.findIndex((b, i) => !sq.benchUsed[i] && b.role === worst!.data.role)
      if (bi < 0) bi = sq.bench.findIndex((b, i) => !sq.benchUsed[i] && b.role !== 'GK')
      if (bi < 0) return
      this.makeSubstitution(1, worstIdx, bi)
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    this.excitement = Math.max(0, this.excitement - dt * 0.35)
    this.audio.setExcitement(this.excitement * 0.8)
    this.shotWindow = Math.max(0, this.shotWindow - dt)
    if (this.shotWindow === 0) this.pendingShot = false

    // temporizador del overlay de tarjetas
    if (this.cardTimer > 0) {
      this.cardTimer -= dt
      if (this.cardTimer <= 0) this.cardOverlay = null
    }

    // cambios automáticos de la CPU cuando el cansancio aprieta
    // (se revisan en toda fase: las bolas paradas son momento de cambios)
    if (this.phase !== 'full') {
      this.cpuSubTimer -= dt
      if (this.cpuSubTimer <= 0) {
        this.cpuSubTimer = 8
        this.tryCpuSub()
      }
    }

    switch (this.phase) {
      case 'kickoff':
      case 'restart':
      case 'half': {
        this.phaseTimer -= dt
        if (this.phase === 'half') {
          if (this.phaseTimer <= 0) {
            this.half = 2
            for (const sq of this.squads) sq.attackDir = (sq.attackDir * -1) as 1 | -1
            // descanso: los jugadores recuperan resistencia en el mediempo
            for (const sq of this.squads)
              for (const p of sq.players) p.stamina = Math.min(100, p.stamina + MATCH_RULES.halfTimeRecovery)
            this.setupKickoff(1)
            this.addEvent('Comienza el segundo tiempo', 'info')
          }
          break
        }
        // congelados: solo animación
        for (const sq of this.squads) for (const p of sq.players) { p.desiredVx = 0; p.desiredVz = 0; p.update(dt) }
        this.ballPrevX = this.ball.x
        if (this.phaseTimer <= 0) {
          this.phase = 'play'
        }
        break
      }
      case 'goal': {
        this.phaseTimer -= dt
        for (const sq of this.squads) for (const p of sq.players) { p.desiredVx = 0; p.desiredVz = 0; p.update(dt) }
        if (this.phaseTimer <= 0) {
          this.celebrateScorer = null
          this.celebrateTeam = null
          this.setupKickoff(this.lastTouchTeamConceding())
        }
        break
      }
      case 'play':
        this.updatePlay(dt)
        break
      case 'freekick':
      case 'penalty':
        this.updateSetPiece(dt)
        break
      case 'full':
        for (const sq of this.squads) for (const p of sq.players) { p.desiredVx = 0; p.desiredVz = 0; p.update(dt) }
        break
    }
    this.input.endFrame()
  }

  private lastTouchTeamConceding(): TeamIndex {
    if (!this.lastTouchPlayer) return this.kickoffTeam === 0 ? 1 : 0
    // el equipo que recibió el gol saca
    return this.lastTouchPlayer.team === 0 ? 1 : 0
  }

  private updatePlay(dt: number) {
    this.clock += dt
    this.ballPrevX = this.ball.x

    this.updateControlledInput(dt)
    updateMatchAI(this, dt)
    for (const sq of this.squads) {
      for (const p of sq.players) p.update(dt)
    }
    this.separatePlayers()
    // faltas: barridas que golpean rival antes que el balón (detienen la jugada)
    if (this.checkFouls()) return
    this.updateBallPossession(dt)
    this.checkOutOfBounds()

    if (this.owner) this.squads[this.owner.team].possession += dt

    if (this.half === 1 && this.clock >= this.durationSec / 2) {
      this.finishHalf()
    } else if (this.half === 2 && this.clock >= this.durationSec && !this.finished) {
      this.goFullTime()
    }
  }

  /** Convierte la entrada humana en acciones del jugador controlado. */
  private updateControlledInput(dt: number) {
    const inp = this.input
    // auto-cambio de jugador
    const team0 = this.squads[0]
    if (!this.owner || this.owner.team !== 0) {
      this.switchHysteresis += dt
      if (this.switchHysteresis > 0.18 || !this.controlled || this.controlled.team !== 0) {
        const fut = this.ball.future(0.25)
        let best: PlayerEntity | null = null
        let bestD = Infinity
        const nearOwnBox = Math.abs(this.ball.x - this.ownGoalOf(0)) < 20
        for (const p of team0.players) {
          if (p.sentOff) continue
          if (p.isGK && !nearOwnBox) continue
          const d = dist2d(p.x, p.z, fut.x, fut.z)
          if (d < bestD) {
            bestD = d
            best = p
          }
        }
        if (best && best !== this.controlled) this.controlled = best
        this.switchHysteresis = 0
      }
    } else {
      this.switchHysteresis = 0
      this.controlled = this.owner
    }

    const c = this.controlled
    if (!c) return
    c.speedMult = this.diff.userBoost

    // movimiento relativo a cámara (el engine lo traduce antes: aquí ya es mundo)
    const mx = inp.move.x
    const my = inp.move.y
    const world = this.engineMoveToWorld(mx, my)
    const moving = Math.hypot(world.x, world.z) > 0.1
    c.sprinting = inp.sprint && moving
    if (moving) {
      const len = Math.hypot(world.x, world.z)
      c.desiredVx = (world.x / len) * c.maxSpeed()
      c.desiredVz = (world.z / len) * c.maxSpeed()
    } else {
      c.desiredVx = 0
      c.desiredVz = 0
    }

    const isOwner = this.owner === c
    if (isOwner) {
      // disparo con carga
      if (inp.isHeld('shoot')) {
        this.charging = true
        this.charge = Math.min(1, this.charge + dt / 0.85)
        if (this.charge >= 1) {
          this.releaseShot(c)
        }
      } else if (this.charging) {
        this.releaseShot(c)
      }
      if (inp.consumePressed('pass')) {
        const aim = moving ? world : { x: Math.sin(c.dir), z: Math.cos(c.dir) }
        this.doPass(c, aim.x, aim.z, false)
        this.charge = 0
        this.charging = false
      }
      if (inp.consumePressed('lob')) {
        const aim = moving ? world : { x: Math.sin(c.dir), z: Math.cos(c.dir) }
        this.doPass(c, aim.x, aim.z, true)
      }
    } else {
      // defensa
      this.charge = 0
      this.charging = false
      if (inp.consumePressed('pass')) this.tryTackle(c)
      if (inp.consumePressed('shoot')) {
        const dx = moving ? world.x : Math.sin(c.dir)
        const dz = moving ? world.z : Math.cos(c.dir)
        this.slideTackle(c, dx, dz)
      }
      if (inp.consumePressed('lob') || inp.consumePressed('switch')) {
        // cambio manual: siguiente más cercano
        const fut = this.ball.future(0.25)
        const others = team0.players
          .filter((p) => !p.isGK && !p.sentOff && p !== c)
          .sort((a, b) => dist2d(a.x, a.z, fut.x, fut.z) - dist2d(b.x, b.z, fut.x, fut.z))
        if (others[0]) this.controlled = others[0]
      }
    }
  }

  private releaseShot(c: PlayerEntity) {
    const world = this.engineMoveToWorld(this.input.move.x, this.input.move.y)
    // input vertical en mundo: arriba = palo lejano, abajo = palo cercano
    const aimProj = clamp(world.z, -1, 1)
    this.doShoot(c, Math.max(0.25, this.charge), aimProj)
    this.charge = 0
    this.charging = false
  }

  /** Traduce input de pantalla a mundo según el modo de cámara (seteado por el engine). */
  cameraMode: CameraMode = 'broadcast'
  attackDirUser: 1 | -1 = 1
  private engineMoveToWorld(x: number, y: number): { x: number; z: number } {
    if (this.cameraMode === 'arco') {
      // cámara tras el arco que ataca el usuario
      const f = this.attackDirUser
      return { x: y * f, z: -x * f }
    }
    return { x, z: -y }
  }

  // ---------------------------------------------------------------- faltas y tiros parados

  /**
   * Detecta faltas de barrida: si el jugador deslizándose golpea a un rival
   * sin haber tocado antes el balón, el árbitro pita la falta. Devuelve true
   * si pitó algo (la jugada se detuvo este frame).
   */
  private checkFouls(): boolean {
    if (this.phase !== 'play') return false
    const ball = this.ball
    const all = [...this.squads[0].players, ...this.squads[1].players]
    for (const p of all) {
      if (p.sentOff || p.slideTimer <= 0.06) continue
      const ballDist = dist2d(p.x, p.z, ball.x, ball.z)
      if (ballDist < PLAYER.tackleRange) {
        // barrida limpia: llega primero al balón y lo despeja (una sola vez)
        if (p.kickCooldown <= 0) {
          const dx = ball.x - p.x
          const dz = ball.z - p.z
          const len = Math.hypot(dx, dz) || 1
          this.loseControl()
          this.ball.kick(dx / len + p.vx * 0.08, dz / len + p.vz * 0.08, 9.5, 1.4)
          this.ball.lastTouch = p.team
          this.lastTouchPlayer = p
          p.kickCooldown = 0.5
          const owner = this.owner
          if (owner && owner.team !== p.team && dist2d(p.x, p.z, owner.x, owner.z) < FOUL.contactRadius) {
            owner.stunTimer = 0.55 // la barrida limpia también derriba
          }
          this.audio.kick(0.45)
        }
        continue
      }
      for (const o of all) {
        if (o.sentOff || o.team === p.team) continue
        if (dist2d(p.x, p.z, o.x, o.z) < FOUL.contactRadius) {
          this.awardFoul(p, o)
          return true
        }
      }
    }
    return false
  }

  /** Sanciona una falta: tarjeta si corresponde y tiro libre o penal. */
  private awardFoul(offender: PlayerEntity, victim: PlayerEntity) {
    const sq = this.squads[offender.team]
    sq.fouls++
    const speed = offender.speedNow
    // ¿llegó desde atrás? (proyección del ofensor sobre la dirección del pie del victimario)
    const relX = offender.x - victim.x
    const relZ = offender.z - victim.z
    const relLen = Math.hypot(relX, relZ) || 1
    const behind = (Math.sin(victim.dir) * relX + Math.cos(victim.dir) * relZ) / relLen < -0.35

    victim.stunTimer = FOUL.victimStun
    this.loseControl()
    const fx = clamp(victim.x, 0.5, PITCH.L - 0.5)
    const fz = clamp(victim.z, 0.5, PITCH.W - 0.5)
    this.ball.reset(fx, fz)

    // severidad → tarjeta (velocidad de la entrada + jugada por detrás)
    const sev = speed / 17 + (behind ? 0.4 : 0) + Math.random() * 0.12
    let card: 'none' | 'yellow' | 'red' = 'none'
    if (sev > 0.85) card = 'yellow'
    if (sev > 1.22) card = 'red'
    if (card === 'yellow' && offender.yellowCards >= 1) card = 'red' // segunda amarilla
    if (offender.isGK && card === 'red') card = 'yellow' // evitamos dejar el arco vacío

    this.addEvent(`Falta de ${offender.data.name} (${sq.roster.def.short})`, 'info')
    if (card !== 'none') this.applyCard(offender, card)
    this.audio.whistle(1)
    this.excitement = Math.max(this.excitement, 0.45)

    // ¿dentro del área propia del que cometió la falta? → penal
    const defGoalX = this.ownGoalOf(offender.team)
    const inBox = Math.abs(fx - defGoalX) < PITCH.boxD && Math.abs(fz - GOAL.zCenter) < PITCH.boxW / 2
    if (inBox) this.setupPenalty(victim.team)
    else this.setupFreeKick(victim.team, fx, fz)
  }

  /** Muestra tarjeta, la registra y expulsa si es roja (o segunda amarilla). */
  private applyCard(p: PlayerEntity, card: 'yellow' | 'red') {
    const sq = this.squads[p.team]
    if (card === 'yellow') {
      p.yellowCards++
      sq.yellows++
      this.cardOverlay = { kind: 'amarilla', player: p.data.name, team: p.team }
      this.cardTimer = 2.6
      this.addEvent(`Amarilla para ${p.data.name} (${sq.roster.def.short})`, 'info')
      if (p.yellowCards >= 2) {
        this.cardOverlay = { kind: 'roja', player: p.data.name, team: p.team }
        this.addEvent(`¡Segunda amarilla! ${p.data.name} expulsado`, 'info')
        this.expel(p)
      }
    } else {
      this.cardOverlay = { kind: 'roja', player: p.data.name, team: p.team }
      this.cardTimer = 3.0
      this.addEvent(`¡Roja directa! ${p.data.name} (${sq.roster.def.short}) expulsado`, 'info')
      this.expel(p)
    }
  }

  private expel(p: PlayerEntity) {
    this.squads[p.team].reds++
    p.sendOff()
    if (this.owner === p) this.loseControl()
    if (this.controlled === p) {
      let best: PlayerEntity | null = null
      let bestD = Infinity
      for (const m of this.squads[p.team].players) {
        if (m === p || m.sentOff || m.isGK) continue
        const d = dist2d(m.x, m.z, this.ball.x, this.ball.z)
        if (d < bestD) {
          bestD = d
          best = m
        }
      }
      if (best) this.controlled = best
    }
    this.audio.whistle(2)
  }

  /** Arma el tiro libre: ejecutante detrás del balón y barrera rival a 9,15 m. */
  private setupFreeKick(team: TeamIndex, x: number, z: number) {
    this.phase = 'freekick'
    this.phaseTimer = FOUL.freeKickFreeze
    this.setPieceInfo = { type: 'freekick', team, x, z }
    this.setPieceReady = false
    this.ball.reset(x, z)
    this.owner = null
    this.pendingShot = false

    const sq = this.squads[team]
    let taker: PlayerEntity | null = null
    let bestScore = -Infinity
    for (const p of sq.players) {
      if (p.isGK || p.sentOff) continue
      const score = p.data.skill * 6 - dist2d(p.x, p.z, x, z) * 0.5
      if (score > bestScore) {
        bestScore = score
        taker = p
      }
    }
    this.setPieceTaker = taker
    if (taker) {
      const gx = this.goalOf(team)
      const dx = gx - x
      const dz = GOAL.zCenter - z
      const d = Math.hypot(dx, dz) || 1
      taker.teleport(x - (dx / d) * 1.1, z - (dz / d) * 1.1)
      taker.dir = Math.atan2(dx, dz)
      this.gainControl(taker)
      this.gkHold = 0
    }
    this.buildWall(team === 0 ? 1 : 0, x, z)
    this.controlled = team === 0 ? taker : null
  }

  private buildWall(defTeam: TeamIndex, x: number, z: number) {
    const gx = this.ownGoalOf(defTeam)
    const dx = gx - x
    const dz = GOAL.zCenter - z
    const d = Math.hypot(dx, dz) || 1
    const ux = dx / d
    const uz = dz / d
    const wx = x + ux * FOUL.wallDist
    const wz = z + uz * FOUL.wallDist
    const px = -uz
    const pz = ux
    const defs = this.squads[defTeam].players
      .filter((p) => !p.isGK && !p.sentOff)
      .sort((a, b) => dist2d(a.x, a.z, wx, wz) - dist2d(b.x, b.z, wx, wz))
      .slice(0, FOUL.wallPlayers)
    defs.forEach((p, i) => {
      const off = (i - (defs.length - 1) / 2) * 0.72
      p.teleport(clamp(wx + px * off, 0.6, PITCH.L - 0.6), clamp(wz + pz * off, 0.6, PITCH.W - 0.6))
      p.dir = Math.atan2(x - p.x, z - p.z)
      p.targetX = p.x
      p.targetZ = p.z
    })
  }

  /** Penal: ejecutante, portero en la línea y todos los demás fuera del área. */
  private setupPenalty(team: TeamIndex) {
    this.phase = 'penalty'
    this.phaseTimer = FOUL.penaltyFreeze
    const defGoalX = this.ownGoalOf(team === 0 ? 1 : 0)
    const dir = defGoalX < PITCH.L / 2 ? 1 : -1
    const px = defGoalX + dir * PITCH.spot
    this.setPieceInfo = { type: 'penalty', team, x: px, z: GOAL.zCenter }
    this.setPieceReady = false
    this.addEvent(`¡PENAL para ${this.squads[team].roster.def.short}!`, 'chance')
    this.ball.reset(px, GOAL.zCenter)
    this.owner = null
    this.pendingShot = false

    const sq = this.squads[team]
    let taker: PlayerEntity | null = null
    let bestSkill = -1
    for (const p of sq.players) {
      if (p.isGK || p.sentOff) continue
      if (p.data.skill > bestSkill) {
        bestSkill = p.data.skill
        taker = p
      }
    }
    this.setPieceTaker = taker
    if (taker) {
      taker.teleport(px - dir * 2.2, GOAL.zCenter + 0.4)
      taker.dir = Math.atan2(defGoalX - taker.x, GOAL.zCenter - taker.z)
    }
    const gk = this.squads[team === 0 ? 1 : 0].players[0]
    gk.teleport(defGoalX + dir * 0.4, GOAL.zCenter)
    gk.dir = Math.atan2(px - gk.x, GOAL.zCenter - gk.z)

    let side = 1
    let step = 0
    for (const other of [...this.squads[0].players, ...this.squads[1].players]) {
      if (other === taker || other.isGK || other.sentOff) continue
      const z = GOAL.zCenter + side * (6 + step * 4.5)
      step++
      if (step >= 4) {
        step = 0
        side *= -1
      }
      other.teleport(defGoalX + dir * (PITCH.boxD + 2.5), clamp(z, 3, PITCH.W - 3))
      other.targetX = other.x
      other.targetZ = other.z
    }
    this.controlled = team === 0 ? taker : null
    this.audio.whistle(1)
    this.excitement = Math.max(this.excitement, 0.85)
  }

  /** Bucle de las fases de tiro libre / penal: congelación → ejecución → juego. */
  private updateSetPiece(dt: number) {
    const sp = this.setPieceInfo
    if (!sp) {
      this.resumeFromSetPiece()
      return
    }
    for (const sq of this.squads) for (const p of sq.players) { p.desiredVx = 0; p.desiredVz = 0; p.update(dt) }
    this.ballPrevX = this.ball.x
    this.phaseTimer -= dt
    if (this.phaseTimer > 0) return

    if (!this.setPieceReady) {
      this.setPieceReady = true
      this.phaseTimer = FOUL.setPieceTimeout
      return
    }

    const taker = this.setPieceTaker
    if (!taker) {
      this.resumeFromSetPiece()
      return
    }
    if (sp.team === 1) {
      // la CPU ejecuta tras un breve tiempo de preparación
      if (this.phaseTimer <= FOUL.setPieceTimeout - FOUL.cpuSetPieceDelay) this.executeSetPiece('auto')
    } else {
      this.updateSetPieceHumanInput(dt)
      if (this.setPieceInfo && this.phaseTimer <= 0) this.executeSetPiece('auto')
    }
  }

  /** Entrada humana durante tiro libre / penal propio (jugador fijo, apuntar y ejecutar). */
  private updateSetPieceHumanInput(dt: number) {
    const sp = this.setPieceInfo
    const taker = this.setPieceTaker
    if (!sp || !taker) return
    const inp = this.input
    if (inp.isHeld('shoot')) {
      this.charging = true
      this.charge = Math.min(1, this.charge + dt / 0.85)
    } else if (this.charging) {
      const world = this.engineMoveToWorld(inp.move.x, inp.move.y)
      const aim = clamp(world.z, -1, 1)
      this.doShoot(taker, Math.max(0.3, this.charge), aim)
      if (sp.type === 'penalty') this.gkGuessDive(taker)
      this.charge = 0
      this.charging = false
      this.resumeFromSetPiece()
      return
    }
    if (inp.consumePressed('pass') || inp.consumePressed('lob')) {
      const lofted = inp.consumePressed('lob')
      const world = this.engineMoveToWorld(inp.move.x, inp.move.y)
      const moving = Math.hypot(world.x, world.z) > 0.1
      const aim = moving ? world : { x: this.squads[0].attackDir, z: 0 }
      this.doPass(taker, aim.x, aim.z, lofted)
      this.charge = 0
      this.charging = false
      this.resumeFromSetPiece()
    }
  }

  /** Ejecución automática (CPU o timeout humano). */
  private executeSetPiece(mode: 'auto') {
    const sp = this.setPieceInfo
    const taker = this.setPieceTaker
    if (!sp || !taker) {
      this.resumeFromSetPiece()
      return
    }
    const gx = this.goalOf(sp.team)
    const distG = dist2d(taker.x, taker.z, gx, GOAL.zCenter)
    if (sp.type === 'penalty') {
      const aim = (Math.random() - 0.5) * 1.5
      this.doShoot(taker, 0.82 + Math.random() * 0.13, aim)
      this.gkGuessDive(taker)
    } else if (distG < 27 && Math.abs(taker.z - GOAL.zCenter) < 14) {
      // tiro directo al arco
      this.doShoot(taker, clamp(distG / 30, 0.55, 0.95), (Math.random() - 0.5) * 1.2)
    } else {
      // centro / pase al área
      const dir = this.squads[sp.team].attackDir
      this.doPass(taker, dir * 10, GOAL.zCenter - taker.z + (Math.random() - 0.5) * 6, true)
    }
    this.charge = 0
    this.charging = false
    this.resumeFromSetPiece()
  }

  /** El portero intenta adivinar el lado del disparo (penales). */
  private gkGuessDive(taker: PlayerEntity) {
    const gk = this.squads[taker.team === 0 ? 1 : 0].players[0]
    gk.diveTimer = 0.75
    gk.diveDir = Math.sign(this.ball.vz) || 1
    if (Math.random() < 0.4) gk.diveDir = -gk.diveDir
  }

  private resumeFromSetPiece() {
    this.setPieceInfo = null
    this.setPieceTaker = null
    this.setPieceReady = false
    if (this.phase === 'freekick' || this.phase === 'penalty') this.phase = 'play'
  }

  // ---------------------------------------------------------------- balón y posesión

  private separatePlayers() {
    const all = [...this.squads[0].players, ...this.squads[1].players].filter((p) => !p.sentOff)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = Math.hypot(dx, dz)
        const min = PLAYER.radius * 2
        if (d > 0.001 && d < min) {
          const push = (min - d) / 2
          const ux = dx / d
          const uz = dz / d
          a.x -= ux * push
          a.z -= uz * push
          b.x += ux * push
          b.z += uz * push
        }
      }
    }
  }

  private updateBallPossession(dt: number) {
    const ball = this.ball
    const postHit = ball.update(dt)
    if (postHit === 'post') {
      this.audio.post()
      this.addEvent('¡Al palo!', 'chance')
      this.excitement = Math.max(this.excitement, 0.6)
    } else if (postHit === 'crossbar') {
      this.audio.post()
      this.addEvent('¡Al travesaño!', 'chance')
      this.excitement = Math.max(this.excitement, 0.6)
    }

    const owner = this.owner
    if (owner) {
      if (owner.isGK && this.gkHold > 0) {
        this.gkHold -= dt
        // balón en las manos
        ball.x = owner.x + Math.sin(owner.dir) * 0.35
        ball.z = owner.z + Math.cos(owner.dir) * 0.35
        ball.y = 1.05
        ball.stop()
        const gkTeam = owner.team
        if (this.gkHold <= 0) {
          // distribución automática del portero
          const mate = this.pickGkDistribution(owner)
          if (mate) {
            const dist = dist2d(owner.x, owner.z, mate.x, mate.z)
            const lofted = dist > 26
            this.doPass(owner, mate.x - owner.x, mate.z - owner.z, lofted)
            if (owner.team === 0) this.controlled = mate
          } else {
            this.kickBall(owner, this.squads[gkTeam].attackDir, 0, 16, 6)
          }
        }
        return
      }

      // conducción: el balón "pega" al pie
      this.ownerHold += dt
      const ahead = owner.sprinting ? 0.95 : 0.55
      const tx = owner.x + Math.sin(owner.dir) * ahead
      const tz = owner.z + Math.cos(owner.dir) * ahead
      ball.vx = (tx - ball.x) * 11
      ball.vz = (tz - ball.z) * 11
      ball.vy = 0
      ball.y = BALL.r
      if (dist2d(ball.x, ball.z, owner.x, owner.z) > 2.4) this.loseControl()
      return
    }

    // balón libre: intento de control por proximidad
    if (ball.y < PLAYER.controlHeight) {
      const all = [...this.squads[0].players, ...this.squads[1].players]
      let best: PlayerEntity | null = null
      let bestD = Infinity
      for (const p of all) {
        if (p.sentOff) continue
        if (p.kickCooldown > 0 || p.stunTimer > 0 || p.slideTimer > 0) continue
        const d = dist2d(p.x, p.z, ball.x, ball.z)
        if (d < PLAYER.reach && d < bestD) {
          bestD = d
          best = p
        }
      }
      if (best) {
        const sp = ball.speed
        const controllable = sp < 9 || Math.random() < 0.35 + best.data.skill * 0.55
        if (sp > 16 && best.isGK && this.isBallThreat(best)) {
          // atajada
          this.gainControl(best)
          this.squads[best.team].onTarget += this.pendingShot && this.shotTeam !== best.team ? 1 : 0
          if (this.pendingShot && this.shotTeam !== best.team) {
            this.addEvent(`¡Atajada de ${best.data.name}!`, 'chance')
            this.excitement = Math.max(this.excitement, 0.7)
            this.audio.ooh()
          }
          this.pendingShot = false
          this.audio.catchBall()
          return
        }
        if (controllable) {
          this.gainControl(best)
          ball.vx *= 0.15
          ball.vz *= 0.15
          ball.vy = 0
        } else {
          // control malo: rebota
          ball.vx = ball.vx * -0.25 + (Math.random() - 0.5) * 4
          ball.vz = ball.vz * -0.25 + (Math.random() - 0.5) * 4
          ball.lastTouch = best.team
          this.lastTouchPlayer = best
          best.kickCooldown = 0.25
        }
      }
    }
  }

  private isBallThreat(gk: PlayerEntity): boolean {
    // el balón va hacia su arco rápido
    const gx = this.ownGoalOf(gk.team)
    const toward = gx < PITCH.L / 2 ? this.ball.vx < -6 : this.ball.vx > 6
    return toward && this.ball.speed > 12
  }

  private pickGkDistribution(gk: PlayerEntity): PlayerEntity | null {
    const squad = this.squads[gk.team]
    let best: PlayerEntity | null = null
    let bestScore = -Infinity
    for (const mate of squad.players) {
      if (mate === gk || mate.sentOff) continue
      const d = dist2d(gk.x, gk.z, mate.x, mate.z)
      const open = Math.min(9, this.closestOppDist(mate))
      const score = open * 2 - d * 0.06 + (mate.data.role === 'DF' ? 2 : 0)
      if (score > bestScore) {
        bestScore = score
        best = mate
      }
    }
    return best
  }

  // ---------------------------------------------------------------- reglas: fuera / gol

  private checkOutOfBounds() {
    const b = this.ball
    const prevX = this.ballPrevX

    // gol: cruza la línea de meta por debajo del travesaño y dentro de la boca
    if (prevX > 0 && b.x <= 0 && Math.abs(b.z - GOAL.zCenter) < PITCH.goalW / 2 && b.y < PITCH.goalH) {
      this.handleGoalByGoalLine(0)
      return
    }
    if (prevX < PITCH.L && b.x >= PITCH.L && Math.abs(b.z - GOAL.zCenter) < PITCH.goalW / 2 && b.y < PITCH.goalH) {
      this.handleGoalByGoalLine(PITCH.L)
      return
    }

    // líneas de banda
    if (b.z <= 0 || b.z >= PITCH.W) {
      const team = b.lastTouch === 0 ? 1 : 0
      this.lastOutWasNearMiss = false
      if (this.pendingShot) {
        this.audio.ooh()
        this.excitement = Math.max(this.excitement, 0.5)
        this.lastOutWasNearMiss = true
      }
      this.setRestart({ type: 'throwin', team, x: clamp(b.x, 1.5, PITCH.L - 1.5), z: b.z <= 0 ? 0.3 : PITCH.W - 0.3 })
      this.addEvent(this.lastOutWasNearMiss ? '¡Uy! Salió muy cerca del arco' : 'Saque de banda', 'info')
      this.pendingShot = false
      return
    }

    // líneas de meta (sin gol)
    if (b.x <= 0 || b.x >= PITCH.L) {
      const leftSide = b.x <= 0
      const defendingTeam: TeamIndex = this.ownGoalOf(0) === (leftSide ? 0 : PITCH.L) ? 0 : 1
      const attackTeam: TeamIndex = defendingTeam === 0 ? 1 : 0
      if (b.lastTouch === defendingTeam) {
        // córner
        const z = b.z <= PITCH.W / 2 ? 0.4 : PITCH.W - 0.4
        this.setRestart({ type: 'corner', team: attackTeam, x: leftSide ? 0.4 : PITCH.L - 0.4, z })
        this.addEvent(`Córner para ${this.squads[attackTeam].roster.def.short}`, 'info')
      } else {
        // saque de puerta
        const z = clamp(GOAL.zCenter + (b.z - GOAL.zCenter) * 0.3, GOAL.zMin + 2, GOAL.zMax - 2)
        this.setRestart({
          type: 'goalkick',
          team: defendingTeam,
          x: leftSide ? PITCH.sixD : PITCH.L - PITCH.sixD,
          z,
        })
        this.addEvent('Saque de puerta', 'info')
      }
      this.pendingShot = false
    }
  }

  private handleGoalByGoalLine(side: 0 | 105) {
    // el arco en x=side lo defiende el equipo cuyo arco propio es ese lado
    const defender: TeamIndex = this.ownGoalOf(0) === side ? 0 : 1
    const scorer: TeamIndex = defender === 0 ? 1 : 0
    this.handleGoal(scorer)
  }
}
