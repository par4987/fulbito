import * as THREE from 'three'
import { PITCH, PLAYER, clamp, lerpAngle } from './constants'
import type { PlayerData, TeamIndex } from './types'

export interface KitMaterials {
  shirt: THREE.MeshStandardMaterial
  shorts: THREE.MeshStandardMaterial
  socks: THREE.MeshStandardMaterial
  gkShirt: THREE.MeshStandardMaterial
  shoe: THREE.MeshStandardMaterial
}

const SKIN_TONES = ['#c98e63', '#a9704b', '#8a5a3b', '#e0ac7e', '#6f4a30', '#d9a06f']
const HAIR_COLORS = ['#181210', '#2c1c10', '#4a2f1a', '#0c0c0e', '#57402a', '#7a6a50']

/**
 * Jugador: lógica de movimiento/estado + rig 3D procedural (cápsulas)
 * con animación de carrera, patada, barrida y estirada del portero.
 */
export class PlayerEntity {
  data: PlayerData
  team: TeamIndex
  /** slot de formación normalizado (ax 0..1 hacia ataque rival, az 0..1) */
  ax: number
  az: number
  isGK: boolean

  x = 0
  z = 0
  vx = 0
  vz = 0
  dir = 0 // yaw (radianes)
  stamina = 100

  desiredVx = 0
  desiredVz = 0
  sprinting = false
  hasBall = false
  /** multiplicador de velocidad (IA por dificultad / usuario) */
  speedMult = 1
  /** drenaje de resistencia al esprintar (por segundo); lo fija el partido según su duración */
  staminaDrainRate = 0.45

  kickCooldown = 0
  kickAnim = 0
  slideTimer = 0
  slideCd = 0
  stunTimer = 0
  diveTimer = 0
  diveDir = 1
  tackleCd = 0
  /** objetivo táctico actual (IA) */
  targetX = 0
  targetZ = 0
  /** temporizador interno para escalonar decisiones de IA */
  aiTimer = Math.random() * 0.25

  phase = Math.random() * 6
  root = new THREE.Group()
  private legL = new THREE.Group()
  private legR = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private body = new THREE.Group()

  constructor(data: PlayerData, team: TeamIndex, ax: number, az: number, kit: KitMaterials) {
    this.data = data
    this.team = team
    this.ax = ax
    this.az = az
    this.isGK = data.role === 'GK'
    this.buildRig(kit)
  }

  private buildRig(kit: KitMaterials) {
    const skin = new THREE.MeshStandardMaterial({
      color: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
      roughness: 0.85,
    })
    const hair = new THREE.MeshStandardMaterial({
      color: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
      roughness: 0.9,
    })
    const shirtMat = this.isGK ? kit.gkShirt : kit.shirt

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = true
      return m
    }

    // Torso + pantalón
    this.body.add(mk(new THREE.CapsuleGeometry(0.19, 0.34, 4, 8), shirtMat, 0, 0.38, 0))
    this.body.add(mk(new THREE.CylinderGeometry(0.185, 0.19, 0.24, 8), kit.shorts, 0, 0.03, 0))

    // Piernas (pivot en la cadera)
    for (const [leg, sx] of [
      [this.legL, -0.12],
      [this.legR, 0.12],
    ] as const) {
      leg.position.set(sx, 0, 0)
      leg.add(mk(new THREE.CapsuleGeometry(0.082, 0.6, 4, 7), kit.socks, 0, -0.42, 0))
      leg.add(mk(new THREE.BoxGeometry(0.13, 0.09, 0.24), kit.shoe, 0, -0.82, 0.05))
      this.body.add(leg)
    }

    // Brazos (pivot en el hombro)
    for (const [arm, sx] of [
      [this.armL, -0.27],
      [this.armR, 0.27],
    ] as const) {
      arm.position.set(sx, 0.58, 0)
      arm.add(mk(new THREE.CapsuleGeometry(0.055, 0.42, 4, 7), shirtMat, 0, -0.26, 0))
      arm.add(mk(new THREE.SphereGeometry(0.055, 6, 6), skin, 0, -0.52, 0))
      this.body.add(arm)
    }

    // Cabeza
    const headG = new THREE.Group()
    headG.position.set(0, 0.78, 0)
    headG.add(mk(new THREE.SphereGeometry(0.135, 10, 10), skin, 0, 0, 0))
    const hairMesh = mk(new THREE.SphereGeometry(0.14, 10, 10), hair, 0, 0.045, -0.015)
    hairMesh.scale.set(1, 0.72, 1)
    headG.add(hairMesh)
    this.body.add(headG)

    // el rig se apoya en las caderas (~0.95m): piernas cuelgan hasta el suelo
    this.body.position.y = 0.95
    this.root.add(this.body)
  }

  get pos() {
    return { x: this.x, z: this.z }
  }

  get speedNow() {
    return Math.hypot(this.vx, this.vz)
  }

  /** Velocidad máxima actual según contexto (el cansancio penaliza por tramos). */
  maxSpeed(): number {
    let s = PLAYER.baseSpeed * (0.82 + this.data.speed * 0.36) * this.speedMult
    if (this.hasBall) s *= PLAYER.dribbleMult
    if (this.sprinting && this.stamina > 2) s *= PLAYER.sprintMult
    if (this.stamina < 20) s *= 0.8
    else if (this.stamina < 40) s *= 0.88
    else if (this.stamina < 60) s *= 0.96
    return s
  }

  startSlide(dx: number, dz: number) {
    if (this.slideCd > 0 || this.stunTimer > 0) return
    this.slideTimer = PLAYER.slideTime
    this.slideCd = PLAYER.slideCooldown
    const len = Math.hypot(dx, dz) || 1
    this.vx = (dx / len) * PLAYER.slideSpeed
    this.vz = (dz / len) * PLAYER.slideSpeed
  }

  update(dt: number) {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt)
    this.kickAnim = Math.max(0, this.kickAnim - dt)
    this.slideCd = Math.max(0, this.slideCd - dt)
    this.tackleCd = Math.max(0, this.tackleCd - dt)
    this.stunTimer = Math.max(0, this.stunTimer - dt)
    this.diveTimer = Math.max(0, this.diveTimer - dt)

    if (this.slideTimer > 0) {
      this.slideTimer -= dt
      // la barrida pierde velocidad
      this.vx *= Math.exp(-2.2 * dt)
      this.vz *= Math.exp(-2.2 * dt)
    } else if (this.stunTimer > 0) {
      this.vx *= Math.exp(-6 * dt)
      this.vz *= Math.exp(-6 * dt)
    } else {
      // resistencia: esprintar drena; correr también un poco; caminar/parado recupera
      if (this.sprinting && this.speedNow > 3) {
        this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * dt)
      } else if (this.speedNow > 5) {
        this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * 0.25 * dt)
      } else {
        const regen = this.speedNow < 1.5 ? PLAYER.staminaRegenIdle : PLAYER.staminaRegenMove
        this.stamina = Math.min(100, this.stamina + regen * dt)
      }
      const maxS = this.maxSpeed()
      const desLen = Math.hypot(this.desiredVx, this.desiredVz)
      let tx = 0
      let tz = 0
      if (desLen > 0.01) {
        const scale = Math.min(1, maxS / desLen)
        tx = this.desiredVx * scale
        tz = this.desiredVz * scale
      }
      const rate = desLen > 0.01 ? PLAYER.accel : PLAYER.decel
      this.vx += clamp(tx - this.vx, -rate * dt, rate * dt)
      this.vz += clamp(tz - this.vz, -rate * dt, rate * dt)
    }

    this.x += this.vx * dt
    this.z += this.vz * dt
    this.x = clamp(this.x, -3, PITCH.L + 3)
    this.z = clamp(this.z, -3, PITCH.W + 3)

    const sp = this.speedNow
    if (sp > 0.6) this.dir = lerpAngle(this.dir, Math.atan2(this.vx, this.vz), 1 - Math.exp(-PLAYER.turnLerp * dt))

    this.updateVisual(dt, sp)
  }

  private updateVisual(dt: number, speed: number) {
    const swing = clamp(speed / 6.5, 0, 1.1)
    this.phase += dt * (1.6 + speed * 1.5)
    const sin = Math.sin(this.phase)
    const cos = Math.cos(this.phase)

    this.legL.rotation.x = sin * 0.85 * swing
    if (this.kickAnim > 0) {
      const t = 1 - this.kickAnim / 0.32
      this.legR.rotation.x = -1.25 * Math.sin(Math.PI * t)
    } else {
      this.legR.rotation.x = -sin * 0.85 * swing
    }
    this.armL.rotation.x = -sin * 0.6 * swing
    this.armR.rotation.x = sin * 0.6 * swing

    this.root.rotation.y = this.dir
    this.body.rotation.z = 0
    this.body.rotation.x = 0.1 * swing

    let baseY = 0
    if (this.slideTimer > 0) {
      this.body.rotation.x = -1.2
      baseY = -0.42
      this.legL.rotation.x = 0.25
      this.legR.rotation.x = -0.1
      this.armL.rotation.x = -0.9
      this.armR.rotation.x = -0.9
    } else if (this.diveTimer > 0) {
      const t = this.diveTimer / 0.7
      this.body.rotation.z = this.diveDir * 1.3 * Math.sin(Math.min(1, t) * Math.PI * 0.6)
      baseY = -0.35 * Math.sin(Math.min(1, t) * Math.PI)
    } else {
      baseY = Math.abs(cos) * 0.045 * swing
    }
    // sincronizar el rig 3D con la posición de la simulación
    this.root.position.set(this.x, baseY, this.z)
  }

  teleport(x: number, z: number) {
    this.x = x
    this.z = z
    this.vx = 0
    this.vz = 0
    this.stunTimer = 0
    this.slideTimer = 0
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root)
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.dispose()
    })
  }
}
