export type TeamIndex = 0 | 1
export type Role = 'GK' | 'DF' | 'MF' | 'FW'
export type Difficulty = 'amateur' | 'profesional' | 'leyenda'
export type Phase = 'kickoff' | 'play' | 'goal' | 'restart' | 'half' | 'full'
export type CameraMode = 'broadcast' | 'cerca' | 'aerea' | 'arco'

export interface PlayerData {
  num: number
  name: string
  role: Role
  /** 0..1 */
  speed: number
  /** 0..1 */
  skill: number
}

export interface Kit {
  shirt: string
  shorts: string
  socks: string
  /** color del kit del portero */
  gk: string
}

export interface TeamDef {
  id: string
  name: string
  /** abreviatura de 3 letras para el marcador */
  short: string
  rating: number
  kit: Kit
}

export interface TeamRoster {
  def: TeamDef
  players: PlayerData[]
  /** suplentes disponibles para cambios */
  bench: PlayerData[]
}

export interface MatchSettings {
  difficulty: Difficulty
  /** minutos reales que dura el partido completo */
  durationMin: number
}

export interface MatchEvent {
  minute: number
  text: string
  kind: 'goal' | 'info' | 'chance'
}

export interface HudState {
  phase: Phase
  half: 1 | 2
  minute: number
  score: [number, number]
  possession: [number, number]
  shots: [number, number]
  onTarget: [number, number]
  events: MatchEvent[]
  controlled: { name: string; num: number; stamina: number } | null
  goalOverlay: { team: TeamIndex; scorer: string } | null
  cameraMode: CameraMode
  muted: boolean
}

/** Jugador resumido para la interfaz de cambios. */
export interface SubPlayerInfo {
  idx: number
  num: number
  name: string
  role: Role
}

export interface SubState {
  used: number
  max: number
  onField: Array<SubPlayerInfo & { stamina: number; gk: boolean }>
  bench: Array<SubPlayerInfo & { available: boolean }>
}

export type SubResult = 'ok' | 'limite' | 'invalido'

export interface FullTimeResult {
  home: TeamDef
  away: TeamDef
  score: [number, number]
  possession: [number, number]
  shots: [number, number]
  onTarget: [number, number]
  events: MatchEvent[]
  difficulty: Difficulty
  durationSec: number
}

/** Config de inicio que llega desde la UI al motor. */
export interface MatchConfig {
  homeTeamId: string
  awayTeamId: string
  settings: MatchSettings
}
