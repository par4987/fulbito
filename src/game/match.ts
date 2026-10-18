import { AudioManager } from './audio'
import { Ball } from './ball'
import {
  BALL,
  DIFFICULTY,
  FORMATION_433,
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
  Difficulty,
  FullTimeResult,
  HudState,
  MatchConfig,
  MatchEvent,
  MatchSettings,
  PlayerData,
  TeamIndex,
  TeamRoster,
} from './types'
import { updateMatchAI } from './ai'

interface Squad {
  roster: TeamRoster
  players: PlayerEntity[]
  attackDir: 1 | -1
  score: number
  possession: number
  shots: number
  onTarget: number
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
  diff = DIFFICULTY.profesional
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
  private aiPassHint: PlayerEntity | null = null
  private ballPrevX = 0
  private celebrateScorer: string | null = null
  private celebrateTeam: TeamIndex | null = null
  private kickoffTeam: TeamIndex = 0
  private finished = false

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
    return { roster, players, attackDir, score: 0, possession: 0, shots: 0, onTarget: 0 }
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
    this.ball.reset()
    for (const sq of this.squads) this.placeFormation(sq, kickingTeam)
    const taker = this.squads[kickingTeam].players[9] // FW central
    taker.teleport(PITCH.L / 2 - this.squads[kickingTeam].attackDir * 0.8, PITCH.W / 2)
    this.gainControl(taker)
    this.controlled = kickingTeam === 0 ? taker : null
    this.audio.whistle(1)
  }

  private placeFormation(sq: Squad, kickingTeam: TeamIndex) {
    for (const p of sq.players) {
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
      if (mate === p || mate.isGK) continue
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
    for (const o of opp) d = Math.min(d, dist2d(o.x, o.z, p.x, p.z))
    return d
  }

  private laneBlocked(from: PlayerEntity, to: PlayerEntity): boolean {
    const opp = this.squads[from.team === 0 ? 1 : 0].players
    const dx = to.x - from.x
    const dz = to.z - from.z
    const len = Math.hypot(dx, dz) || 1
    for (const o of opp) {
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

  /** Entrada (presión): intenta robar el balón al dueño cercano. */
  tryTackle(p: PlayerEntity) {
    if (p.tackleCd > 0 || p.stunTimer > 0) return
    p.tackleCd = PLAYER.tackleCooldown
    const owner = this.owner
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

  // ---------------------------------------------------------------- update

  update(dt: number) {
    this.excitement = Math.max(0, this.excitement - dt * 0.35)
    this.audio.setExcitement(this.excitement * 0.8)
    this.shotWindow = Math.max(0, this.shotWindow - dt)
    if (this.shotWindow === 0) this.pendingShot = false

    switch (this.phase) {
      case 'kickoff':
      case 'restart':
      case 'half': {
        this.phaseTimer -= dt
        if (this.phase === 'half') {
          if (this.phaseTimer <= 0) {
            this.half = 2
            for (const sq of this.squads) sq.attackDir = (sq.attackDir * -1) as 1 | -1
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
          .filter((p) => !p.isGK && p !== c)
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
  cameraMode: 'broadcast' | 'aerea' | 'arco' = 'broadcast'
  attackDirUser: 1 | -1 = 1
  private engineMoveToWorld(x: number, y: number): { x: number; z: number } {
    if (this.cameraMode === 'arco') {
      // cámara tras el arco que ataca el usuario
      const f = this.attackDirUser
      return { x: y * f, z: -x * f }
    }
    return { x, z: -y }
  }

  // ---------------------------------------------------------------- balón y posesión

  private separatePlayers() {
    const all = [...this.squads[0].players, ...this.squads[1].players]
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
      if (mate === gk) continue
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
