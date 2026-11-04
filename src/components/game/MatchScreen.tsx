'use client'

import {
  Camera,
  Home,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import TouchControls from '@/components/game/TouchControls'
import { Button } from '@/components/ui/button'
import { GameEngine } from '@/game/engine'
import { TEAMS } from '@/game/teams'
import type { Difficulty, FullTimeResult, HudState, MatchSettings, SubResult, SubState } from '@/game/types'

interface Props {
  homeId: string
  awayId: string
  settings: MatchSettings & { muted: boolean }
  onExit: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function MatchScreen({ homeId, awayId, settings, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const radarRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const [hud, setHud] = useState<HudState | null>(null)
  const [result, setResult] = useState<FullTimeResult | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(settings.muted)
  const [isTouch, setIsTouch] = useState(false)
  const [isFull, setIsFull] = useState(false)
  const [matchKey, setMatchKey] = useState(0)
  const [subsOpen, setSubsOpen] = useState(false)
  const [subState, setSubState] = useState<SubState | null>(null)

  const home = TEAMS.find((t) => t.id === homeId) ?? TEAMS[0]
  const away = TEAMS.find((t) => t.id === awayId) ?? TEAMS[1]

  const saveResult = useCallback(async (r: FullTimeResult) => {
    setSaveState('saving')
    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeTeam: r.home.name,
          awayTeam: r.away.name,
          homeGoals: r.score[0],
          awayGoals: r.score[1],
          difficulty: r.difficulty,
          durationSec: Math.round(r.durationSec),
          possessionHome: r.possession[0],
          shotsHome: r.shots[0],
          shotsAway: r.shots[1],
          shotsOnTargetHome: r.onTarget[0],
          shotsOnTargetAway: r.onTarget[1],
          foulsHome: r.fouls[0],
          foulsAway: r.fouls[1],
          yellowsHome: r.yellows[0],
          yellowsAway: r.yellows[1],
          redsHome: r.reds[0],
          redsAway: r.reds[1],
          events: JSON.stringify(r.events.map((e) => `${e.minute}' — ${e.text}`)),
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const radar = radarRef.current
    if (!container || !radar) return

    const demo =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1'

    const engine = new GameEngine(container, radar)
    engineRef.current = engine
    engine.onHud = (h) => {
      setHud(h)
      setPaused(engine.isPaused)
    }
    engine.onFinish = (r) => {
      setResult(r)
      void saveResult(r)
    }
    engine.audio.setMuted(settings.muted)
    engine.startMatch({
      homeTeamId: homeId,
      awayTeamId: awayId,
      settings: { difficulty: settings.difficulty, durationMin: demo ? 0.4 : settings.durationMin },
    })

    const unlock = () => engine.audio.ensure()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    // exposición para pruebas E2E (no afecta al juego)
    ;(window as unknown as Record<string, unknown>).__fp3d = engine
    setIsTouch(
      window.matchMedia('(pointer: coarse)').matches ||
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.innerWidth < 768,
    )

    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [matchKey])

  const togglePause = () => {
    const e = engineRef.current
    if (!e) return
    e.togglePause()
    setPaused(e.isPaused)
  }

  const cycleCamera = () => engineRef.current?.cycleCamera()
  const toggleMute = () => {
    const e = engineRef.current
    if (!e) return
    setMuted(e.toggleMute())
  }
  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void document.documentElement.requestFullscreen()
      setIsFull(!document.fullscreenElement)
    } catch {
      /* noop */
    }
  }

  const rematch = () => {
    setResult(null)
    setSaveState('idle')
    setSubsOpen(false)
    setMatchKey((k) => k + 1)
  }

  const openSubs = () => {
    setSubState(engineRef.current?.getSubState(0) ?? null)
    setSubsOpen(true)
  }

  const confirmSub = useCallback((outIdx: number, benchIdx: number): SubResult => {
    const r = engineRef.current?.makeSub(0, outIdx, benchIdx) ?? 'invalido'
    setSubState(engineRef.current?.getSubState(0) ?? null)
    return r
  }, [])

  return (
    <div className="fp3d-no-select fixed inset-0 z-50 overflow-hidden bg-black">
      {/* lienzo 3D */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* radar */}
      <div className="absolute right-2 top-2 z-20 rounded-lg border border-white/15 bg-black/45 p-1.5 backdrop-blur-sm sm:right-3 sm:top-3">
        <canvas ref={radarRef} width={360} height={248} className="h-[86px] w-[125px] sm:h-[124px] sm:w-[180px]" />
      </div>

      {/* marcador broadcast */}
      {hud && (
        <div className="absolute left-2 top-2 z-20 sm:left-3 sm:top-3">
          <div className="flex items-stretch overflow-hidden rounded-lg border border-white/15 bg-black/60 text-white shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3">
              <span className="h-3 w-3 rounded-full" style={{ background: home.kit.shirt }} />
              <span className="text-xs font-extrabold tracking-wider sm:text-sm">{home.short}</span>
            </div>
            <div className="flex items-center gap-1 bg-amber-400/90 px-2.5 py-1.5 font-mono text-sm font-black text-black sm:px-3 sm:text-base">
              <span>{hud.score[0]}</span>
              <span className="opacity-60">-</span>
              <span>{hud.score[1]}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3">
              <span className="text-xs font-extrabold tracking-wider sm:text-sm">{away.short}</span>
              <span className="h-3 w-3 rounded-full" style={{ background: away.kit.shirt }} />
            </div>
            <div className="flex items-center border-l border-white/15 px-2.5 py-1.5 font-mono text-xs sm:px-3 sm:text-sm">
              {hud.minute}&apos;
              <span className="ml-1.5 rounded bg-white/15 px-1 text-[10px] font-bold">{hud.half}T</span>
            </div>
          </div>
          {/* barra de posesión */}
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-white/80">
            <span className="w-7 text-right">{hud.possession[0]}%</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/15 sm:w-36">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${hud.possession[0]}%` }} />
            </div>
            <span>{hud.possession[1]}%</span>
          </div>
        </div>
      )}

      {/* botones de sistema */}
      <div className="absolute right-2 top-[calc(0.5rem+110px)] z-20 flex flex-col gap-1.5 sm:right-3 sm:top-[calc(0.75rem+148px)]">
        <HudBtn onClick={togglePause} label={paused ? 'Reanudar' : 'Pausa'}>
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </HudBtn>
        <HudBtn onClick={cycleCamera} label="Cámara (V)">
          <Camera className="h-4 w-4" />
        </HudBtn>
        <div className="flex gap-1.5">
          <HudBtn onClick={() => engineRef.current?.zoomIn()} label="Acercar cámara (+)">
            <ZoomIn className="h-4 w-4" />
          </HudBtn>
          <HudBtn onClick={() => engineRef.current?.zoomOut()} label="Alejar cámara (-)">
            <ZoomOut className="h-4 w-4" />
          </HudBtn>
        </div>
        <HudBtn onClick={toggleMute} label={muted ? 'Activar sonido' : 'Silenciar'}>
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </HudBtn>
        <HudBtn onClick={toggleFullscreen} label="Pantalla completa" className="hidden sm:flex">
          {isFull ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </HudBtn>
      </div>

      {/* ticker de eventos */}
      {hud && hud.events.length > 0 && (
        <div className="absolute bottom-3 left-3 z-20 hidden max-w-xs flex-col gap-1 sm:flex">
          {hud.events.slice(-3).reverse().map((ev, i) => (
            <div
              key={`${ev.minute}-${i}-${ev.text}`}
              className={`fp3d-fade-up rounded-md border px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${
                ev.kind === 'goal'
                  ? 'border-amber-300/40 bg-amber-400/25 text-amber-100'
                  : ev.kind === 'chance'
                    ? 'border-teal-300/30 bg-teal-500/20 text-teal-50'
                    : 'border-white/15 bg-black/45 text-white/85'
              }`}
              style={{ opacity: 1 - i * 0.3 }}
            >
              <span className="mr-1.5 font-mono text-white/60">{ev.minute}&apos;</span>
              {ev.text}
            </div>
          ))}
        </div>
      )}

      {/* jugador controlado */}
      {hud?.controlled && !result && (
        <div className="absolute bottom-3 right-3 z-20 hidden items-center gap-2 rounded-lg border border-white/15 bg-black/55 px-3 py-1.5 text-white backdrop-blur-sm sm:flex">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-xs font-black text-black">
            {hud.controlled.num}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-xs font-extrabold uppercase tracking-wide">{hud.controlled.name}</div>
              {hud.controlled.stamina < 25 && (
                <span className="animate-pulse text-[9px] font-black uppercase tracking-widest text-rose-400">
                  Cansado
                </span>
              )}
            </div>
            <div className="mt-0.5 h-1 w-20 overflow-hidden rounded-full bg-white/15">
              <div
                className={`h-full rounded-full ${
                  hud.controlled.stamina > 55
                    ? 'bg-emerald-400'
                    : hud.controlled.stamina > 25
                      ? 'bg-amber-400'
                      : 'bg-rose-400'
                }`}
                style={{ width: `${hud.controlled.stamina}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* barra de potencia del disparo */}
      <PowerBar engineRef={engineRef} />

      {/* controles táctiles */}
      {isTouch && engineRef.current && !result && !paused && (
        <TouchControls input={engineRef.current.input} />
      )}

      {/* overlay de gol */}
      {hud?.phase === 'goal' && hud.goalOverlay && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="fp3d-goal-pop text-center">
            <div
              className="text-6xl font-black italic tracking-tighter text-amber-300 drop-shadow-[0_4px_18px_rgba(0,0,0,0.9)] sm:text-8xl"
              style={{ WebkitTextStroke: '2px rgba(0,0,0,0.45)' }}
            >
              ¡GOOOL!
            </div>
            <div className="mt-2 inline-block rounded-lg bg-black/70 px-4 py-1.5 text-base font-extrabold uppercase tracking-wider text-white sm:text-xl">
              {hud.goalOverlay.scorer} · {hud.goalOverlay.team === 0 ? home.short : away.short}
            </div>
          </div>
        </div>
      )}

      {/* overlay de tarjeta (amarilla / roja) */}
      {hud?.cardOverlay && !result && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-40 -translate-x-1/2 sm:top-20">
          <div className="fp3d-fade-up flex items-center gap-3 rounded-xl border border-white/15 bg-black/80 px-4 py-2.5 shadow-xl backdrop-blur-sm">
            <span
              className={`h-10 w-7 shrink-0 rounded-[4px] border border-black/30 ${
                hud.cardOverlay.kind === 'amarilla' ? 'bg-amber-300' : 'bg-rose-500'
              }`}
            />
            <div className="text-white">
              <div
                className={`text-sm font-black uppercase tracking-wider ${
                  hud.cardOverlay.kind === 'amarilla' ? 'text-amber-300' : 'text-rose-400'
                }`}
              >
                {hud.cardOverlay.kind === 'amarilla' ? 'Tarjeta amarilla' : '¡Tarjeta roja! Expulsado'}
              </div>
              <div className="text-xs font-bold text-white/75">
                {hud.cardOverlay.player} · {hud.cardOverlay.team === 0 ? home.short : away.short}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* banner de tiro libre / penal */}
      {hud?.setPiece && (hud.phase === 'freekick' || hud.phase === 'penalty') && !result && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 text-center sm:top-3">
          <div
            className={`rounded-lg px-4 py-1.5 text-base font-black italic uppercase tracking-wider shadow-lg sm:text-xl ${
              hud.setPiece.type === 'penalty'
                ? 'bg-rose-600/90 text-white'
                : 'bg-black/70 text-amber-300'
            }`}
          >
            {hud.setPiece.type === 'penalty'
              ? `¡Penal ${hud.setPiece.team === 0 ? 'para vos' : `para ${away.short}!`}`
              : `Tiro libre ${hud.setPiece.team === 0 ? 'para vos' : `de ${away.short}`}`}
          </div>
          {hud.setPiece.team === 0 && (
            <div className="mt-1 inline-block rounded bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white/80 sm:text-[11px]">
              Z: cargar y soltar para disparar · X: pase · C: centro
            </div>
          )}
        </div>
      )}

      {/* overlay de mediempo */}
      {hud?.phase === 'half' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="fp3d-fade-up text-center text-white">
            <div className="text-4xl font-black italic tracking-tight text-amber-300 sm:text-6xl">MEDIEMPO</div>
            <div className="mt-2 text-sm font-bold uppercase tracking-widest text-white/75">
              {home.short} {hud.score[0]} — {hud.score[1]} {away.short}
            </div>
          </div>
        </div>
      )}

      {/* overlay de pausa */}
      {paused && !result && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm">
          {subsOpen ? (
            <SubsPanel state={subState} onConfirm={confirmSub} onClose={() => setSubsOpen(false)} />
          ) : (
            <div className="fp3d-fade-up w-[min(92vw,380px)] rounded-2xl border border-white/12 bg-zinc-950/90 p-6 text-white shadow-2xl">
              <h2 className="text-center text-2xl font-black italic uppercase tracking-tight text-amber-300">Pausa</h2>
              <div className="mt-5 flex flex-col gap-2.5">
                <Button onClick={togglePause} className="h-11 bg-amber-400 font-extrabold text-black hover:bg-amber-300">
                  <Play className="mr-2 h-4 w-4" /> Reanudar
                </Button>
                <Button
                  onClick={cycleCamera}
                  variant="outline"
                  className="h-11 border-white/20 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"
                >
                  <Camera className="mr-2 h-4 w-4" /> Cámara: {cameraLabel(hud?.cameraMode)}
                </Button>
                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    onClick={() => engineRef.current?.zoomIn()}
                    variant="outline"
                    className="h-11 border-white/20 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"
                  >
                    <ZoomIn className="mr-1.5 h-4 w-4" /> Acercar
                  </Button>
                  <Button
                    onClick={() => engineRef.current?.zoomOut()}
                    variant="outline"
                    className="h-11 border-white/20 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"
                  >
                    <ZoomOut className="mr-1.5 h-4 w-4" /> Alejar
                  </Button>
                </div>
                <Button
                  onClick={openSubs}
                  variant="outline"
                  className="h-11 border-white/20 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"
                >
                  <Repeat className="mr-2 h-4 w-4" /> Hacer cambios
                </Button>
                <Button
                  onClick={toggleMute}
                  variant="outline"
                  className="h-11 border-white/20 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"
                >
                  {muted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}
                  {muted ? 'Sonido: apagado' : 'Sonido: encendido'}
                </Button>
                <Button
                  onClick={onExit}
                  variant="outline"
                  className="h-11 border-rose-400/40 bg-rose-500/10 font-bold text-rose-200 hover:bg-rose-500/20 hover:text-rose-100"
                >
                  <Home className="mr-2 h-4 w-4" /> Salir al menú
                </Button>
              </div>
              <p className="mt-3 text-center text-[10px] text-white/40">
                Zoom con la rueda del ratón o las teclas + / -
              </p>
            </div>
          )}
        </div>
      )}

      {/* overlay final del partido */}
      {result && (
        <FullTimePanel
          result={result}
          saveState={saveState}
          onRematch={rematch}
          onExit={onExit}
        />
      )}
    </div>
  )
}

function cameraLabel(mode?: string) {
  if (mode === 'cable') return 'Cable (muy cerca)'
  if (mode === 'cerca') return 'TV cercana'
  if (mode === 'aerea') return 'aérea'
  if (mode === 'arco') return 'tras el arco'
  return 'TV (broadcast)'
}

function HudBtn({
  children,
  onClick,
  label,
  className = 'flex',
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`${className} h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70 active:scale-95 sm:h-9 sm:w-9`}
    >
      {children}
    </button>
  )
}

/** Panel de cambios: elige titular que sale + suplente que entra (máx. 5 por equipo). */
function SubsPanel({
  state,
  onConfirm,
  onClose,
}: {
  state: SubState | null
  onConfirm: (outIdx: number, benchIdx: number) => SubResult
  onClose: () => void
}) {
  // el panel solo se muestra en pausa (simulación congelada); el estado lo trae el padre
  const [outIdx, setOutIdx] = useState<number | null>(null)
  const [benchIdx, setBenchIdx] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  if (!state) {
    return (
      <div className="fp3d-fade-up rounded-2xl border border-white/12 bg-zinc-950/90 p-6 text-white shadow-2xl">
        Cargando plantilla…
      </div>
    )
  }

  const outPlayer = state.onField.find((p) => p.idx === outIdx) ?? null
  const benchPlayer = state.bench.find((b) => b.idx === benchIdx) ?? null
  const remaining = state.max - state.used
  const compatible = !outPlayer || !benchPlayer || outPlayer.gk === (benchPlayer.role === 'GK')
  const canConfirm = outPlayer && benchPlayer && compatible && remaining > 0

  const confirm = () => {
    if (outIdx === null || benchIdx === null) return
    const r = onConfirm(outIdx, benchIdx)
    if (r === 'ok') {
      setMsg('Cambio realizado ✓')
      setOutIdx(null)
      setBenchIdx(null)
    } else if (r === 'limite') {
      setMsg('No quedan cambios disponibles')
    } else {
      setMsg('Cambio inválido (revisá las posiciones)')
    }
  }

  return (
    <div className="fp3d-fade-up w-[min(94vw,600px)] rounded-2xl border border-white/12 bg-zinc-950/95 p-4 text-white shadow-2xl sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black italic uppercase tracking-tight text-amber-300">Cambios</h2>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold">
          Restan <b className={remaining > 0 ? 'text-emerald-400' : 'text-rose-400'}>{remaining}</b> de {state.max}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-white/45">
        Elegí quién sale y quién entra. El suplente entra fresco (resistencia 100). Tenés 12 suplentes y 5 cambios.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* titulares en cancha */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45">En cancha (sale)</div>
          <div className="fp3d-scroll max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-1.5 sm:max-h-64">
            {state.onField.map((p) => {
              const sel = p.idx === outIdx
              const off = p.sentOff
              return (
                <button
                  key={p.idx}
                  disabled={off}
                  onClick={() => setOutIdx(sel ? null : p.idx)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                    off
                      ? 'cursor-not-allowed opacity-40'
                      : sel
                        ? 'bg-amber-400/20 ring-1 ring-amber-300'
                        : 'hover:bg-white/5'
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/12 text-[10px] font-black">
                    {p.num}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold">{p.name}</span>
                      {off && (
                        <span className="shrink-0 rounded bg-rose-500/25 px-1 text-[8px] font-black uppercase text-rose-300">
                          expulsado
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <span
                        className={`block h-full rounded-full ${
                          p.stamina > 55 ? 'bg-emerald-400' : p.stamina > 25 ? 'bg-amber-400' : 'bg-rose-400'
                        }`}
                        style={{ width: `${p.stamina}%` }}
                      />
                    </span>
                  </span>
                  <span className="shrink-0 text-[9px] font-bold uppercase text-white/40">{roleLabel(p.role)}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* banco */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/45">Suplentes (entra)</div>
          <div className="fp3d-scroll max-h-56 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-1.5 sm:max-h-64">
            {state.bench.map((b) => {
              const sel = b.idx === benchIdx
              const disabled = !b.available
              return (
                <button
                  key={b.idx}
                  disabled={disabled}
                  onClick={() => setBenchIdx(sel ? null : b.idx)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                    disabled
                      ? 'cursor-not-allowed opacity-35'
                      : sel
                        ? 'bg-emerald-400/20 ring-1 ring-emerald-300'
                        : 'hover:bg-white/5'
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/25 text-[10px] font-black">
                    {b.num}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-bold">{b.name}</span>
                  <span className="shrink-0 text-[9px] font-bold uppercase text-white/40">{roleLabel(b.role)}</span>
                  {disabled && <span className="text-[9px] font-bold text-rose-300">usado</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-xs font-semibold">
          {msg ? (
            <span className="text-emerald-300">{msg}</span>
          ) : outPlayer && benchPlayer && !compatible ? (
            <span className="text-rose-300">El portero solo puede ser reemplazado por otro portero</span>
          ) : outPlayer || benchPlayer ? (
            <span className="text-white/60">
              {outPlayer ? `Sale ${outPlayer.name}` : 'Elegí quién sale'} ·{' '}
              {benchPlayer ? `entra ${benchPlayer.name}` : 'elegí quién entra'}
            </span>
          ) : (
            <span className="text-white/35">Seleccioná un jugador de cada lista</span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            onClick={onClose}
            variant="outline"
            className="h-10 border-white/20 bg-white/5 px-4 font-bold text-white hover:bg-white/10 hover:text-white"
          >
            <X className="mr-1.5 h-4 w-4" /> Volver
          </Button>
          <Button
            onClick={confirm}
            disabled={!canConfirm}
            className="h-10 bg-amber-400 px-4 font-extrabold text-black hover:bg-amber-300 disabled:opacity-40"
          >
            <Repeat className="mr-1.5 h-4 w-4" /> Confirmar
          </Button>
        </div>
      </div>
    </div>
  )
}

function roleLabel(role: string): string {
  if (role === 'GK') return 'ARQ'
  if (role === 'DF') return 'DEF'
  if (role === 'MF') return 'MED'
  return 'DEL'
}

/** Barra de potencia que se actualiza cada frame vía rAF. */
function PowerBar({ engineRef }: { engineRef: React.RefObject<GameEngine | null> }) {
  const ref = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const e = engineRef.current
      const wrap = wrapRef.current
      const bar = ref.current
      if (!e || !wrap || !bar) return
      if (e.isCharging && e.charge > 0.02) {
        wrap.style.opacity = '1'
        bar.style.width = `${Math.round(e.charge * 100)}%`
        bar.style.background = e.charge > 0.8 ? '#f43f5e' : e.charge > 0.5 ? '#fb923c' : '#34d399'
      } else {
        wrap.style.opacity = '0'
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engineRef])
  return (
    <div
      ref={wrapRef}
      className="pointer-events-none absolute bottom-6 left-1/2 z-20 hidden -translate-x-1/2 rounded-full border border-white/20 bg-black/55 p-1 opacity-0 transition-opacity sm:block"
    >
      <div className="h-2.5 w-52 overflow-hidden rounded-full bg-white/10">
        <div ref={ref} className="h-full w-0 rounded-full bg-emerald-400 transition-[width] duration-75" />
      </div>
    </div>
  )
}

/** Panel de resultado final con estadísticas y eventos. */
function FullTimePanel({
  result,
  saveState,
  onRematch,
  onExit,
}: {
  result: FullTimeResult
  saveState: SaveState
  onRematch: () => void
  onExit: () => void
}) {
  const [h, a] = [result.home, result.away]
  const won = result.score[0] > result.score[1]
  const drew = result.score[0] === result.score[1]
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="fp3d-fade-up fp3d-scroll max-h-[92vh] w-[min(94vw,560px)] overflow-y-auto rounded-2xl border border-white/12 bg-zinc-950/95 p-5 text-white shadow-2xl sm:p-7">
        <div className="text-center text-xs font-bold uppercase tracking-[0.25em] text-white/50">Final del partido</div>
        <div className="mt-3 flex items-center justify-center gap-4">
          <TeamBadge short={h.short} name={h.name} color={h.kit.shirt} />
          <div className="rounded-xl bg-amber-400 px-5 py-2 font-mono text-3xl font-black text-black sm:text-4xl">
            {result.score[0]} - {result.score[1]}
          </div>
          <TeamBadge short={a.short} name={a.name} color={a.kit.shirt} />
        </div>
        <div className="mt-2 text-center text-sm font-extrabold uppercase tracking-wider text-amber-300">
          {won ? '¡Victoria!' : drew ? 'Emparejado' : 'Derrota'}
        </div>

        {/* estadísticas */}
        <div className="mt-5 space-y-2.5">
          <StatBar label="Posesión" hv={result.possession[0]} av={result.possession[1]} suffix="%" />
          <StatBar label="Tiros" hv={result.shots[0]} av={result.shots[1]} />
          <StatBar label="Tiros al arco" hv={result.onTarget[0]} av={result.onTarget[1]} />
          <StatBar label="Faltas" hv={result.fouls[0]} av={result.fouls[1]} />
          <StatBar label="Amarillas" hv={result.yellows[0]} av={result.yellows[1]} />
          <StatBar label="Rojas" hv={result.reds[0]} av={result.reds[1]} />
        </div>

        {/* eventos */}
        <div className="mt-5">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/45">Narración</div>
          <div className="fp3d-scroll max-h-36 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            {result.events.map((e, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="w-8 shrink-0 font-mono text-white/45">{e.minute}&apos;</span>
                <span className={e.kind === 'goal' ? 'font-bold text-amber-300' : 'text-white/75'}>{e.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 text-center text-[11px] text-white/40">
          {saveState === 'saving' && 'Guardando resultado…'}
          {saveState === 'saved' && 'Resultado guardado en el historial ✓'}
          {saveState === 'error' && 'No se pudo guardar en el historial'}
        </div>

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          <Button
            onClick={onRematch}
            className="h-11 flex-1 bg-amber-400 font-extrabold text-black hover:bg-amber-300"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Revancha
          </Button>
          <Button
            onClick={onExit}
            variant="outline"
            className="h-11 flex-1 border-white/20 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"
          >
            <Home className="mr-2 h-4 w-4" /> Menú principal
          </Button>
        </div>
      </div>
    </div>
  )
}

function TeamBadge({ short, name, color }: { short: string; name: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/25 text-xs font-black"
        style={{ background: color, color: '#111' }}
      >
        {short}
      </span>
      <span className="max-w-[90px] truncate text-[10px] font-bold uppercase tracking-wide text-white/60 sm:max-w-[120px] sm:text-xs">
        {name}
      </span>
    </div>
  )
}

function StatBar({ label, hv, av, suffix = '' }: { label: string; hv: number; av: number; suffix?: string }) {
  const tot = Math.max(1, hv + av)
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-bold">
        <span className="text-white/85">
          {hv}
          {suffix}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</span>
        <span className="text-white/85">
          {av}
          {suffix}
        </span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-amber-400" style={{ width: `${(hv / tot) * 100}%` }} />
        <div className="h-full flex-1 bg-rose-400/80" />
      </div>
    </div>
  )
}
