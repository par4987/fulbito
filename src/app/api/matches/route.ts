import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  MATCHES_DEFAULT_LIMIT,
  MATCHES_MAX_LIMIT,
  MATCH_DIFFICULTIES,
  serializeMatch,
} from '@/lib/matches'

export const dynamic = 'force-dynamic'

/**
 * Esquema de validación del body de POST /api/matches.
 * Contrato (worklog.md): todos los numéricos enteros ≥ 0; nombres ≤ 40 chars;
 * difficulty ∈ {amateur, profesional, leyenda}; possessionHome 0-100; events ≤ 20000 chars.
 */
const createMatchSchema = z.object({
  homeTeam: z
    .string()
    .trim()
    .min(1, 'El equipo local no puede estar vacío')
    .max(40, 'El nombre del equipo local no puede superar 40 caracteres'),
  awayTeam: z
    .string()
    .trim()
    .min(1, 'El equipo visitante no puede estar vacío')
    .max(40, 'El nombre del equipo visitante no puede superar 40 caracteres'),
  homeGoals: z
    .number()
    .int('Los goles locales deben ser un entero')
    .min(0, 'Los goles locales no pueden ser negativos'),
  awayGoals: z
    .number()
    .int('Los goles visitantes deben ser un entero')
    .min(0, 'Los goles visitantes no pueden ser negativos'),
  difficulty: z.enum(MATCH_DIFFICULTIES).default('profesional'),
  durationSec: z
    .number()
    .int('La duración debe ser un entero')
    .min(0, 'La duración no puede ser negativa'),
  possessionHome: z
    .number()
    .int('La posesión debe ser un entero')
    .min(0, 'La posesión debe estar entre 0 y 100')
    .max(100, 'La posesión debe estar entre 0 y 100'),
  shotsHome: z
    .number()
    .int('Los tiros locales deben ser un entero')
    .min(0, 'Los tiros locales no pueden ser negativos'),
  shotsAway: z
    .number()
    .int('Los tiros visitantes deben ser un entero')
    .min(0, 'Los tiros visitantes no pueden ser negativos'),
  shotsOnTargetHome: z
    .number()
    .int('Los tiros a puerta locales deben ser un entero')
    .min(0, 'Los tiros a puerta locales no pueden ser negativos'),
  shotsOnTargetAway: z
    .number()
    .int('Los tiros a puerta visitantes deben ser un entero')
    .min(0, 'Los tiros a puerta visitantes no pueden ser negativos'),
  foulsHome: z.number().int('Las faltas locales deben ser un entero').min(0).max(60).default(0),
  foulsAway: z.number().int('Las faltas visitantes deben ser un entero').min(0).max(60).default(0),
  yellowsHome: z.number().int('Las amarillas locales deben ser un entero').min(0).max(20).default(0),
  yellowsAway: z.number().int('Las amarillas visitantes deben ser un entero').min(0).max(20).default(0),
  redsHome: z.number().int('Las rojas locales deben ser un entero').min(0).max(11).default(0),
  redsAway: z.number().int('Las rojas visitantes deben ser un entero').min(0).max(11).default(0),
  events: z
    .string()
    .min(1, 'Los eventos no pueden estar vacíos')
    .max(20000, 'Los eventos no pueden superar 20000 caracteres'),
})

/** POST /api/matches — guarda el resultado de un partido. 201 {ok, match}. */
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Cuerpo de la petición inválido: se esperaba JSON' },
        { status: 400 }
      )
    }

    const parsed = createMatchSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.length ? issue.path.join('.') : 'body'
      return NextResponse.json(
        { ok: false, error: `Campo "${field}": ${issue?.message ?? 'datos inválidos'}` },
        { status: 400 }
      )
    }

    const created = await db.matchResult.create({ data: parsed.data })

    return NextResponse.json({ ok: true, match: serializeMatch(created) }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/matches] Error al guardar el partido:', error)
    return NextResponse.json(
      { ok: false, error: 'Error al guardar el partido' },
      { status: 500 }
    )
  }
}

/** GET /api/matches?limit=20 — historial de partidos, más recientes primero. */
export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get('limit')
    let limit = MATCHES_DEFAULT_LIMIT

    if (limitParam !== null) {
      const parsedLimit = Number.parseInt(limitParam, 10)
      if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
        return NextResponse.json(
          { ok: false, error: 'Parámetro "limit" inválido: debe ser un entero ≥ 1 (máximo 50)' },
          { status: 400 }
        )
      }
      limit = Math.min(parsedLimit, MATCHES_MAX_LIMIT)
    }

    const matches = await db.matchResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ ok: true, matches: matches.map(serializeMatch) })
  } catch (error) {
    console.error('[GET /api/matches] Error al obtener el historial:', error)
    return NextResponse.json(
      { ok: false, error: 'Error al obtener el historial de partidos' },
      { status: 500 }
    )
  }
}
