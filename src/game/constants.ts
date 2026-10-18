// Dimensiones del campo (reglamento FIFA), en metros.
export const PITCH = {
  L: 105, // largo (eje X)
  W: 68, // ancho (eje Z)
  goalW: 7.32,
  goalH: 2.44,
  goalDepth: 2.0,
  boxD: 16.5,
  boxW: 40.32,
  sixD: 5.5,
  sixW: 18.32,
  spot: 11,
  circleR: 9.15,
  cornerR: 1.0,
} as const

export const GOAL = {
  zMin: PITCH.W / 2 - PITCH.goalW / 2, // 30.34
  zMax: PITCH.W / 2 + PITCH.goalW / 2, // 37.66
  zCenter: PITCH.W / 2,
} as const

export const SIM = {
  dt: 1 / 60,
  maxFrame: 0.05,
} as const

export const BALL = {
  r: 0.16,
  gravity: 20,
  rollFriction: 0.58, // fricción exponencial por segundo (rodando)
  airFriction: 0.09,
  bounce: 0.55,
} as const

export const PLAYER = {
  radius: 0.5,
  reach: 1.05, // radio de control del balón
  controlHeight: 1.35,
  baseSpeed: 6.9,
  sprintMult: 1.3,
  dribbleMult: 0.88,
  accel: 30,
  decel: 13,
  turnLerp: 12,
  staminaDrain: 6.5,
  staminaRegen: 5.0,
  kickCooldown: 0.4,
  slideSpeed: 12.5,
  slideTime: 0.5,
  slideCooldown: 1.7,
  tackleRange: 1.7,
  tackleCooldown: 0.8,
} as const

export const MATCH_RULES = {
  realMinutesPerMatch: 90,
  halfTimePause: 3.0,
  goalCelebration: 3.2,
  kickoffFreeze: 1.1,
  restartFreeze: 0.9,
  gkHoldTime: 1.1,
} as const

// Valores por dificultad para la CPU (y leve ajuste al usuario).
export const DIFFICULTY = {
  amateur: { aiSpeed: 0.9, react: 0.32, passErr: 0.22, shootErr: 0.18, tackle: 0.5, aggro: 0.8, userBoost: 1.06 },
  profesional: { aiSpeed: 1.0, react: 0.2, passErr: 0.13, shootErr: 0.11, tackle: 0.62, aggro: 1.05, userBoost: 1.0 },
  leyenda: { aiSpeed: 1.07, react: 0.12, passErr: 0.07, shootErr: 0.06, tackle: 0.75, aggro: 1.35, userBoost: 0.97 },
} as const

// Formación 4-3-3. ax: 0 = arco propio, 1 = arco rival. az: 0..1 ancho del campo.
export const FORMATION_433 = [
  { role: 'GK', ax: 0.035, az: 0.5, num: 1 },
  { role: 'DF', ax: 0.17, az: 0.16, num: 4 },
  { role: 'DF', ax: 0.14, az: 0.38, num: 2 },
  { role: 'DF', ax: 0.14, az: 0.62, num: 5 },
  { role: 'DF', ax: 0.17, az: 0.84, num: 3 },
  { role: 'MF', ax: 0.36, az: 0.28, num: 6 },
  { role: 'MF', ax: 0.31, az: 0.5, num: 8 },
  { role: 'MF', ax: 0.36, az: 0.72, num: 10 },
  { role: 'FW', ax: 0.6, az: 0.16, num: 7 },
  { role: 'FW', ax: 0.64, az: 0.5, num: 9 },
  { role: 'FW', ax: 0.6, az: 0.84, num: 11 },
] as const

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const dist2d = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)
/** Interpolación angular suave (radianes). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}
/** Ruido determinista simple (mulberry32). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
