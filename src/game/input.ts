import { clamp } from './constants'

export type ActionButton = 'pass' | 'shoot' | 'lob' | 'tackle' | 'slide' | 'switch'

/**
 * Agregador de entrada: teclado (desktop) + virtual (táctil desde la UI).
 * - move: x derecha(+1), y arriba(+1) en coords de pantalla; el motor lo
 *   transforma a coordenadas de mundo según la cámara.
 * - Botones con detección de "recién presionado" (consume).
 * - shoot se mantiene presionado para cargar el disparo (el motor mide el tiempo).
 */
export class InputManager {
  move = { x: 0, y: 0 }
  sprint = false
  private keys = new Set<string>()
  private held = new Set<ActionButton>()
  private pressed = new Set<ActionButton>()
  private onPause: (() => void) | null = null
  private onCamera: (() => void) | null = null
  private attached = false

  private keyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (
      ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'].includes(k) ||
      ['w', 'a', 's', 'd', 'x', 'z', 'c', 'e', 'p', 'v'].includes(k)
    ) {
      e.preventDefault()
    }
    if (k === 'p' || k === 'escape') this.onPause?.()
    if (k === 'v') this.onCamera?.()
    this.keys.add(k)
    this.syncFromKeyboard()
  }

  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase())
    this.syncFromKeyboard()
  }

  private blur = () => {
    this.keys.clear()
    this.held.clear()
    this.move.x = 0
    this.move.y = 0
    this.sprint = false
  }

  attach() {
    if (this.attached || typeof window === 'undefined') return
    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', this.blur)
    this.attached = true
  }

  detach() {
    if (!this.attached) return
    window.removeEventListener('keydown', this.keyDown)
    window.removeEventListener('keyup', this.keyUp)
    window.removeEventListener('blur', this.blur)
    this.attached = false
  }

  private syncFromKeyboard() {
    const k = this.keys
    let x = 0
    let y = 0
    if (k.has('arrowleft') || k.has('a')) x -= 1
    if (k.has('arrowright') || k.has('d')) x += 1
    if (k.has('arrowup') || k.has('w')) y += 1
    if (k.has('arrowdown') || k.has('s')) y -= 1
    // El teclado no pisa el joystick virtual si está activo.
    if (x !== 0 || y !== 0 || this.kbActive) {
      this.kbActive = x !== 0 || y !== 0
      this.move.x = x
      this.move.y = y
    }
    this.sprint = k.has('shift') || this.vSprint
    const map: Array<[string, ActionButton]> = [
      ['x', 'pass'],
      [' ', 'pass'],
      ['z', 'shoot'],
      ['enter', 'shoot'],
      ['c', 'lob'],
      ['e', 'switch'],
      ['q', 'slide'],
    ]
    for (const [key, action] of map) {
      if (k.has(key)) {
        if (!this.held.has(action)) this.pressed.add(action)
        this.held.add(action)
      } else if (this.kbHeld.has(action)) {
        this.held.delete(action)
      }
    }
    this.kbHeld = new Set(map.filter(([key]) => k.has(key)).map(([, a]) => a))
  }

  private kbActive = false
  private kbHeld = new Set<ActionButton>()
  private vSprint = false

  /** --- API virtual (controles táctiles) --- */
  setVirtualMove(x: number, y: number) {
    this.move.x = clamp(x, -1, 1)
    this.move.y = clamp(y, -1, 1)
    this.kbActive = false
  }

  setVirtualButton(action: ActionButton, down: boolean) {
    if (down) {
      if (!this.held.has(action)) this.pressed.add(action)
      this.held.add(action)
    } else {
      this.held.delete(action)
    }
  }

  setVirtualSprint(down: boolean) {
    this.vSprint = down
    this.sprint = down || this.keys.has('shift')
  }

  isHeld(action: ActionButton) {
    return this.held.has(action)
  }

  /** Devuelve true una sola vez por pulsación. */
  consumePressed(action: ActionButton): boolean {
    if (this.pressed.has(action)) {
      this.pressed.delete(action)
      return true
    }
    return false
  }

  /** Llamar al final de cada frame de simulación. */
  endFrame() {
    this.pressed.clear()
  }

  setPauseHandler(fn: (() => void) | null) {
    this.onPause = fn
  }
  setCameraHandler(fn: (() => void) | null) {
    this.onCamera = fn
  }
}
