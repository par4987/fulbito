import { GOAL, PITCH, PLAYER, clamp, dist2d } from './constants'
import type { Match } from './match'
import type { PlayerEntity, } from './player'
import type { TeamIndex } from './types'

/**
 * IA de los dos equipos: persecución, coberturas, marcajes, apoyos,
 * decisiones del portador y posicionamiento/atajadas del portero.
 * El jugador controlado por el usuario nunca es gobernado por aquí.
 */
export function updateMatchAI(m: Match, dt: number) {
  const ball = m.ball
  const ownerTeam = m.owner ? m.owner.team : null

  for (const t of [0, 1] as TeamIndex[]) {
    const sq = m.squad(t)
    const isCpu = t === 1
    const speedMult = isCpu ? m.diff.aiSpeed : 1
    const react = isCpu ? m.diff.react : 0.2
    const hasBall = ownerTeam === t
    const ownGoalX = m.ownGoalOf(t)
    const attackGoalX = m.goalOf(t)

    // --- portero
    const gk = sq.players[0]
    if (gk !== m.controlled && m.owner !== gk) updateGK(m, gk, ownGoalX, speedMult)

    // --- selección de perseguidor
    const fut = ball.future(0.3)
    let chaser: PlayerEntity | null = m.aiPassHint && m.aiPassHint.team === t && !m.owner ? m.aiPassHint : null
    let cover: PlayerEntity | null = null
    if (!hasBall) {
      const candidates = sq.players.filter((p) => !p.isGK && p !== m.controlled && p !== chaser)
      const sorted = [...candidates].sort(
        (a, b) => dist2d(a.x, a.z, fut.x, fut.z) - dist2d(b.x, b.z, fut.x, fut.z),
      )
      if (!chaser) chaser = sorted[0] ?? null
      cover = sorted[1] ?? null
    }

    for (const p of sq.players) {
      if (p === m.controlled) continue
      if (p.isGK) continue // el portero ya fue actualizado
      p.speedMult = speedMult
      p.aiTimer -= dt

      // --- portador IA (solo CPU o resett de equipo rival)
      if (m.owner === p) {
        updateOwnerAI(m, p, attackGoalX, react)
        continue
      }

      const target = formationTarget(m, sq, p)
      let tx = target.x
      let tz = target.z
      let urgency = 0.9

      if (!hasBall) {
        if (p === chaser) {
          // perseguir el balón / presionar al portador
          if (m.owner) {
            tx = m.owner.x
            tz = m.owner.z
            if (
              dist2d(p.x, p.z, m.owner.x, m.owner.z) < PLAYER.tackleRange &&
              p.tackleCd <= 0 &&
              Math.random() < m.diff.tackle * dt * 3
            ) {
              m.tryTackle(p)
            }
          } else {
            tx = fut.x
            tz = fut.z
          }
          urgency = 1.15
          p.sprinting = true
        } else if (p === cover && m.owner) {
          // cobertura entre el balón y el arco propio
          const dx = ownGoalX - m.ball.x
          const dz = GOAL.zCenter - m.ball.z
          const d = Math.hypot(dx, dz) || 1
          tx = m.ball.x + (dx / d) * 6
          tz = m.ball.z + (dz / d) * 6
          urgency = 1.05
        } else if (p.data.role === 'DF') {
          // marcaje hombre-zona: entre el rival más cercano y el arco propio
          const mark = nearestOpponent(m, t, tx, tz, 13)
          if (mark) {
            const dx = ownGoalX - mark.x
            const dz = GOAL.zCenter - mark.z
            const d = Math.hypot(dx, dz) || 1
            tx = mark.x + (dx / d) * 1.9
            tz = mark.z + (dz / d) * 1.9
            urgency = 1.05
          }
        } else if (p.data.role === 'MF' && m.owner) {
          // un mediocampista vuelve a presionar apoyando al chaser
          const dBall = dist2d(p.x, p.z, m.ball.x, m.ball.z)
          if (dBall < 16) {
            tx = fut.x + (ownGoalX > m.ball.x ? 5 : -5)
            tz = m.ball.z
            urgency = 1
          }
        }
      } else {
        // equipo en posesión: apoyos
        if (p.data.role === 'MF' && m.owner) {
          const dOwner = dist2d(p.x, p.z, m.owner.x, m.owner.z)
          if (dOwner < 9) {
            // ofrece pase corto diagonal
            tx = m.owner.x - (attackGoalX > m.owner.x ? 6 : -6)
            tz = m.owner.z + (m.owner.z < PITCH.W / 2 ? 7 : -7)
          } else {
            tx = clamp(m.owner.x - (attackGoalX > m.owner.x ? 12 : -12), 2, PITCH.L - 2)
            tz = p.az * PITCH.W
          }
        } else if (p.data.role === 'FW' && m.owner) {
          // desmarque hacia el arco
          const run = 8 + Math.sin(m.clock * 1.3 + p.data.num) * 4
          tx = clamp(attackGoalX + (attackGoalX > 0 ? -run : run), 2, PITCH.L - 2)
          urgency = 1.05
        }
      }

      p.targetX = tx
      p.targetZ = tz
      seek(p, tx, tz, urgency)
    }
  }
}

/** Movimiento hacia un objetivo con frenado de llegada. */
function seek(p: PlayerEntity, tx: number, tz: number, urgency = 1) {
  const dx = tx - p.x
  const dz = tz - p.z
  const d = Math.hypot(dx, dz)
  if (d < 0.7) {
    p.desiredVx = 0
    p.desiredVz = 0
    p.sprinting = false
    return
  }
  const sp = p.maxSpeed() * urgency * Math.min(1, d / 2.5)
  p.desiredVx = (dx / d) * sp
  p.desiredVz = (dz / d) * sp
  p.sprinting = d > 5
}

function nearestOpponent(m: Match, team: TeamIndex, x: number, z: number, maxD: number): PlayerEntity | null {
  const opp = m.squad(team === 0 ? 1 : 0).players
  let best: PlayerEntity | null = null
  let bestD = maxD
  for (const o of opp) {
    if (o.isGK) continue
    const d = dist2d(o.x, o.z, x, z)
    if (d < bestD) {
      bestD = d
      best = o
    }
  }
  return best
}

/**
 * Posición base del jugador según formación + desplazamiento con el balón.
 * Trabaja en "coordenadas de avance": 0 = línea de arco propio, 105 = arco rival.
 * La línea defensiva sigue al balón pero con límites estrictos: nunca se pega a
 * la línea de meta propia ni queda congelada; sube cuando el equipo ataca.
 */
function formationTarget(m: Match, sq: ReturnType<Match['squad']>, p: PlayerEntity) {
  const dir = sq.attackDir
  const toAdv = (x: number) => (dir > 0 ? x : PITCH.L - x)
  const ballAdv = toAdv(m.ball.x)
  const homeAdv = p.ax * PITCH.L
  const homeZ = p.az * PITCH.W
  const hasBall = m.owner ? m.owner.team === p.team : false

  let adv: number
  if (p.data.role === 'DF') {
    // línea defensiva: acompana al balón (62% de su avance) con piso de 11 m
    // desde el arco propio y techo de ~60 m cuando se ataca
    let line = clamp(ballAdv * 0.62 + (hasBall ? 16 : -2), 11, 60)
    if (!hasBall) line = Math.min(line, Math.max(11, ballAdv - 3))
    // laterales un poco más adelantados que los centrales
    adv = line + (homeAdv - 0.14 * PITCH.L) * 0.55
  } else {
    const shift = clamp((ballAdv - PITCH.L / 2) * 0.55, -22, 22) + (hasBall ? 7 : -5)
    adv = clamp(homeAdv + shift, 8, 100)
  }
  const x = dir > 0 ? adv : PITCH.L - adv
  return { x: clamp(x, 1.5, PITCH.L - 1.5), z: clamp(homeZ + (m.ball.z - homeZ) * 0.25, 2, PITCH.W - 2) }
}

/** Decisiones del jugador con balón controlado por IA. */
function updateOwnerAI(m: Match, p: PlayerEntity, attackGoalX: number, react: number) {
  const sq = m.squad(p.team)
  const dir = sq.attackDir

  // Inmediatamente tras un saque/córner, jugar rápido
  if (m.ownerHold < 0.35 && m.phase === 'play' && p.kickCooldown <= 0) {
    const nearCorner = Math.abs(p.z - PITCH.W / 2) > 24 && Math.abs(p.x - attackGoalX) < 4
    if (nearCorner) {
      // centro al área
      m.doPass(p, attackGoalX + (attackGoalX > p.x ? -10 : 10) - p.x, GOAL.zCenter + (Math.random() - 0.5) * 8 - p.z, true)
      return
    }
    m.doPass(p, dir, (Math.random() - 0.5) * 0.6, false)
    return
  }

  if (p.aiTimer > 0) {
    // seguir conduciendo con la decisión previa
    dribble(m, p, attackGoalX)
    return
  }
  p.aiTimer = 0.14 + Math.random() * 0.12 + react * 0.3

  const distG = dist2d(p.x, p.z, attackGoalX, GOAL.zCenter)
  const press = nearestOpponent(m, p.team, p.x, p.z, 30)
  const pressure = press ? dist2d(press.x, press.z, p.x, p.z) : 30

  // 1) tiro
  const shootRange = 15 + p.data.skill * 10
  const angleOk = Math.abs(p.z - GOAL.zCenter) < 17 + (30 - Math.min(30, distG)) * 0.3
  if (distG < shootRange && angleOk) {
    const chance = distG < 12 ? 1 : distG < 18 ? 0.55 : 0.25
    if (Math.random() < chance) {
      const power = clamp(distG / 26, 0.45, 0.95)
      const aim = (Math.random() - 0.5) * 1.4
      m.doShoot(p, power, aim)
      return
    }
  }

  // 2) pase bajo presión o si hay mejor opción adelante
  if (pressure < 2.8 || Math.random() < 0.16) {
    const forwardX = dir * 10
    m.doPass(p, forwardX, (Math.random() - 0.5) * 14, pressure < 1.6 && Math.random() < 0.4)
    if (m.owner === null) return // el pase se ejecutó
  }

  // 3) conducción
  dribble(m, p, attackGoalX)
}

function dribble(m: Match, p: PlayerEntity, attackGoalX: number) {
  const dx = attackGoalX - p.x
  const dz = GOAL.zCenter + (m.ball.z - GOAL.zCenter) * 0.4 - p.z
  const d = Math.hypot(dx, dz) || 1
  let sx = dx / d
  let sz = dz / d

  // evadir al defensor más cercano
  const press = nearestOpponent(m, p.team, p.x, p.z, 6)
  if (press) {
    const ax = p.x - press.x
    const az = p.z - press.z
    const ad = Math.hypot(ax, az) || 1
    // componente perpendicular de escape
    sx += (az / ad) * 0.9 * Math.sign(ax * sz - az * sx || 1)
    sz += (-ax / ad) * 0.9 * Math.sign(ax * sz - az * sx || 1)
  }
  // alejarse de las bandas
  if (p.z < 8) sz += 0.5
  if (p.z > PITCH.W - 8) sz -= 0.5

  const len = Math.hypot(sx, sz) || 1
  const sp = p.maxSpeed()
  p.desiredVx = (sx / len) * sp
  p.desiredVz = (sz / len) * sp
  p.sprinting = m.ownerHold > 0.5
}

/** Portero: posicionamiento, salidas y atajadas. */
function updateGK(m: Match, gk: PlayerEntity, ownGoalX: number, speedMult: number) {
  gk.speedMult = speedMult
  const dir = ownGoalX > 52.5 ? -1 : 1 // dirección desde el arco hacia el campo
  const ball = m.ball
  const distBall = dist2d(ball.x, ball.z, ownGoalX, GOAL.zCenter)

  // tiro entrante: predecir cruce en la línea
  const towardGoal = ownGoalX < 52.5 ? ball.vx < -5 : ball.vx > 5
  let tx = ownGoalX + dir * clamp(0.8 + (1 - clamp(distBall / 45, 0, 1)) * 3.2, 0.8, 4)
  let tz = GOAL.zCenter + clamp((ball.z - GOAL.zCenter) * 0.38, -3.1, 3.1)

  if (towardGoal && ball.speed > 9) {
    const t = (ownGoalX + dir * 0.5 - ball.x) / ball.vx
    if (t > 0 && t < 1.6) {
      const zPred = ball.z + ball.vz * t
      if (Math.abs(zPred - GOAL.zCenter) < PITCH.goalW / 2 + 2.5) {
        tx = ownGoalX + dir * 0.5
        tz = clamp(zPred, GOAL.zMin - 0.8, GOAL.zMax + 0.8)
        gk.sprinting = true
        // estirada si el balón pasa cerca
        const near = dist2d(gk.x, gk.z, ball.x, ball.z)
        if (near < 2.4 && ball.y < 2.4 && gk.diveTimer <= 0 && ball.speed > 11) {
          gk.diveTimer = 0.7
          gk.diveDir = Math.sign(ball.z - gk.z) || 1
        }
      }
    }
  } else if (
    !m.owner &&
    distBall < 15 &&
    ball.speed < 8 &&
    ball.y < 1.6 &&
    Math.abs(ball.x - ownGoalX) < PITCH.boxD
  ) {
    // salida a buscar balón suelto en su área
    tx = ball.x
    tz = ball.z
    gk.sprinting = true
  }

  gk.targetX = tx
  gk.targetZ = tz
  seek(gk, tx, tz, 1.1)
}
