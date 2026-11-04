import { AudioManager } from './audio'
import { SIM } from './constants'
import { InputManager } from './input'
import { Match } from './match'
import type { KitMaterials } from './player'
import * as THREE from 'three'
import { Scene3D } from './renderer3d'
import { buildStadium, type StadiumRefs } from './stadium'
import { getRoster } from './teams'
import type {
  CameraMode,
  FullTimeResult,
  HudState,
  MatchConfig,
  SubResult,
  SubState,
  TeamIndex,
} from './types'

/**
 * GameEngine: une la simulación (Match) con el render 3D, el radar,
 * el audio y la entrada. Expone estado HUD para React vía callback.
 */
export class GameEngine {
  private scene3d: Scene3D
  private stadium: StadiumRefs
  audio = new AudioManager()
  input = new InputManager()
  private match: Match | null = null
  private raf = 0
  private acc = 0
  private lastT = 0
  private time = 0
  private running = false
  paused = false
  private hudTimer = 0
  private lastPhase = ''
  private radarCtx: CanvasRenderingContext2D | null = null
  private kitMats: [KitMaterials, KitMaterials] | null = null

  onHud: ((h: HudState) => void) | null = null
  onFinish: ((r: FullTimeResult) => void) | null = null

  constructor(container: HTMLElement, radarCanvas: HTMLCanvasElement) {
    this.scene3d = new Scene3D(container)
    this.stadium = buildStadium(this.scene3d.scene)
    this.radarCtx = radarCanvas.getContext('2d')
    this.input.attach()
    this.input.setPauseHandler(() => this.togglePause())
    this.input.setCameraHandler(() => this.cycleCamera())
    this.input.setZoomHandlers(
      () => this.zoomIn(),
      () => this.zoomOut(),
    )
    this.running = true
    this.lastT = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  startMatch(config: MatchConfig) {
    // limpiar rigs del partido anterior (revancha)
    if (this.match) {
      for (const sq of this.match.squads) for (const p of sq.players) p.dispose(this.scene3d.scene)
    }
    if (!this.kitMats) this.kitMats = [makeKit('home'), makeKit('away')]
    this.match = new Match(config, this.input, this.audio, this.kitMats)
    // añadir los rigs de los jugadores a la escena
    for (const sq of this.match.squads) for (const p of sq.players) this.scene3d.scene.add(p.root)
    this.lastPhase = ''
    this.applyKitColors(config.homeTeamId, config.awayTeamId)
    this.paused = false
    this.emitHud(true)
  }

  /** Colorea los rigs según los kits reales de los equipos elegidos. */
  private applyKitColors(homeId: string, awayId: string) {
    if (!this.kitMats || !this.match) return
    const home = getRoster(homeId)
    const away = getRoster(awayId)
    this.kitMats[0].shirt.color.set(home.def.kit.shirt)
    this.kitMats[0].shorts.color.set(home.def.kit.shorts)
    this.kitMats[0].socks.color.set(home.def.kit.socks)
    this.kitMats[0].gkShirt.color.set(home.def.kit.gk)
    this.kitMats[1].shirt.color.set(away.def.kit.shirt)
    this.kitMats[1].shorts.color.set(away.def.kit.shorts)
    this.kitMats[1].socks.color.set(away.def.kit.socks)
    this.kitMats[1].gkShirt.color.set(away.def.kit.gk)
  }

  private loop = (t: number) => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    // tiempo real transcurrido (acotado para evitar espiral tras pestaña oculta)
    const raw = Math.min((t - this.lastT) / 1000, 0.5)
    this.lastT = t
    this.time += raw

    const m = this.match
    if (m && !this.paused) {
      // paso fijo: hasta 30 sub-pasos mantiene la simulación a tiempo real
      // incluso con fps bajos (render por software / equipos modestos)
      this.acc += raw
      let steps = 0
      while (this.acc >= SIM.dt && steps < 30) {
        // sincronizar orientación de cámara y ataque para el input humano
        m.cameraMode = this.scene3d.mode
        m.attackDirUser = m.squad(0).attackDir
        m.update(SIM.dt)
        this.acc -= SIM.dt
        steps++
      }
      // eventos de fase para la UI
      if (m.phase !== this.lastPhase) {
        if (m.phase === 'goal') this.scene3d.shakeCamera(0.7)
        if (m.phase === 'full' && this.onFinish) this.onFinish(m.result)
        this.lastPhase = m.phase
        this.emitHud(true)
      }
      this.hudTimer += raw
      if (this.hudTimer > 0.12) {
        this.hudTimer = 0
        this.emitHud(false)
      }
      this.renderRadar(m)
      this.stadium.animate(this.time, m.excitement)
    }

    if (m) {
      const c = m.controlled
      this.scene3d.update(
        Math.max(raw, SIM.dt),
        { x: m.ball.x, y: m.ball.y, z: m.ball.z, spinAngle: m.ball.spinAngle, spinAxisX: m.ball.spinAxisX, spinAxisZ: m.ball.spinAxisZ },
        c ? { x: c.x, z: c.z, name: c.data.name } : null,
        m.squad(0).attackDir,
      )
    } else {
      // cámara orbital lenta en el menú
      this.scene3d.update(Math.max(raw, SIM.dt), { x: 52.5, y: 0.2, z: 34, spinAngle: 0, spinAxisX: 0, spinAxisZ: 0 }, null, 1)
    }
    this.scene3d.render()
  }

  // ---------------------------------------------------------------- API pública

  togglePause() {
    if (!this.match || this.match.phase === 'full') return
    this.paused = !this.paused
    this.emitHud(true)
  }

  get isPaused() {
    return this.paused
  }

  cycleCamera() {
    const order: CameraMode[] = ['broadcast', 'cerca', 'aerea', 'arco']
    const i = order.indexOf(this.scene3d.mode)
    this.scene3d.mode = order[(i + 1) % order.length]
    this.emitHud(true)
    return this.scene3d.mode
  }

  /** Acercar la cámara de TV (también con la rueda del ratón o la tecla +). */
  zoomIn() {
    this.scene3d.setZoom(this.scene3d.zoom - 0.12)
    this.emitHud(true)
  }

  /** Alejar la cámara de TV (también con la rueda del ratón o la tecla -). */
  zoomOut() {
    this.scene3d.setZoom(this.scene3d.zoom + 0.12)
    this.emitHud(true)
  }

  get zoomPct(): number {
    return this.scene3d.zoomPct
  }

  // ---------------------------------------------------------------- cambios

  getSubState(team: TeamIndex): SubState | null {
    return this.match ? this.match.getSubState(team) : null
  }

  makeSub(team: TeamIndex, outIdx: number, benchIdx: number): SubResult {
    return this.match ? this.match.makeSubstitution(team, outIdx, benchIdx) : 'invalido'
  }

  setCameraMode(mode: CameraMode) {
    this.scene3d.mode = mode
    this.emitHud(true)
  }

  get cameraMode(): CameraMode {
    return this.scene3d.mode
  }

  toggleMute(): boolean {
    this.audio.setMuted(!this.audio.muted)
    return this.audio.muted
  }

  get charge(): number {
    return this.match?.charge ?? 0
  }

  get isCharging(): boolean {
    return this.match?.charging ?? false
  }

  get matchInstance(): Match | null {
    return this.match
  }

  dispose() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.input.detach()
    this.audio.dispose()
    if (this.match) {
      for (const sq of this.match.squads) for (const p of sq.players) p.dispose(this.scene3d.scene)
    }
    this.stadium.dispose()
    this.scene3d.dispose()
  }

  // ---------------------------------------------------------------- HUD / radar

  private emitHud(force: boolean) {
    if (!this.onHud) return
    const m = this.match
    if (!m) return
    const c = m.controlled
    this.onHud({
      phase: m.phase,
      half: m.half,
      minute: m.minute(),
      score: [m.squad(0).score, m.squad(1).score],
      possession: posPct(m),
      shots: [m.squad(0).shots, m.squad(1).shots],
      onTarget: [m.squad(0).onTarget, m.squad(1).onTarget],
      events: m.events.slice(-6),
      controlled: c ? { name: c.data.name, num: c.data.num, stamina: Math.round(c.stamina) } : null,
      goalOverlay: m.goalInfo,
      cameraMode: this.scene3d.mode,
      muted: this.audio.muted,
    })
    if (force) this.lastPhase = m.phase
  }

  private renderRadar(m: Match) {
    const ctx = this.radarCtx
    if (!ctx) return
    const W = ctx.canvas.width
    const H = ctx.canvas.height
    const pad = 8
    const sx = (W - pad * 2) / 105
    const sz = (H - pad * 2) / 68
    const X = (x: number) => pad + x * sx
    const Z = (z: number) => pad + z * sz

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(8,26,14,0.82)'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2)
    ctx.beginPath()
    ctx.moveTo(X(52.5), pad)
    ctx.lineTo(X(52.5), H - pad)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(X(52.5), Z(34), 9.15 * sx, 0, Math.PI * 2)
    ctx.stroke()

    for (const t of [0, 1] as TeamIndex[]) {
      const color = t === 0 ? '#ffd94a' : '#ff5a5a'
      for (const p of m.squad(t).players) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(X(p.x), Z(p.z), t === 0 ? 3.4 : 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const c = m.controlled
    if (c) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(X(c.x), Z(c.z), 5.6, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(X(m.ball.x), Z(m.ball.z), 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
}

function posPct(m: Match): [number, number] {
  const h = m.squad(0).possession
  const a = m.squad(1).possession
  const tot = h + a
  if (tot < 1) return [50, 50]
  return [Math.round((h / tot) * 100), 100 - Math.round((h / tot) * 100)]
}

/** Materiales por equipo (se recolorean al iniciar partido). */
function makeKit(kind: 'home' | 'away'): KitMaterials {
  const fallback = kind === 'home' ? '#c81e2b' : '#17181c'
  const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  return {
    shirt: mat(fallback),
    shorts: mat('#f2f2f0'),
    socks: mat(fallback),
    gkShirt: mat('#2fbf71'),
    shoe: mat('#1a1a1e'),
  }
}
