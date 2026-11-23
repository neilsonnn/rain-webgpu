import { recordings } from './recordings'
import type { RainRecording } from './recordings'

interface Loop {
  gain: GainNode
  source?: AudioBufferSourceNode
  loading?: Promise<void>
}

// Web Audio time constants, in seconds. After three time constants a fade is 95% complete.
const brushAttack = .003, brushHold = .035, brushRelease = .04
const ambientAttack = .9, ambientRelease = 1.5

export class RainAudio {
  private context?: AudioContext
  private loops = new Map<RainRecording, Loop>()
  private abort = new AbortController()
  private glassBuffer?: Promise<AudioBuffer>
  private contacts = new Map<number, { hits: number; time: number }>()
  private recording: RainRecording = 'tin'
  private volume = 0
  private ambient = 0
  private ambientTarget = 0
  private unlocked = false
  private disposed = false
  private idleAt = 0
  private silenceTimer?: ReturnType<typeof setTimeout>

  constructor(private surface: HTMLElement | null = null) {
    window.addEventListener('pointerdown', this.gesture, true)
    window.addEventListener('pointerup', this.gesture, true)
    window.addEventListener('keydown', this.gesture, true)
    document.addEventListener('visibilitychange', this.visibility)
    // Decode ahead of the first hit, without opening a live output device.
    if (typeof OfflineAudioContext !== 'undefined') {
      void this.prepareGlass().catch(() => { /* Retry on the first audible hit. */ })
    }
  }

  set(intensity: number, volume: number, recording: RainRecording = this.recording) {
    this.recording = recording
    this.volume = volume
    this.ambient = recording === 'tin' && intensity > 0 ? volume * (.18 + .82 * Math.sqrt(intensity)) : 0
    this.syncAmbient()
    if (!volume) this.quietBrush()
  }

  brushHits(contact: number, hits: number) {
    if (hits <= 0 || !this.volume || !this.canPlay()) return
    const context = this.activate()
    const loop = this.player(context, 'glass')
    const now = context.currentTime
    const recent = this.contacts.get(contact) ?? { hits: 0, time: now }
    // Count impacts over the last few packets. The loudest finger drives one loop.
    const decay = (time: number) => Math.exp(-(now - time) / .065)
    recent.hits = recent.hits * decay(recent.time) + hits
    recent.time = now
    this.contacts.set(contact, recent)
    let peak = recent.hits
    for (const other of this.contacts.values()) peak = Math.max(peak, other.hits * decay(other.time))
    const level = this.volume * peak / (peak + 5)
    const gain = loop.gain.gain
    gain.cancelScheduledValues(now)
    gain.setTargetAtTime(level, now, brushAttack)
    // Real release-patter hits refresh this envelope, even after the finger lifts.
    gain.setTargetAtTime(0, now + brushHold, brushRelease)
    this.idleAfter(brushHold + 7 * brushRelease)
  }

  private canPlay() {
    return !this.disposed && !document.hidden && (this.unlocked || navigator.userActivation?.hasBeenActive)
  }

  private activate() {
    const context = this.context ??= new AudioContext({ latencyHint: 'interactive' })
    if (context.state !== 'running') void context.resume().catch(() => {})
    return context
  }

  private gesture = (event: Event) => {
    this.unlocked = true
    if (this.ambient) this.syncAmbient()
    // The GPU submits the first packet on the next frame. Unlock during the actual gesture.
    else if (this.volume && this.surface && event.target instanceof Node && this.surface.contains(event.target) && this.canPlay() && this.context?.state !== 'running') {
      this.activate()
      this.idleAfter(.4)
    }
  }

  private syncAmbient() {
    if (this.ambient && this.canPlay()) this.player(this.activate(), 'tin')
    const loop = this.loops.get('tin')
    if (!this.context || document.hidden) return
    if (!loop?.source || this.ambient === this.ambientTarget) {
      if (!this.ambient) this.idleAfter(0)
      return
    }
    const timeConstant = this.ambient > this.ambientTarget ? ambientAttack : ambientRelease
    loop.gain.gain.setTargetAtTime(this.ambient, this.context.currentTime, timeConstant)
    this.ambientTarget = this.ambient
    if (!this.ambient) this.idleAfter(7 * timeConstant)
  }

  private quietBrush() {
    this.contacts.clear()
    const gain = this.loops.get('glass')?.gain.gain
    if (!gain || !this.context) return
    const now = this.context.currentTime
    gain.cancelScheduledValues(now)
    gain.setTargetAtTime(0, now, brushAttack)
  }

  private visibility = () => {
    if (!document.hidden) { this.syncAmbient(); return }
    this.quietBrush()
    if (this.context) {
      this.loops.get('tin')?.gain.gain.setValueAtTime(0, this.context.currentTime)
      this.ambientTarget = 0
      void this.context.suspend().catch(() => {})
    }
  }

  private idleAfter(seconds: number) {
    this.idleAt = Math.max(this.idleAt, performance.now() + seconds * 1000)
    if (this.ambient || this.silenceTimer !== undefined) return
    this.checkIdle()
  }

  private checkIdle = () => {
    this.silenceTimer = undefined
    if (this.disposed || this.ambient || document.hidden) return
    const remaining = this.idleAt - performance.now()
    if (remaining > 0) this.silenceTimer = setTimeout(this.checkIdle, Math.ceil(remaining))
    else if (this.context) void this.context.suspend().catch(() => {})
  }

  private async read(recording: RainRecording) {
    const response = await fetch(recordings[recording].url, { signal: this.abort.signal })
    if (!response.ok) throw new Error('Rain recording unavailable (' + response.status + ')')
    return response.arrayBuffer()
  }

  private prepareGlass() {
    return this.glassBuffer ??= this.read('glass').then(bytes => {
      const decoder = this.context ?? new OfflineAudioContext(2, 1, 44100)
      return decoder.decodeAudioData(bytes)
    }).catch(error => { this.glassBuffer = undefined; throw error })
  }

  private player(context: AudioContext, recording: RainRecording) {
    let loop = this.loops.get(recording)
    if (!loop) {
      const gain = context.createGain()
      gain.gain.value = 0
      gain.connect(context.destination)
      loop = { gain }
      this.loops.set(recording, loop)
    }
    if (!loop.source && !loop.loading) {
      const track = loop
      track.loading = this.load(context, recording, track).catch(error => {
        if (!this.disposed) console.warn('Could not load the rain recording.', error)
      }).finally(() => { track.loading = undefined })
    }
    return loop
  }

  private async load(context: AudioContext, recording: RainRecording, loop: Loop) {
    const buffer = recording === 'glass' ? await this.prepareGlass() : await context.decodeAudioData(await this.read(recording))
    if (this.disposed) return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.loopEnd = buffer.duration
    source.connect(loop.gain)
    source.start()
    loop.source = source
    // Start the slow fade when samples are ready, including on a cold first load.
    if (recording === 'tin') this.syncAmbient()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.silenceTimer)
    this.abort.abort()
    window.removeEventListener('pointerdown', this.gesture, true)
    window.removeEventListener('pointerup', this.gesture, true)
    window.removeEventListener('keydown', this.gesture, true)
    document.removeEventListener('visibilitychange', this.visibility)
    for (const loop of this.loops.values()) {
      loop.source?.stop()
      loop.source?.disconnect()
      loop.gain.disconnect()
    }
    this.loops.clear()
    this.glassBuffer = undefined
    if (this.context) void this.context.close().catch(() => {})
  }
}
