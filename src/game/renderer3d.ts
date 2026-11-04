import * as THREE from 'three'
import { BALL, GOAL, PITCH, clamp } from './constants'
import type { CameraMode } from './types'

/**
 * Escena Three.js: iluminación de estadio nocturno, cámaras (broadcast,
 * aérea y tras el arco), balón con textura, marcador del jugador controlado.
 */
export class Scene3D {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  private ballMesh: THREE.Mesh
  private ballTexture: THREE.CanvasTexture
  private markerRing: THREE.Mesh
  private nameSprite: THREE.Sprite
  private nameCanvas: HTMLCanvasElement
  private nameTexture: THREE.CanvasTexture
  private camPos = new THREE.Vector3(PITCH.L / 2, 26, 100)
  private camLook = new THREE.Vector3(PITCH.L / 2, 0, PITCH.W / 2)
  private shake = 0
  /** velocidad del balón (para la anticipación de cámara) */
  private ballVx = 0
  private ballVz = 0
  mode: CameraMode = 'broadcast'
  /** zoom de las cámaras de TV: 0.55 (muy cerca) .. 1.45 (muy lejos); 1 = normal */
  zoom = 1
  private wheelHandler: ((e: WheelEvent) => void) | null = null
  private container: HTMLElement
  private resizeObs: ResizeObserver

  constructor(container: HTMLElement) {
    this.container = container
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08

    this.scene.background = new THREE.Color('#05080f')
    this.scene.fog = new THREE.FogExp2('#05080f', 0.0015)

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 600)

    // --- iluminación
    const hemi = new THREE.HemisphereLight('#bcd2ff', '#1c3a24', 0.55)
    this.scene.add(hemi)
    const amb = new THREE.AmbientLight('#404a52', 0.5)
    this.scene.add(amb)

    const sun = new THREE.DirectionalLight('#fff3da', 1.6)
    sun.position.set(PITCH.L / 2 + 30, 65, 40)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -70
    sun.shadow.camera.right = 70
    sun.shadow.camera.top = 55
    sun.shadow.camera.bottom = -55
    sun.shadow.camera.near = 10
    sun.shadow.camera.far = 180
    sun.shadow.bias = -0.0006
    sun.target.position.set(PITCH.L / 2, 0, PITCH.W / 2)
    this.scene.add(sun)
    this.scene.add(sun.target)

    for (const [cx, cz] of [
      [-6, -6],
      [PITCH.L + 6, -6],
      [-6, PITCH.W + 6],
      [PITCH.L + 6, PITCH.W + 6],
    ]) {
      const spot = new THREE.SpotLight('#fff8e0', 250, 140, 0.9, 0.5, 1.6)
      spot.position.set(cx, 30, cz)
      spot.target.position.set(PITCH.L / 2, 0, PITCH.W / 2)
      this.scene.add(spot)
      this.scene.add(spot.target)
    }

    // --- balón
    this.ballTexture = makeBallTexture()
    const ballGeo = new THREE.SphereGeometry(BALL.r, 20, 16)
    const ballMat = new THREE.MeshStandardMaterial({ map: this.ballTexture, roughness: 0.35 })
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat)
    this.ballMesh.castShadow = true
    this.scene.add(this.ballMesh)

    // --- marcador del jugador controlado
    const ringGeo = new THREE.RingGeometry(0.55, 0.78, 28)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#e8c832', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    this.markerRing = new THREE.Mesh(ringGeo, ringMat)
    this.markerRing.rotation.x = -Math.PI / 2
    this.markerRing.position.y = 0.03
    this.scene.add(this.markerRing)

    // --- etiqueta de nombre
    this.nameCanvas = document.createElement('canvas')
    this.nameCanvas.width = 256
    this.nameCanvas.height = 64
    this.nameTexture = new THREE.CanvasTexture(this.nameCanvas)
    this.nameTexture.colorSpace = THREE.SRGBColorSpace
    const spriteMat = new THREE.SpriteMaterial({ map: this.nameTexture, transparent: true, depthTest: false })
    this.nameSprite = new THREE.Sprite(spriteMat)
    this.nameSprite.scale.set(2.4, 0.6, 1)
    this.nameSprite.position.y = 2.3
    this.scene.add(this.nameSprite)

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    // rueda del ratón: acercar / alejar la cámara de TV
    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault()
      this.setZoom(this.zoom + Math.sign(e.deltaY) * 0.07)
    }
    container.addEventListener('wheel', this.wheelHandler, { passive: false })
    this.resize()
  }

  setZoom(z: number) {
    this.zoom = clamp(z, 0.55, 1.45)
  }

  get zoomPct(): number {
    return Math.round(this.zoom * 100)
  }

  resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  addName(name: string) {
    const g = this.nameCanvas.getContext('2d')!
    g.clearRect(0, 0, 256, 64)
    g.fillStyle = 'rgba(10,12,16,0.72)'
    g.beginPath()
    g.roundRect(28, 10, 200, 44, 10)
    g.fill()
    g.fillStyle = '#f2d543'
    g.font = 'bold 26px Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(name.toUpperCase(), 128, 33)
    this.nameTexture.needsUpdate = true
  }

  shakeCamera(amount: number) {
    this.shake = Math.max(this.shake, amount)
  }

  /** Actualiza cámaras y visuales por frame. */
  update(
    dt: number,
    ball: { x: number; y: number; z: number; spinAngle: number; spinAxisX: number; spinAxisZ: number },
    controlled: { x: number; z: number; name: string } | null,
    attackDirUser: 1 | -1,
  ) {
    this.ballVx = (ball as { vx?: number }).vx ?? 0
    this.ballVz = (ball as { vz?: number }).vz ?? 0
    // balón
    this.ballMesh.position.set(ball.x, ball.y, ball.z)
    this.ballMesh.rotation.set(0, 0, 0)
    this.ballMesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), 0)
    this.ballMesh.rotateOnAxis(new THREE.Vector3(ball.spinAxisX, 0, ball.spinAxisZ), ball.spinAngle)

    // marcador + etiqueta
    if (controlled) {
      this.markerRing.visible = true
      this.markerRing.position.set(controlled.x, 0.03, controlled.z)
      const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.08
      this.markerRing.scale.setScalar(pulse)
      this.nameSprite.visible = true
      this.nameSprite.position.set(controlled.x, 2.3, controlled.z)
      if (this.lastName !== controlled.name) {
        this.addName(controlled.name)
        this.lastName = controlled.name
      }
    } else {
      this.markerRing.visible = false
      this.nameSprite.visible = false
    }

    // cámara
    const bx = ball.x
    const bz = ball.z
    const desired = new THREE.Vector3()
    const look = new THREE.Vector3()
    if (this.mode === 'aerea') {
      desired.set(clamp(bx, 12, PITCH.L - 12), 52, bz + 22)
      look.set(bx, 0, bz)
    } else if (this.mode === 'cable') {
      // Cámara "cable" (guaya, tipo FIFA clásico): flota sobre el campo siguiendo
      // la jugada en X y en Z, baja y muy cerca de los jugadores, con vaivén
      // suave de guaya. Muestra la acción mucho más cerca que cualquier TV.
      const z = this.zoom
      const t = performance.now() * 0.00042
      const swayX = Math.sin(t) * 0.8
      const swayY = Math.sin(t * 0.58 + 1.7) * 0.28
      const cx = clamp(bx + swayX, 3, PITCH.L - 3)
      const cz = clamp(bz + 7.8 * z, 4, PITCH.W + 3.5)
      desired.set(cx, 11.5 * z + swayY, cz)
      // mira un poco adelantada según la velocidad del balón: la jugada queda centrada
      look.set(
        clamp(bx + this.ballVx * 0.24, 2, PITCH.L - 2),
        0.4,
        clamp(bz + this.ballVz * 0.24 - 1.2, 0.5, PITCH.W - 0.5),
      )
    } else if (this.mode === 'arco') {
      const gx = attackDirUser > 0 ? PITCH.L : 0
      const s = attackDirUser > 0 ? -1 : 1
      desired.set(gx + s * 24, 10.5, PITCH.W / 2 + (bz - PITCH.W / 2) * 0.4)
      look.set(bx, 1, bz)
    } else if (this.mode === 'cerca') {
      // TV cercana: baja, pegada a la línea y siguiendo el balón de cerca
      const z = this.zoom
      const cx = clamp(bx * clamp(0.97 + (1 - z) * 0.1, 0.65, 0.995), 6, PITCH.L - 6)
      desired.set(cx, 10.5 * z, PITCH.W + 13 * z)
      look.set(clamp(bx, 6, PITCH.L - 6), 0.6, PITCH.W / 2 + (bz - PITCH.W / 2) * 0.72)
    } else {
      // TV broadcast clásica; el zoom escala altura y distancia (1 = vista original)
      const z = this.zoom
      const cx = clamp(bx * clamp(0.88 + (1 - z) * 0.1, 0.65, 0.99), 10, PITCH.L - 10)
      desired.set(cx, 17.5 * z, PITCH.W + 24 * z)
      look.set(clamp(bx * 0.94, 8, PITCH.L - 8), 0.5, 12 + bz * 0.5)
    }
    // la cámara cable se desliza más lenta y pesada, como colgada de una guaya
    const k = 1 - Math.exp((this.mode === 'cable' ? -2.5 : -3.4) * dt)
    const k2 = 1 - Math.exp((this.mode === 'cable' ? -5.2 : -4.2) * dt)
    this.camPos.lerp(desired, k)
    this.camLook.lerp(look, k2)

    this.shake = Math.max(0, this.shake - dt * 1.6)
    const sh = this.shake
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + (Math.random() - 0.5) * sh,
      this.camPos.z + (Math.random() - 0.5) * sh,
    )
    this.camera.lookAt(this.camLook)
  }

  private lastName = ''

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.resizeObs.disconnect()
    if (this.wheelHandler) this.container.removeEventListener('wheel', this.wheelHandler)
    this.renderer.dispose()
    this.ballTexture.dispose()
    this.nameTexture.dispose()
    this.renderer.domElement.remove()
  }
}

function makeBallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#f4f4f2'
  g.fillRect(0, 0, 256, 128)
  g.fillStyle = '#141414'
  // parches pentagonales aproximados
  for (let i = 0; i < 10; i++) {
    const cx = 14 + (i % 5) * 50 + (i < 5 ? 0 : 25)
    const cy = i < 5 ? 36 : 92
    g.beginPath()
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + (i < 5 ? 0 : Math.PI / 5)
      const px = cx + Math.cos(a) * 11
      const py = cy + Math.sin(a) * 11
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export { GOAL }
