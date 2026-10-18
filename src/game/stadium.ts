import * as THREE from 'three'
import { PITCH } from './constants'

export interface StadiumRefs {
  group: THREE.Group
  crowd: THREE.InstancedMesh
  crowdBase: Float32Array
  /** update por frame: animación del público según excitación 0..1 */
  animate: (time: number, excitement: number) => void
  dispose: () => void
}

const LIGHT_BRANDS = ['Z-AI ARENA', 'FÚTBOL PRO 3D', 'GOOOL FM 90.9', 'PIXELBANK', 'TURBO COLA', 'AERO SUR']

/** Textura del césped con rayas y todas las líneas reglamentarias. */
function makePitchTexture(): THREE.CanvasTexture {
  const px = 18 // px por metro
  const w = Math.round((PITCH.L + 8) * px)
  const h = Math.round((PITCH.W + 8) * px)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  const ox = 4 * px // margen
  const oz = 4 * px
  const M = (v: number) => v * px // metros → px

  // fondo (fuera del campo)
  g.fillStyle = '#0e3d1c'
  g.fillRect(0, 0, w, h)

  // rayas del césped
  const stripes = 14
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? '#1d8038' : '#18722f'
    g.fillRect(ox + (i * PITCH.L * px) / stripes, oz, (PITCH.L * px) / stripes + 1, PITCH.W * px)
  }

  // líneas
  g.strokeStyle = 'rgba(255,255,255,0.92)'
  g.lineWidth = Math.max(2, M(0.13))
  g.strokeRect(ox, oz, M(PITCH.L), M(PITCH.W))
  g.beginPath()
  g.moveTo(ox + M(PITCH.L / 2), oz)
  g.lineTo(ox + M(PITCH.L / 2), oz + M(PITCH.W))
  g.stroke()
  g.beginPath()
  g.arc(ox + M(PITCH.L / 2), oz + M(PITCH.W / 2), M(PITCH.circleR), 0, Math.PI * 2)
  g.stroke()
  g.beginPath()
  g.arc(ox + M(PITCH.L / 2), oz + M(PITCH.W / 2), M(0.3), 0, Math.PI * 2)
  g.fillStyle = '#fff'
  g.fill()

  for (const side of [0, 1]) {
    const gx = side === 0 ? ox : ox + M(PITCH.L)
    const s = side === 0 ? 1 : -1
    // áreas
    g.strokeRect(
      side === 0 ? gx : gx - M(PITCH.boxD),
      oz + M((PITCH.W - PITCH.boxW) / 2),
      M(PITCH.boxD),
      M(PITCH.boxW),
    )
    g.strokeRect(
      side === 0 ? gx : gx - M(PITCH.sixD),
      oz + M((PITCH.W - PITCH.sixW) / 2),
      M(PITCH.sixD),
      M(PITCH.sixW),
    )
    // punto de penal
    g.beginPath()
    g.arc(gx + s * M(PITCH.spot), oz + M(PITCH.W / 2), M(0.28), 0, Math.PI * 2)
    g.fill()
    // arco del área
    g.beginPath()
    g.arc(gx + s * M(PITCH.spot), oz + M(PITCH.W / 2), M(PITCH.circleR), side === 0 ? -Math.PI / 2.6 : Math.PI - Math.PI / 2.6, side === 0 ? Math.PI / 2.6 : Math.PI + Math.PI / 2.6, false)
    g.stroke()
    // arcos de esquina
    for (const cz of [0, PITCH.W]) {
      g.beginPath()
      g.arc(gx, oz + M(cz), M(PITCH.cornerR), 0, Math.PI * 2)
      g.stroke()
    }
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function makeNetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(235,235,235,0.75)'
  g.lineWidth = 2
  for (let i = 0; i <= 128; i += 12) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i, 128)
    g.stroke()
    g.beginPath()
    g.moveTo(0, i)
    g.lineTo(128, i)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(6, 2)
  return tex
}

function makeAdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2048
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#101812'
  g.fillRect(0, 0, 2048, 128)
  const slot = 2048 / LIGHT_BRANDS.length
  LIGHT_BRANDS.forEach((brand, i) => {
    g.fillStyle = i % 2 === 0 ? '#c9a227' : '#e8e4d8'
    g.font = 'bold 54px Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(brand, slot * i + slot / 2, 66)
    g.strokeStyle = 'rgba(255,255,255,0.15)'
    g.strokeRect(slot * i, 0, slot, 128)
  })
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

/** Público: instancias con colores variados en las gradas. */
function buildCrowd(): { mesh: THREE.InstancedMesh; base: Float32Array } {
  const positions: Array<[number, number, number]> = []
  const colors: number[] = []
  const palette = ['#c8c8c8', '#c81e2b', '#e8c832', '#1d8038', '#e2711d', '#8a5a3b', '#d64a8a', '#2a2a2e', '#c9a227']
  const cTmp = new THREE.Color()

  // cuatro gradas: norte/sur (z) y este/oeste (x)
  const rows = 14
  const stepX = 1.1
  const stepY = 0.62
  // norte y sur (a lo largo del campo, FUERA de las líneas de banda)
  for (const side of [-1, 1]) {
    for (let row = 0; row < rows; row++) {
      const dist = 7 + row * stepX
      const z = side > 0 ? PITCH.W + dist : -dist
      const y = 2.2 + row * stepY
      for (let x = -12; x <= PITCH.L + 12; x += 1.35) {
        if (Math.random() < 0.12) continue // huecos
        positions.push([x, y, z])
        cTmp.set(palette[Math.floor(Math.random() * palette.length)])
        cTmp.multiplyScalar(0.55 + Math.random() * 0.45)
        colors.push(cTmp.r, cTmp.g, cTmp.b)
      }
    }
  }
  // este y oeste (detrás de los arcos)
  for (const side of [-1, 1]) {
    for (let row = 0; row < rows; row++) {
      const dist = 8 + row * stepX
      const x = side < 0 ? -dist : PITCH.L + dist
      const y = 2.2 + row * stepY
      for (let z = 2; z <= PITCH.W - 2; z += 1.35) {
        if (Math.random() < 0.12) continue
        positions.push([x, y, z])
        cTmp.set(palette[Math.floor(Math.random() * palette.length)])
        cTmp.multiplyScalar(0.55 + Math.random() * 0.45)
        colors.push(cTmp.r, cTmp.g, cTmp.b)
      }
    }
  }

  const count = positions.length
  const geo = new THREE.SphereGeometry(0.34, 6, 5)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  const dummy = new THREE.Object3D()
  const base = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = positions[i]
    dummy.position.set(x, y, z)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    base[i * 3] = x
    base[i * 3 + 1] = y
    base[i * 3 + 2] = z
    mesh.setColorAt(i, new THREE.Color(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]))
  }
  mesh.instanceMatrix.needsUpdate = true
  return { mesh, base }
}

export function buildStadium(scene: THREE.Scene): StadiumRefs {
  const group = new THREE.Group()
  scene.add(group)
  const disposables: Array<{ dispose: () => void }> = []

  // --- césped
  const pitchTex = makePitchTexture()
  const pitchGeo = new THREE.PlaneGeometry(PITCH.L + 8, PITCH.W + 8)
  const pitchMat = new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 1 })
  const pitch = new THREE.Mesh(pitchGeo, pitchMat)
  pitch.rotation.x = -Math.PI / 2
  pitch.position.set(PITCH.L / 2, 0, PITCH.W / 2)
  pitch.receiveShadow = true
  group.add(pitch)
  disposables.push(pitchGeo, pitchMat, pitchTex)

  // perímetro exterior más oscuro
  const apronGeo = new THREE.PlaneGeometry(PITCH.L + 34, PITCH.W + 34)
  const apronMat = new THREE.MeshStandardMaterial({ color: '#0a2e14', roughness: 1 })
  const apron = new THREE.Mesh(apronGeo, apronMat)
  apron.rotation.x = -Math.PI / 2
  apron.position.set(PITCH.L / 2, -0.05, PITCH.W / 2)
  apron.receiveShadow = true
  group.add(apron)
  disposables.push(apronGeo, apronMat)

  // --- arcos con redes
  const postMat = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.4 })
  const netTex = makeNetTexture()
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  disposables.push(postMat, netTex, netMat)
  const goalW = PITCH.goalW

  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : PITCH.L
    const s = side === 0 ? 1 : -1
    const goal = new THREE.Group()
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, PITCH.goalH, 8)
    const barGeo = new THREE.CylinderGeometry(0.06, 0.06, goalW, 8)
    disposables.push(postGeo, barGeo)
    for (const pz of [GOAL_Z_MIN, GOAL_Z_MAX]) {
      const post = new THREE.Mesh(postGeo, postMat)
      post.position.set(gx + s * 0.02, PITCH.goalH / 2, pz)
      post.castShadow = true
      goal.add(post)
    }
    const bar = new THREE.Mesh(barGeo, postMat)
    bar.rotation.x = Math.PI / 2
    bar.position.set(gx + s * 0.02, PITCH.goalH, PITCH.W / 2)
    bar.castShadow = true
    goal.add(bar)

    const backGeo = new THREE.PlaneGeometry(goalW, PITCH.goalH)
    const back = new THREE.Mesh(backGeo, netMat)
    back.position.set(gx + s * PITCH.goalDepth, PITCH.goalH / 2, PITCH.W / 2)
    back.rotation.y = Math.PI / 2
    goal.add(back)
    disposables.push(backGeo)

    const topGeo = new THREE.PlaneGeometry(PITCH.goalDepth, goalW)
    const top = new THREE.Mesh(topGeo, netMat)
    top.rotation.x = Math.PI / 2
    top.position.set(gx + (s * PITCH.goalDepth) / 2, PITCH.goalH, PITCH.W / 2)
    goal.add(top)
    disposables.push(topGeo)

    for (const pz of [GOAL_Z_MIN, GOAL_Z_MAX]) {
      const sideGeo = new THREE.PlaneGeometry(PITCH.goalDepth, PITCH.goalH)
      const sideNet = new THREE.Mesh(sideGeo, netMat)
      sideNet.position.set(gx + (s * PITCH.goalDepth) / 2, PITCH.goalH / 2, pz)
      goal.add(sideNet)
      disposables.push(sideGeo)
    }
    group.add(goal)
  }

  // --- vallas publicitarias LED
  const adTex = makeAdTexture()
  const adMat = new THREE.MeshStandardMaterial({ map: adTex, emissive: '#3a3a2a', emissiveIntensity: 0.35, roughness: 0.7 })
  disposables.push(adTex, adMat)
  const adH = 0.95
  const mkAd = (w: number, x: number, z: number, rotY: number) => {
    const tex = adTex.clone()
    tex.needsUpdate = true
    tex.repeat.set(w / 24, 1)
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#333322', emissiveIntensity: 0.4, roughness: 0.7 })
    disposables.push(tex, mat)
    const geo = new THREE.PlaneGeometry(w, adH)
    disposables.push(geo)
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, adH / 2, z)
    m.rotation.y = rotY
    group.add(m)
  }
  mkAd(PITCH.L + 6, PITCH.L / 2, -4.5, 0)
  mkAd(PITCH.L + 6, PITCH.L / 2, PITCH.W + 4.5, Math.PI)
  mkAd(PITCH.W + 6, -4.5, PITCH.W / 2, Math.PI / 2)
  mkAd(PITCH.W + 6, PITCH.L + 4.5, PITCH.W / 2, -Math.PI / 2)

  // --- gradas: muro perimetral + planos inclinados donde descansa el público
  const wallMat = new THREE.MeshStandardMaterial({ color: '#1b2027', roughness: 0.95 })
  const rampMat = new THREE.MeshStandardMaterial({ color: '#12161c', roughness: 1, side: THREE.DoubleSide })
  disposables.push(wallMat, rampMat)
  const mkWall = (w: number, x: number, z: number, rotY: number) => {
    const geo = new THREE.BoxGeometry(w, 1.6, 1.2)
    disposables.push(geo)
    const m = new THREE.Mesh(geo, wallMat)
    m.position.set(x, 0.8, z)
    m.rotation.y = rotY
    group.add(m)
  }
  mkWall(PITCH.L + 16, PITCH.L / 2, -5.6, 0)
  mkWall(PITCH.L + 16, PITCH.L / 2, PITCH.W + 5.6, 0)
  mkWall(PITCH.W + 16, -5.6, PITCH.W / 2, Math.PI / 2)
  mkWall(PITCH.W + 16, PITCH.L + 5.6, PITCH.W / 2, Math.PI / 2)

  const rows = 14
  const standAngle = Math.atan2(0.62, 1.1)
  const standLen = rows * 1.1 + 2.5
  const mkRamp = (w: number, startDist: number, ry: number) => {
    const geo = new THREE.PlaneGeometry(w, standLen)
    disposables.push(geo)
    const m = new THREE.Mesh(geo, rampMat)
    m.rotation.order = 'YXZ'
    m.rotation.y = ry
    m.rotation.x = Math.PI / 2 - standAngle
    const localZ = startDist + Math.cos(standAngle) * (standLen / 2)
    const localY = 1.5 + Math.sin(standAngle) * (standLen / 2)
    // posicionar alrededor del centro del estadio según ry
    const cx = PITCH.L / 2
    const cz = PITCH.W / 2
    if (ry === 0) m.position.set(cx, localY, cz + localZ)
    else if (ry === Math.PI) m.position.set(cx, localY, cz - localZ)
    else if (ry === Math.PI / 2) m.position.set(cx + localZ, localY, cz)
    else m.position.set(cx - localZ, localY, cz)
    group.add(m)
  }
  mkRamp(PITCH.L + 34, PITCH.W / 2 + 6.4, 0)
  mkRamp(PITCH.L + 34, PITCH.W / 2 + 6.4, Math.PI)
  mkRamp(PITCH.W + 26, PITCH.L / 2 + 6.4, Math.PI / 2)
  mkRamp(PITCH.W + 26, PITCH.L / 2 + 6.4, -Math.PI / 2)

  const { mesh: crowd, base } = buildCrowd()
  crowd.castShadow = false
  crowd.receiveShadow = false
  group.add(crowd)

  // --- torres de iluminación
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2c3038', roughness: 0.8 })
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff6d8', emissiveIntensity: 1.4 })
  disposables.push(poleMat, lampMat)
  for (const [cx, cz] of [
    [-8, -8],
    [PITCH.L + 8, -8],
    [-8, PITCH.W + 8],
    [PITCH.L + 8, PITCH.W + 8],
  ]) {
    const poleGeo = new THREE.CylinderGeometry(0.35, 0.5, 30, 8)
    disposables.push(poleGeo)
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.set(cx, 15, cz)
    group.add(pole)
    const panelGeo = new THREE.BoxGeometry(5.5, 2.6, 0.5)
    disposables.push(panelGeo)
    const panel = new THREE.Mesh(panelGeo, lampMat)
    panel.position.set(cx, 30.5, cz)
    panel.lookAt(PITCH.L / 2, 0, PITCH.W / 2)
    group.add(panel)
  }

  const crowdObj = crowd
  const animate = (time: number, excitement: number) => {
    if (excitement < 0.02) return
    const dummy = new THREE.Object3D()
    const n = crowdObj.count
    for (let i = 0; i < n; i++) {
      const bob = Math.max(0, Math.sin(time * 9 + i * 1.7)) * 0.42 * excitement
      dummy.position.set(base[i * 3], base[i * 3 + 1] + bob, base[i * 3 + 2])
      dummy.updateMatrix()
      crowdObj.setMatrixAt(i, dummy.matrix)
    }
    crowdObj.instanceMatrix.needsUpdate = true
  }

  return {
    group,
    crowd,
    crowdBase: base,
    animate,
    dispose: () => {
      for (const d of disposables) d.dispose()
      scene.remove(group)
      crowd.dispose()
    },
  }
}

const GOAL_Z_MIN = PITCH.W / 2 - PITCH.goalW / 2
const GOAL_Z_MAX = PITCH.W / 2 + PITCH.goalW / 2
