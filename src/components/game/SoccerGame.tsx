'use client'

import { useEffect, useState } from 'react'
import HistoryScreen from '@/components/game/HistoryScreen'
import MatchScreen from '@/components/game/MatchScreen'
import MenuScreen from '@/components/game/MenuScreen'
import TeamSelect from '@/components/game/TeamSelect'
import type { Difficulty, MatchSettings } from '@/game/types'

type Screen = 'menu' | 'select' | 'history' | 'match'
type AppSettings = MatchSettings & { muted: boolean }

const STORAGE_KEY = 'fp3d-settings'

const DEFAULT_SETTINGS: AppSettings = {
  difficulty: 'profesional',
  durationMin: 5,
  muted: false,
}

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const diff: Difficulty =
      parsed.difficulty === 'amateur' || parsed.difficulty === 'leyenda' ? parsed.difficulty : 'profesional'
    return {
      difficulty: diff,
      durationMin: [3, 5, 8].includes(parsed.durationMin as number) ? (parsed.durationMin as number) : 5,
      muted: Boolean(parsed.muted),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export default function SoccerGame() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [pair, setPair] = useState({ homeId: 'condor', awayId: 'cumbre' })
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // cargar ajustes persistidos después del montaje (evita mismatch de hidratación)
    const id = requestAnimationFrame(() => {
      setSettings(loadSettings())
      setHydrated(true)
    })
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* noop */
    }
  }, [settings, hydrated])

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="text-center">
          <div className="text-4xl font-black italic tracking-tighter text-amber-300">FÚTBOL PRO 3D</div>
          <div className="mt-2 h-1 w-40 mx-auto overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-amber-400" />
          </div>
        </div>
      </div>
    )
  }

  if (screen === 'match') {
    return (
      <MatchScreen
        key={`${pair.homeId}-${pair.awayId}`}
        homeId={pair.homeId}
        awayId={pair.awayId}
        settings={settings}
        onExit={() => setScreen('menu')}
      />
    )
  }

  if (screen === 'select') {
    return (
      <TeamSelect
        initialHome={pair.homeId}
        initialAway={pair.awayId}
        difficulty={settings.difficulty}
        onBack={() => setScreen('menu')}
        onStart={(homeId, awayId) => {
          setPair({ homeId, awayId })
          setScreen('match')
        }}
      />
    )
  }

  if (screen === 'history') {
    return <HistoryScreen onBack={() => setScreen('menu')} />
  }

  return (
    <MenuScreen
      settings={settings}
      onChange={setSettings}
      onQuickMatch={() => setScreen('select')}
      onHistory={() => setScreen('history')}
    />
  )
}
