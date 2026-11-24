import { recordings } from './recordings'
import type { RainRecording } from './recordings'

interface Loop {
  gain: GainNode
  source?: AudioBufferSourceNode
  loading?: Promise<void>
}

// Web Audio time constants, in seconds. After three time constants a fade is 95% complete.
const brushAttack = .03, brushRelease = .06
const ambientAttack = .9, ambientRelease = 1.5
// The glass recording averages about 6 dB below the tin roof recording.
const glassGain = 2

export class RainAudio {
  private context?: AudioContext
  private loops = new Map<RainRecording, Loop>()
  private abort = new AbortController()
  private glassBuffer?: Promise<AudioBuffer>
  private brushPressed = false
  private brushTarget = 0
  private recording: RainRecording = 'tin'
  private volume = 0
  private ambient = 0
  private ambientTarget = 0
  private unlocked = false
  private disposed = false
  private idleAt = 0
  private silenceTimer?: ReturnType<typeof setTimeout>

  constructor() {
    window.addEventListener('pointerdown', this.gesture, true)
    window.addEventListener('pointerup', this.gesture, true)
    window.addEventListener('keydown', this.gesture, true)
    document.addEventListener('visibilitychange', this.visibility)
  }

  // Called once the scene has drawn, without opening a live output device.
  preloadBrush() {
    if (!this.disposed && typeof OfflineAudioContext !== 'undefined') {
      void this.prepareGlass().catch(() => { /* Retry on the first audible hit. */ })
    }
  }

  set(intensity: number, volume: number, recording: RainRecording = this.recording) {
    this.recording = recording
    this.volume = volume
    this.ambient = recording === 'tin' && intensity > 0 ? volume * (.18 + .82 * Math.sqrt(intensity)) : 0
    this.syncBrush()
    this.syncAmbient()
  }

  setBrushPressed(pressed: boolean) {
    if (this.brushPressed === pressed) return
    this.brushPressed = pressed
    this.syncBrush()
  }

  private syncBrush() {
    const target = this.brushPressed && this.canPlay() ? this.volume * glassGain : 0
    if (target) this.player(this.activate(), 'glass')
    if (target === this.brushTarget || !this.context) return
    // Each change starts at the current gain, with no queued fade to undo.
    const timeConstant = target > this.brushTarget ? brushAttack : brushRelease
    this.loops.get('glass')!.gain.gain.setTargetAtTime(target, this.context.currentTime, timeConstant)
    this.brushTarget = target
    if (!target) this.idleAfter(7 * brushRelease)
  }

  private canPlay() {
    return !this.disposed && !document.hidden && (this.unlocked || navigator.userActivation?.hasBeenActive)
  }

  private activate() {
    const context = this.context ??= new AudioContext({ latencyHint: 'interactive' })
    if (context.state !== 'running') void context.resume().catch(() => {})
    return context
  }

  private gesture = () => {
    this.unlocked = true
    if (this.ambient) this.syncAmbient()
    if (this.brushPressed) this.syncBrush()
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

  private visibility = () => {
    if (!document.hidden) { this.syncAmbient(); return }
    this.brushPressed = false
    this.brushTarget = 0
    if (this.context) {
      this.loops.get('glass')?.gain.gain.setValueAtTime(0, this.context.currentTime)
      this.loops.get('tin')?.gain.gain.setValueAtTime(0, this.context.currentTime)
      this.ambientTarget = 0
      this.suspendOutput()
    }
  }

  private idleAfter(seconds: number) {
    this.idleAt = Math.max(this.idleAt, performance.now() + seconds * 1000)
    if (this.ambient || this.brushTarget || this.silenceTimer !== undefined) return
    this.checkIdle()
  }

  private checkIdle = () => {
    this.silenceTimer = undefined
    if (this.disposed || this.ambient || this.brushTarget || document.hidden) return
    const remaining = this.idleAt - performance.now()
    if (remaining > 0) this.silenceTimer = setTimeout(this.checkIdle, Math.ceil(remaining))
    else this.suspendOutput()
  }

  private suspendOutput() {
    const context = this.context
    if (!context || context.state !== 'running') return
    void context.suspend().then(() => {
      // A new press can arrive while the output device is going to sleep.
      if ((this.brushTarget || this.ambient) && this.canPlay()) this.activate()
    }).catch(() => {})
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
    if (recording === 'glass' && !this.brushTarget) loop.gain.gain.setValueAtTime(0, context.currentTime)
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
