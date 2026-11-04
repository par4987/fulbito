import { FORMATION_433, hashString, makeRng } from './constants'
import type { PlayerData, TeamDef, TeamRoster } from './types'

// Equipos ficticios (sin licencias reales). Paleta variada, sin azul dominante.
export const TEAMS: TeamDef[] = [
  { id: 'condor', name: 'Cóndor FC', short: 'CFC', rating: 88, kit: { shirt: '#c81e2b', shorts: '#ffffff', socks: '#c81e2b', gk: '#2fbf71' } },
  { id: 'cumbre', name: 'Real Cumbre', short: 'RCU', rating: 90, kit: { shirt: '#f2f2f0', shorts: '#f2f2f0', socks: '#d8b13c', gk: '#b04ad6' } },
  { id: 'puma', name: 'Atlético Puma', short: 'APU', rating: 85, kit: { shirt: '#17181c', shorts: '#17181c', socks: '#e2711d', gk: '#e2c21d' } },
  { id: 'volcan', name: 'Deportivo Volcán', short: 'DVO', rating: 83, kit: { shirt: '#7a1220', shorts: '#2a2a2e', socks: '#7a1220', gk: '#3aa655' } },
  { id: 'aurora', name: 'Unión Aurora', short: 'UAU', rating: 82, kit: { shirt: '#e8c832', shorts: '#17181c', socks: '#e8c832', gk: '#c2452f' } },
  { id: 'maritimo', name: 'Sporting Marítimo', short: 'SMA', rating: 80, kit: { shirt: '#1fa88c', shorts: '#ffffff', socks: '#1fa88c', gk: '#d6681f' } },
  { id: 'lobos', name: 'Lobos del Valle', short: 'LVA', rating: 79, kit: { shirt: '#3c4048', shorts: '#a3cc2a', socks: '#3c4048', gk: '#c2b28a' } },
  { id: 'polar', name: 'Estrella Polar', short: 'EPO', rating: 86, kit: { shirt: '#e8e6df', shorts: '#17181c', socks: '#e8e6df', gk: '#2fa3b8' } },
  { id: 'horizonte', name: 'CF Horizonte', short: 'CHO', rating: 78, kit: { shirt: '#6d3fb0', shorts: '#f2f2f0', socks: '#6d3fb0', gk: '#8ad13c' } },
  { id: 'titanes', name: 'Titanes de Acero', short: 'TAC', rating: 81, kit: { shirt: '#5c6670', shorts: '#c81e2b', socks: '#5c6670', gk: '#e0b41f' } },
  { id: 'rio', name: 'Círculo del Río', short: 'CRI', rating: 77, kit: { shirt: '#1e7a34', shorts: '#ffffff', socks: '#1e7a34', gk: '#d63b6a' } },
  { id: 'centauro', name: 'Club Centauro', short: 'CCE', rating: 76, kit: { shirt: '#d64a8a', shorts: '#17181c', socks: '#d64a8a', gk: '#6dc2a0' } },
]

const SURNAMES = [
  'García', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'Gómez', 'Sánchez',
  'Romero', 'Díaz', 'Álvarez', 'Torres', 'Ruiz', 'Ramírez', 'Flores', 'Acosta',
  'Benítez', 'Medina', 'Aguirre', 'Molina', 'Castro', 'Ortiz', 'Silva', 'Vega',
  'Marín', 'Rojas', 'Herrera', 'Aguilar', 'Ponce', 'Vargas', 'Cabrera', 'Sosa',
  'Villalba', 'Ledesma', 'Quiroga', 'Paredes', 'Coronel', 'Bustos', 'Ferreyra', 'Ibarra',
]

const INITIALS = 'LMJADC FRENGSTIBPHV'.split('')

const rosterCache = new Map<string, TeamRoster>()

/** Puestos del banco de suplentes (12): 2 porteros, 4 defensores, 4 mediocampistas, 2 delanteros. */
const BENCH_SLOTS: Array<{ role: PlayerData['role']; num: number }> = [
  { role: 'GK', num: 12 },
  { role: 'DF', num: 13 },
  { role: 'DF', num: 14 },
  { role: 'DF', num: 15 },
  { role: 'DF', num: 16 },
  { role: 'MF', num: 17 },
  { role: 'MF', num: 18 },
  { role: 'MF', num: 19 },
  { role: 'MF', num: 20 },
  { role: 'FW', num: 21 },
  { role: 'FW', num: 22 },
  { role: 'GK', num: 23 },
]

function makePlayerData(slot: { role: PlayerData['role']; num: number }, rng: () => number, base: number, used: Set<string>): PlayerData {
  let name = ''
  do {
    const ini = INITIALS[Math.floor(rng() * INITIALS.length)]
    const sur = SURNAMES[Math.floor(rng() * SURNAMES.length)]
    name = `${ini}. ${sur}`
  } while (used.has(name))
  used.add(name)
  const roleSkill = slot.role === 'GK' ? 0.05 : slot.role === 'FW' ? 0.12 : slot.role === 'MF' ? 0.06 : 0
  const roleSpeed = slot.role === 'FW' ? 0.1 : slot.role === 'MF' ? 0.05 : slot.role === 'DF' ? 0.02 : -0.05
  return {
    num: slot.num,
    name,
    role: slot.role,
    skill: Math.min(1, Math.max(0.3, base + roleSkill + (rng() - 0.5) * 0.18)),
    speed: Math.min(1, Math.max(0.3, base + roleSpeed + (rng() - 0.5) * 0.2)),
  }
}

/** Plantilla determinista por equipo: 11 titulares + 12 suplentes (banco completo). */
export function getRoster(teamId: string): TeamRoster {
  const cached = rosterCache.get(teamId)
  if (cached) return cached
  const def = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0]
  const rng = makeRng(hashString('roster:' + def.id))
  const used = new Set<string>()
  // El nivel base del equipo modula habilidad/velocidad por puesto.
  const base = (def.rating - 70) / 20 // 0.3 .. 1.0
  const players: PlayerData[] = FORMATION_433.map((slot) => makePlayerData(slot, rng, base, used))
  const bench: PlayerData[] = BENCH_SLOTS.map((slot) => makePlayerData(slot, rng, base, used))
  const roster: TeamRoster = { def, players, bench }
  rosterCache.set(teamId, roster)
  return roster
}
