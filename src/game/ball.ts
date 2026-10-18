import { BALL, PITCH, clamp } from './constants'

/**
 * Balón con física 2.5D: posición (x, z) en el plano, y = altura.
 * Incluye fricción de rodadura, gravedad, rebotes y predicción para la IA.
 */
export class Ball {
  x = PITCH.L / 2
  z = PITCH.W / 2
  y = BALL.r
  vx = 0
  vy = 0
  vz = 0
  /** equipo del último toque (para saques de banda/córner/saque de puerta) */
  lastTouch: 0 | 1 = 0
  /** rueda visual */
  spinAxisX = 0
  spinAxisZ = 0
  spinAngle = 0

  reset(x = PITCH.L / 2, z = PITCH.W / 2) {
    this.x = x
    this.z = z
    this.y = BALL.r
    this.vx = 0
    this.vy = 0
    this.vz = 0
  }

  get speed() {
    return Math.hypot(this.vx, this.vz)
  }

  kick(dx: number, dz: number, speed: number, vz: number) {
    const len = Math.hypot(dx, dz) || 1
    this.vx = (dx / len) * speed
    this.vz = (dz / len) * speed
    this.vy = vz
    this.y = Math.max(this.y, BALL.r)
  }

  /** Posición futura aproximada (con fricción exponencial) a t segundos. */
  future(t: number): { x: number; z: number } {
    const k = BALL.rollFriction * 0.75
    const f = (1 - Math.exp(-k * t)) / k
    return { x: this.x + this.vx * f, z: this.z + this.vz * f }
  }

  stop() {
    this.vx = 0
    this.vy = 0
    this.vz = 0
  }

  update(dt: number): 'post' | null {
    // Gravedad y aire
    this.vy -= BALL.gravity * dt
    this.vx *= Math.exp(-(this.y > BALL.r * 1.2 ? BALL.airFriction : BALL.rollFriction) * dt)
    this.vz *= Math.exp(-(this.y > BALL.r * 1.2 ? BALL.airFriction : BALL.rollFriction) * dt)

    this.x += this.vx * dt
    this.y += this.vy * dt
    this.z += this.vz * dt

    // Suelo
    if (this.y < BALL.r) {
      this.y = BALL.r
      if (this.vy < -1.2) {
        this.vy = -this.vy * BALL.bounce
        return null
      }
      this.vy = 0
    }

    // Rotación visual según velocidad
    const sp = this.speed
    if (sp > 0.05) {
      this.spinAngle += (sp / BALL.r) * dt * 0.35
      this.spinAxisZ = this.vx / sp
      this.spinAxisX = this.vz / sp
    }

    // Palos y travesaño (rebote cuando el balón intenta cruzar la línea)
    const nearGoalLine = this.x < 0.4 || this.x > PITCH.L - 0.4
    if (nearGoalLine && this.y < PITCH.goalH + 0.3) {
      const dCenter = Math.abs(this.z - PITCH.W / 2)
      const crossing = this.vx * (this.x < PITCH.L / 2 ? -1 : 1) > 0
      if (crossing) {
        // palos: cerca de los bordes de la boca
        if (Math.abs(dCenter - PITCH.goalW / 2) < 0.25) {
          this.vx *= -0.42
          this.vz += (this.z - PITCH.W / 2) * 0.8
          return 'post'
        }
        // travesaño
        if (Math.abs(dCenter) < PITCH.goalW / 2 + 0.2 && this.y > PITCH.goalH - 0.28) {
          this.vx *= -0.3
          this.vy = Math.abs(this.vy) * 0.35 + 2
          return 'crossbar'
        }
      }
    }
    return null
  }

  clampInsideForRestart() {
    this.x = clamp(this.x, 0.5, PITCH.L - 0.5)
    this.z = clamp(this.z, 0.5, PITCH.W - 0.5)
  }
}
