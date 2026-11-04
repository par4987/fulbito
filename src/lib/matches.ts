// Tipos compartidos de la API de historial de partidos — Fútbol Pro 3D (Task 2-a)
// Contrato acordado en worklog.md: POST /api/matches → 201 {ok, match} · GET /api/matches?limit=20 → {matches}

/** Dificultades admitidas por el juego (ordenadas de más fácil a más difícil). */
export const MATCH_DIFFICULTIES = ['amateur', 'profesional', 'leyenda'] as const

export type MatchDifficulty = (typeof MATCH_DIFFICULTIES)[number]

/** Límite por defecto y máximo del parámetro `limit` en GET /api/matches. */
export const MATCHES_DEFAULT_LIMIT = 20
export const MATCHES_MAX_LIMIT = 50

/**
 * Payload que el cliente envía al guardar un partido (POST /api/matches).
 * `events` es un JSON stringificado de un array de strings (ej: '["Gol de Ríos al 12\'", "Córner para Atlas"]').
 */
export interface MatchResultInput {
  homeTeam: string
  awayTeam: string
  homeGoals: number
  awayGoals: number
  difficulty: MatchDifficulty
  durationSec: number
  /** Posesión del equipo local en porcentaje (0-100). */
  possessionHome: number
  shotsHome: number
  shotsAway: number
  shotsOnTargetHome: number
  shotsOnTargetAway: number
  /** faltas y tarjetas por equipo (local / visitante) */
  foulsHome: number
  foulsAway: number
  yellowsHome: number
  yellowsAway: number
  redsHome: number
  redsAway: number
  events: string
}

/** Registro de partido tal como lo devuelve la API (createdAt serializado a ISO string para JSON). */
export interface MatchResultRecord {
  id: string
  homeTeam: string
  awayTeam: string
  homeGoals: number
  awayGoals: number
  difficulty: MatchDifficulty
  durationSec: number
  possessionHome: number
  shotsHome: number
  shotsAway: number
  shotsOnTargetHome: number
  shotsOnTargetAway: number
  foulsHome: number
  foulsAway: number
  yellowsHome: number
  yellowsAway: number
  redsHome: number
  redsAway: number
  events: string
  createdAt: string
}

/** Respuesta de POST /api/matches (unión discriminada por `ok`). */
export type MatchPostResponse =
  | { ok: true; match: MatchResultRecord }
  | { ok: false; error: string }

/** Respuesta de GET /api/matches (unión discriminada por `ok`). */
export type MatchesGetResponse =
  | { ok: true; matches: MatchResultRecord[] }
  | { ok: false; error: string }

/** Convierte una fila de Prisma (`MatchResult`) en el DTO JSON-safe que expone la API. */
export function serializeMatch(row: {
  id: string
  homeTeam: string
  awayTeam: string
  homeGoals: number
  awayGoals: number
  difficulty: string
  durationSec: number
  possessionHome: number
  shotsHome: number
  shotsAway: number
  shotsOnTargetHome: number
  shotsOnTargetAway: number
  foulsHome: number
  foulsAway: number
  yellowsHome: number
  yellowsAway: number
  redsHome: number
  redsAway: number
  events: string
  createdAt: Date
}): MatchResultRecord {
  return {
    id: row.id,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homeGoals: row.homeGoals,
    awayGoals: row.awayGoals,
    difficulty: row.difficulty as MatchDifficulty,
    durationSec: row.durationSec,
    possessionHome: row.possessionHome,
    shotsHome: row.shotsHome,
    shotsAway: row.shotsAway,
    shotsOnTargetHome: row.shotsOnTargetHome,
    shotsOnTargetAway: row.shotsOnTargetAway,
    foulsHome: row.foulsHome,
    foulsAway: row.foulsAway,
    yellowsHome: row.yellowsHome,
    yellowsAway: row.yellowsAway,
    redsHome: row.redsHome,
    redsAway: row.redsAway,
    events: row.events,
    createdAt: row.createdAt.toISOString(),
  }
}
