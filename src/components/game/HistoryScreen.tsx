'use client'

import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface MatchRow {
  id: string
  homeTeam: string
  awayTeam: string
  homeGoals: number
  awayGoals: number
  difficulty: string
  possessionHome: number
  createdAt: string
}

const DIFF_STYLE: Record<string, string> = {
  amateur: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200',
  profesional: 'border-amber-300/30 bg-amber-400/10 text-amber-200',
  leyenda: 'border-rose-300/30 bg-rose-400/10 text-rose-200',
}

export default function HistoryScreen({ onBack }: { onBack: () => void }) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/matches?limit=25')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (alive) setMatches(data.matches as MatchRow[])
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-950 text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 75% 45% at 50% 0%, rgba(29,128,56,0.3), transparent 55%), linear-gradient(#05070b, #0a1410 65%, #06090c)',
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
        <h1 className="text-lg font-black italic uppercase tracking-tighter text-amber-300">
          Historial de partidos
        </h1>
        <div className="w-20" />
      </header>

      <main className="relative z-10 mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        {error && (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-6 text-center text-sm font-bold text-rose-200">
            No se pudo conectar con el servidor. Intentá de nuevo más tarde.
          </div>
        )}
        {!error && matches === null && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl bg-white/8" />
            ))}
          </div>
        )}
        {!error && matches !== null && matches.length === 0 && (
          <div className="rounded-xl border border-white/12 bg-white/[0.04] p-10 text-center">
            <p className="text-base font-extrabold uppercase tracking-wide text-white/70">Aún no hay partidos</p>
            <p className="mt-1.5 text-sm text-white/45">
              Jugá tu primer partido y el resultado se guardará aquí automáticamente.
            </p>
          </div>
        )}
        {matches !== null && matches.length > 0 && (
          <div className="fp3d-scroll max-h-[70vh] space-y-2.5 overflow-y-auto pr-1">
            {matches.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-sm transition hover:border-white/20"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className={`shrink-0 text-sm font-extrabold ${m.homeGoals > m.awayGoals ? 'text-amber-300' : 'text-white/80'}`}>
                      {m.homeTeam}
                    </span>
                    <span className="shrink-0 rounded-lg bg-amber-400 px-2.5 py-0.5 font-mono text-sm font-black text-black">
                      {m.homeGoals} - {m.awayGoals}
                    </span>
                    <span className={`shrink-0 truncate text-sm font-extrabold ${m.awayGoals > m.homeGoals ? 'text-amber-300' : 'text-white/80'}`}>
                      {m.awayTeam}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-white/40">
                    Posesión {m.possessionHome}% ·{' '}
                    {new Date(m.createdAt).toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
                    DIFF_STYLE[m.difficulty] ?? DIFF_STYLE.profesional
                  }`}
                >
                  {m.difficulty}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
