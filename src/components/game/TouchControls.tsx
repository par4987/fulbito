'use client'

import { useEffect, useRef, useState } from 'react'
import type { InputManager } from '@/game/input'

interface Props {
  input: InputManager
}

/**
 * Controles táctiles: joystick virtual a la izquierda y botones de acción
 * a la derecha (pase, tiro con carga, pase alto, barrida, sprint, cambio).
 */
export default function TouchControls({ input }: Props) {
  const joyRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const joyId = useRef<number | null>(null)
  const [shootDown, setShootDown] = useState(false)

  useEffect(() => {
    const zone = joyRef.current
    const knob = knobRef.current
    if (!zone || !knob) return

    const setKnob = (dx: number, dy: number) => {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    }

    const onDown = (e: PointerEvent) => {
      if (joyId.current !== null) return
      joyId.current = e.pointerId
      zone.setPointerCapture(e.pointerId)
      move(e)
    }
    const move = (e: PointerEvent) => {
      if (joyId.current !== e.pointerId) return
      const rect = zone.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      let dx = e.clientX - cx
      let dy = e.clientY - cy
      const max = rect.width / 2 - 18
      const len = Math.hypot(dx, dy)
      if (len > max) {
        dx = (dx / len) * max
        dy = (dy / len) * max
      }
      setKnob(dx, dy)
      input.setVirtualMove(dx / max, -dy / max)
    }
    const onUp = (e: PointerEvent) => {
      if (joyId.current !== e.pointerId) return
      joyId.current = null
      setKnob(0, 0)
      input.setVirtualMove(0, 0)
    }
    zone.addEventListener('pointerdown', onDown)
    zone.addEventListener('pointermove', move)
    zone.addEventListener('pointerup', onUp)
    zone.addEventListener('pointercancel', onUp)
    return () => {
      zone.removeEventListener('pointerdown', onDown)
      zone.removeEventListener('pointermove', move)
      zone.removeEventListener('pointerup', onUp)
      zone.removeEventListener('pointercancel', onUp)
    }
  }, [input])

  const btn =
    'fp3d-no-select flex items-center justify-center rounded-full font-extrabold tracking-wide text-white shadow-lg border border-white/25 backdrop-blur-sm active:scale-95 transition-transform'

  const holdBtn = (label: string, cls: string, onDown: () => void, onUp: () => void) => (
    <button
      className={`${btn} ${cls}`}
      onPointerDown={(e) => {
        e.preventDefault()
        onDown()
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )

  return (
    <div className="pointer-events-none absolute inset-0 z-30 md:hidden">
      {/* joystick */}
      <div
        ref={joyRef}
        className="fp3d-no-select pointer-events-auto absolute bottom-6 left-5 h-32 w-32 rounded-full border-2 border-white/20 bg-white/5 backdrop-blur-sm"
      >
        <div
          ref={knobRef}
          className="pointer-events-none absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-white/25 shadow-inner"
        />
      </div>

      {/* acciones */}
      <div className="pointer-events-auto absolute bottom-5 right-4 grid grid-cols-3 gap-2.5">
        {holdBtn(
          'CAMB',
          'h-12 w-12 text-[11px] bg-zinc-800/80',
          () => input.setVirtualButton('switch', true),
          () => input.setVirtualButton('switch', false),
        )}
        {holdBtn(
          'BARR',
          'h-12 w-12 text-[11px] bg-rose-700/80',
          () => input.setVirtualButton('shoot', true),
          () => input.setVirtualButton('shoot', false),
        )}
        {holdBtn(
          'SPRNT',
          'h-12 w-12 text-[10px] bg-emerald-700/80',
          () => input.setVirtualSprint(true),
          () => input.setVirtualSprint(false),
        )}
        {holdBtn(
          'ALTO',
          'h-14 w-14 text-xs bg-amber-600/85',
          () => input.setVirtualButton('lob', true),
          () => input.setVirtualButton('lob', false),
        )}
        {holdBtn(
          'PASE',
          'h-14 w-14 text-xs bg-teal-700/85',
          () => input.setVirtualButton('pass', true),
          () => input.setVirtualButton('pass', false),
        )}
        <button
          className={`${btn} h-16 w-16 text-sm ${shootDown ? 'bg-rose-500 scale-105' : 'bg-rose-600/90'}`}
          onPointerDown={(e) => {
            e.preventDefault()
            setShootDown(true)
            input.setVirtualButton('shoot', true)
          }}
          onPointerUp={() => {
            setShootDown(false)
            input.setVirtualButton('shoot', false)
          }}
          onPointerLeave={() => {
            setShootDown(false)
            input.setVirtualButton('shoot', false)
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          TIRO
        </button>
      </div>
    </div>
  )
}
