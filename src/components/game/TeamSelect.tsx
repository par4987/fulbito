'use client'

import { ArrowLeftRight, ChevronLeft, ChevronRight, Play, Shuffle } from 'lucide-react'
import { useState } from 'react'
import { ControlsTable } from '@/components/game/MenuScreen'
import { Button } from '@/components/ui/button'
import { TEAMS } from '@/game/teams'
import type { Difficulty } from '@/game/types'

interface Props {
  initialHome: string
  initialAway: string
  difficulty: Difficulty
  onBack: () => void
  onStart: (homeId: string, awayId: string) => void
}

export default function TeamSelect({ initialHome, initialAway, difficulty, onBack, onStart }: Props) {
  const [homeIdx, setHomeIdx] = useState(Math.max(0, TEAMS.findIndex((t) => t.id === initialHome)))
  const [awayIdx, setAwayIdx] = useState(Math.max(0, TEAMS.findIndex((t) => t.id === initialAway)))
  const home = TEAMS[homeIdx]
  const away = TEAMS[awayIdx]

  const randomize = () => {
    const a = Math.floor(Math.random() * TEAMS.length)
    let b = Math.floor(Math.random() * TEAMS.length)
    if (b === a) b = (b + 1) % TEAMS.length
    setHomeIdx(a)
    setAwayIdx(b)
  }

  const diffLabel = difficulty === 'amateur' ? 'AMATEUR' : difficulty === 'leyenda' ? 'LEYENDA' : 'PROFESIONAL'

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-zinc-950 text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 75% 50% at 50% 0%, rgba(29,128,56,0.32), transparent 55%), linear-gradient(#05070b, #0a1410 65%, #06090c)',
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-4 pt-4 sm:px-6">
        <Button
          onClick={onBack}
          variant="outline"
          className="h-9 border-white/15 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Menú
        </Button>
        <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.25em] text-amber-300">
          Dificultad: {diffLabel}
        </span>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8">
        <h2 className="text-center text-2xl font-black italic uppercase tracking-tighter sm:text-3xl">
          Seleccioná los <span className="text-amber-300">equipos</span>
        </h2>

        <div className="flex w-full max-w-3xl flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
          <TeamPicker
            label="Tu equipo"
            teamIdx={homeIdx}
            onChange={setHomeIdx}
            disabledIdx={awayIdx}
            accent="amber"
          />

          <div className="flex flex-col items-center gap-2">
            <div className="text-3xl font-black italic text-amber-300 sm:text-4xl">VS</div>
            <button
              onClick={() => {
                const h = homeIdx
                setHomeIdx(awayIdx)
                setAwayIdx(h)
              }}
              title="Intercambiar"
              className="rounded-full border border-white/15 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white active:scale-95"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <button
              onClick={randomize}
              title="Aleatorio"
              className="rounded-full border border-white/15 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white active:scale-95"
            >
              <Shuffle className="h-4 w-4" />
            </button>
          </div>

          <TeamPicker
            label="Rival (CPU)"
            teamIdx={awayIdx}
            onChange={setAwayIdx}
            disabledIdx={homeIdx}
            accent="rose"
          />
        </div>

        <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-sm">
          <ControlsTable />
        </div>

        <Button
          onClick={() => onStart(home.id, away.id)}
          className="h-13 w-full max-w-md rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 py-6 text-base font-black uppercase tracking-widest text-black shadow-[0_10px_30px_rgba(232,200,50,0.3)] hover:from-amber-300 hover:to-amber-400"
        >
          <Play className="mr-2 h-5 w-5 fill-black" /> ¡Comenzar partido!
        </Button>
      </main>
    </div>
  )
}

function TeamPicker({
  label,
  teamIdx,
  onChange,
  disabledIdx,
  accent,
}: {
  label: string
  teamIdx: number
  onChange: (i: number) => void
  disabledIdx: number
  accent: 'amber' | 'rose'
}) {
  const team = TEAMS[teamIdx]
  const stars = Math.round(team.rating / 20)
  const accentText = accent === 'amber' ? 'text-amber-300' : 'text-rose-300'

  const step = (d: number) => {
    let i = (teamIdx + d + TEAMS.length) % TEAMS.length
    while (i === disabledIdx) i = (i + d + TEAMS.length) % TEAMS.length
    onChange(i)
  }

  return (
    <div className="w-full max-w-[300px] rounded-2xl border border-white/12 bg-white/[0.05] p-4 backdrop-blur-sm transition hover:border-white/20">
      <div className={`mb-2 text-center text-[10px] font-extrabold uppercase tracking-[0.25em] ${accentText}`}>
        {label}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => step(-1)}
          aria-label="Equipo anterior"
          className="rounded-full bg-white/8 p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
          {/* escudo */}
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-white/30 text-sm font-black text-black shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${team.kit.shirt} 55%, ${team.kit.shorts} 55%)`,
            }}
          >
            {team.short}
          </div>
          <div className="text-sm font-extrabold uppercase leading-tight tracking-wide">{team.name}</div>
          <div className="flex gap-0.5" title={`Rating ${team.rating}`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={i < stars ? 'text-amber-300' : 'text-white/20'}>
                ★
              </span>
            ))}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">
            General {team.rating}
          </div>
        </div>
        <button
          onClick={() => step(1)}
          aria-label="Equipo siguiente"
          className="rounded-full bg-white/8 p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white active:scale-95"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      {/* colores del kit */}
      <div className="mt-3 flex justify-center gap-1.5">
        {[team.kit.shirt, team.kit.shorts, team.kit.socks, team.kit.gk].map((c, i) => (
          <span key={i} className="h-2.5 w-6 rounded-full border border-white/20" style={{ background: c }} />
        ))}
      </div>
    </div>
  )
}
