'use client'

import { Gamepad2, History, Play, Timer, Trophy, Volume2, VolumeX, Zap } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import type { Difficulty, MatchSettings } from '@/game/types'

interface Props {
  settings: MatchSettings & { muted: boolean }
  onChange: (s: MatchSettings & { muted: boolean }) => void
  onQuickMatch: () => void
  onHistory: () => void
}

const DIFF_LABEL: Record<Difficulty, string> = {
  amateur: 'Amateur',
  profesional: 'Profesional',
  leyenda: 'Leyenda',
}

export default function MenuScreen({ settings, onChange, onQuickMatch, onHistory }: Props) {
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-zinc-950 text-white">
      {/* fondo estadio */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 50% -5%, rgba(29,128,56,0.4), transparent 60%), radial-gradient(ellipse 60% 45% at 85% 110%, rgba(201,162,39,0.18), transparent 60%), linear-gradient(#05070b, #0a1410 60%, #06090c)',
        }}
      />
      {/* líneas de cancha decorativas */}
      <div className="fp3d-pitch-glow pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[980px] -translate-x-1/2 -translate-y-1/2 rounded-[3rem] border border-emerald-400/15 opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[490px] -translate-x-1/2 -translate-y-1/2 border-l border-emerald-400/10" />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-10">
        {/* título */}
        <div className="fp3d-fade-up text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/10 px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.28em] text-amber-300">
            <Zap className="h-3 w-3" /> Edición Estadio · 3D
          </div>
          <h1
            className="text-5xl font-black italic leading-none tracking-tighter sm:text-7xl"
            style={{ textShadow: '0 6px 30px rgba(232,200,50,0.25)' }}
          >
            FÚTBOL <span className="text-amber-300">PRO</span> 3D
          </h1>
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.3em] text-white/50">
            Liga Nocturna · 11 vs 11
          </p>
        </div>

        {/* botones principales */}
        <div className="fp3d-fade-up mt-10 grid w-full max-w-md gap-3" style={{ animationDelay: '0.15s' }}>
          <button
            onClick={onQuickMatch}
            className="group flex items-center justify-between rounded-xl border border-amber-300/40 bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-4 text-left font-black uppercase tracking-wide text-black shadow-[0_10px_30px_rgba(232,200,50,0.25)] transition hover:scale-[1.02] hover:from-amber-300 hover:to-amber-400 active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <Play className="h-5 w-5 fill-black" /> Partido rápido
            </span>
            <span className="text-xs font-bold opacity-70 transition group-hover:translate-x-1">Elegir equipos →</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <MenuCard icon={<History className="h-5 w-5 text-amber-300" />} title="Historial" desc="Últimos resultados" onClick={onHistory} />
            <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
              <DialogTrigger asChild>
                <button className="flex h-full flex-col justify-center gap-1 rounded-xl border border-white/12 bg-white/[0.05] px-4 py-4 text-left backdrop-blur-sm transition hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.99]">
                  <span className="flex items-center gap-2.5 text-sm font-extrabold uppercase tracking-wide">
                    <Gamepad2 className="h-5 w-5 text-amber-300" /> Cómo jugar
                  </span>
                  <span className="text-xs text-white/50">Controles y consejos</span>
                </button>
              </DialogTrigger>
              <DialogContent className="border-white/15 bg-zinc-950 text-white sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-lg font-black italic uppercase tracking-tight text-amber-300">
                    <Trophy className="h-5 w-5" /> Controles
                  </DialogTitle>
                </DialogHeader>
                <ControlsTable />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* ajustes */}
        <div className="fp3d-fade-up mt-8 w-full max-w-md rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm" style={{ animationDelay: '0.3s' }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45">
                <Trophy className="h-3 w-3" /> Dificultad
              </div>
              <div className="flex overflow-hidden rounded-lg border border-white/15">
                {(Object.keys(DIFF_LABEL) as Difficulty[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => onChange({ ...settings, difficulty: d })}
                    className={`flex-1 whitespace-nowrap px-0.5 py-1.5 text-[10px] font-extrabold transition ${
                      settings.difficulty === d ? 'bg-amber-400 text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    {d === 'amateur' ? 'Fácil' : d === 'profesional' ? 'Pro' : 'Leyenda'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45">
                <Timer className="h-3 w-3" /> Duración
              </div>
              <div className="flex overflow-hidden rounded-lg border border-white/15">
                {[3, 5, 8].map((m) => (
                  <button
                    key={m}
                    onClick={() => onChange({ ...settings, durationMin: m })}
                    className={`flex-1 px-1 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition ${
                      settings.durationMin === m ? 'bg-amber-400 text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45">
                {settings.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />} Sonido
              </div>
              <div className="flex h-[30px] items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5">
                <Switch
                  checked={!settings.muted}
                  onCheckedChange={(v) => onChange({ ...settings, muted: !v })}
                  aria-label="Activar sonido"
                />
                <span className="text-[11px] font-bold text-white/60">{settings.muted ? 'OFF' : 'ON'}</span>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-6 max-w-md text-center text-[11px] leading-relaxed text-white/35">
          Juego inspirado en los clásicos de fútbol de consola: estadio nocturno, cámara de TV,
          física de balón y CPU con distintas dificultades. Requiere teclado (o pantalla táctil).
        </p>
      </main>

      <footer className="relative z-10 pb-5 text-center text-[11px] text-white/30">
        Fútbol Pro 3D · construido con Next.js + Three.js · equipos ficticios
      </footer>
    </div>
  )
}

function MenuCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-full flex-col justify-center gap-1 rounded-xl border border-white/12 bg-white/[0.05] px-4 py-4 text-left backdrop-blur-sm transition hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.99]"
    >
      <span className="flex items-center gap-2.5 text-sm font-extrabold uppercase tracking-wide">
        {icon} {title}
      </span>
      <span className="text-xs text-white/50">{desc}</span>
    </button>
  )
}

export function ControlsTable() {
  const rows: Array<[string, string]> = [
    ['Mover', 'W A S D / Flechas'],
    ['Sprint', 'Shift'],
    ['Pase raso', 'X / Espacio'],
    ['Pase alto · centro', 'C'],
    ['Tiro (mantener = carga)', 'Z / Enter'],
    ['Entrar al quite (sin balón)', 'X'],
    ['Barrida (sin balón)', 'Z'],
    ['Cambiar jugador', 'E / C'],
    ['Cambiar cámara', 'V'],
    ['Zoom de cámara', '+ / - o rueda'],
    ['Pausa · cambios', 'P / Esc'],
  ]
  return (
    <div className="mt-1 space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between rounded-md bg-white/[0.05] px-3 py-2 text-sm">
          <span className="text-white/70">{k}</span>
          <kbd className="rounded border border-white/20 bg-black/40 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
            {v}
          </kbd>
        </div>
      ))}
      <p className="pt-2 text-xs leading-relaxed text-white/45">
        Consejo: mantén presionado <b className="text-amber-300">Z</b> cerca del arco para cargar la potencia del
        disparo, y usa <b className="text-amber-300">C</b> para centros al área. Con <b className="text-amber-300">V</b>{' '}
      ciclás entre cámara TV, TV cercana, aérea y tras el arco. En móvil verás joystick y botones táctiles.
      </p>
      <p className="text-xs leading-relaxed text-white/45">
        <b className="text-amber-300">Cansancio:</b> esprintar agota la resistencia y tus jugadores corren menos;
        en la pausa podés hacer hasta <b className="text-amber-300">3 cambios</b> para meter piernas frescas (la CPU
        también cambia a sus cansados). En el mediempo todos recuperan aire.
      </p>
    </div>
  )
}
