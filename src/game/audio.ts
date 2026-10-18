/**
 * Audio 100% sintetizado con WebAudio (sin archivos externos):
 * silbato del árbitro, golpes al balón, multitud ambiental y rugido de gol.
 */
export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private crowdGain: GainNode | null = null
  private crowdSource: AudioBufferSourceNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private _muted = false
  private excitement = 0

  get muted() {
    return this._muted
  }

  setMuted(m: boolean) {
    this._muted = m
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05)
    }
  }

  /** Debe llamarse dentro de un gesto del usuario. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = this._muted ? 0 : 1
    this.master.connect(this.ctx.destination)

    // Buffer de ruido reutilizable (2s)
    const len = this.ctx.sampleRate * 2
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02 // ruido marrón (más grave)
      data[i] = last * 3.2
    }
    this.noiseBuffer = buf

    // Multitud ambiental en loop
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 620
    bp.Q.value = 0.6
    const g = this.ctx.createGain()
    g.gain.value = 0.045
    src.connect(bp).connect(g).connect(this.master)
    src.start()
    this.crowdSource = src
    this.crowdGain = g
  }

  dispose() {
    try {
      this.crowdSource?.stop()
    } catch {
      /* noop */
    }
    void this.ctx?.close()
    this.ctx = null
    this.master = null
    this.crowdGain = null
    this.crowdSource = null
  }

  /** Excitación de la multitud 0..1 (sube en goles/atajadas, decae solo). */
  setExcitement(v: number) {
    this.excitement = v
    if (this.crowdGain && this.ctx) {
      const target = 0.045 + v * 0.3
      this.crowdGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15)
    }
  }

  private env(node: AudioNode, t0: number, attack: number, decay: number, peak: number) {
    if (!this.ctx || !this.master) return null
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
    node.connect(g)
    g.connect(this.master)
    return g
  }

  /** Silbato: n pitidos. */
  whistle(n = 1, long = false) {
    this.ensure()
    if (!this.ctx) return
    const t0 = this.ctx.currentTime
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.45
      const osc = this.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(2350, t)
      const lfo = this.ctx.createOscillator()
      lfo.frequency.value = 38
      const lfoGain = this.ctx.createGain()
      lfoGain.gain.value = 140
      lfo.connect(lfoGain).connect(osc.frequency)
      const dur = long ? 0.75 : 0.28
      this.env(osc, t, 0.01, dur, 0.12)
      osc.start(t)
      osc.stop(t + dur + 0.1)
      lfo.start(t)
      lfo.stop(t + dur + 0.1)
    }
  }

  /** Golpe al balón. power 0..1 */
  kick(power = 0.6) {
    this.ensure()
    if (!this.ctx || !this.noiseBuffer) return
    const t0 = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.playbackRate.value = 1.5
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420 + power * 700
    src.connect(lp)
    this.env(lp, t0, 0.004, 0.07 + power * 0.05, 0.25 + power * 0.35)
    src.start(t0, Math.random())
    src.stop(t0 + 0.2)
  }

  bounce() {
    this.kick(0.15)
  }

  post() {
    this.ensure()
    if (!this.ctx) return
    const t0 = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(620, t0)
    osc.frequency.exponentialRampToValueAtTime(240, t0 + 0.4)
    this.env(osc, t0, 0.002, 0.45, 0.3)
    osc.start(t0)
    osc.stop(t0 + 0.6)
  }

  catchBall() {
    this.kick(0.12)
  }

  /** "Oooh" de la multitud en llegada cercana. */
  ooh() {
    this.ensure()
    if (!this.ctx || !this.noiseBuffer) return
    const t0 = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(500, t0)
    bp.frequency.linearRampToValueAtTime(760, t0 + 0.5)
    bp.Q.value = 1.4
    src.connect(bp)
    this.env(bp, t0, 0.18, 0.7, 0.22)
    src.start(t0)
    src.stop(t0 + 1.2)
  }

  /** Rugido de gol. */
  goalRoar() {
    this.ensure()
    if (!this.ctx || !this.noiseBuffer) return
    const t0 = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 240
    src.connect(hp)
    this.env(hp, t0, 0.1, 4.5, 0.85)
    src.start(t0)
    src.stop(t0 + 5.2)
    this.setExcitement(1)
  }
}
