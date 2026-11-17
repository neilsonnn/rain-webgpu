import { recordings } from './recordings'
import type { RainRecording } from './recordings'

interface Loop {
  gain: GainNode
  source?: AudioBufferSourceNode
  loading?: Promise<void>
}

// Each recording has one player. Ambient glass rain and the brush share it.
export class RainAudio {
  private context?: AudioContext
  private loops = new Map<RainRecording, Loop>()
  private abort = new AbortController()
  private recording: RainRecording = 'tin'
  private ambient = 0
  private brush = 0
  private unlocked = false
  private disposed = false
  private silenceTimer?: ReturnType<typeof setTimeout>

  constructor() {
    window.addEventListener('pointerdown', this.gesture, true)
    window.addEventListener('pointerup', this.gesture, true)
    window.addEventListener('keydown', this.gesture, true)
    document.addEventListener('visibilitychange', this.sync)
  }

  set(intensity: number, volume: number, recording: RainRecording = this.recording) {
    this.recording = recording
    this.ambient = recording === 'tin' && intensity > 0 ? volume * (.18 + .82 * Math.sqrt(intensity)) : 0
    this.sync()
  }

  touch(flow: number, volume: number) {
    const amount = volume * Math.sqrt(Math.max(0, Math.min(1, flow)))
    if (Math.abs(amount - this.brush) < .001 && Boolean(amount) === Boolean(this.brush)) return
    this.brush = amount
    this.sync()
  }

  private gesture = () => {
    this.unlocked = true
    if (this.context?.state !== 'running' || [...this.loops.values()].some(loop => !loop.source && !loop.loading)) this.sync()
  }

  private sync = () => {
    if (this.disposed) return
    clearTimeout(this.silenceTimer)
    const audible = Math.max(this.ambient, this.brush) > 0 && !document.hidden
    if (!audible) {
      const context = this.context
      if (!context) return
      for (const loop of this.loops.values()) loop.gain.gain.setTargetAtTime(0, context.currentTime, .06)
      if (document.hidden) void context.suspend().catch(() => {})
      else this.silenceTimer = setTimeout(() => {
        if (!this.ambient && !this.brush && !this.disposed) void context.suspend().catch(() => {})
      }, 400)
      return
    }
    if (!this.unlocked && !navigator.userActivation?.hasBeenActive) return
    this.context ??= new AudioContext()
    const context = this.context
    if (context.state !== 'running') void context.resume().catch(() => {})
    for (const recording of Object.keys(recordings) as RainRecording[]) {
      const target = Math.max(this.recording === recording ? this.ambient : 0, recording === 'glass' ? this.brush : 0)
      let loop = this.loops.get(recording)
      if (!loop && !target) continue
      if (!loop) {
        const gain = context.createGain()
        gain.gain.value = 0
        gain.connect(context.destination)
        loop = { gain }
        this.loops.set(recording, loop)
      }
      loop.gain.gain.setTargetAtTime(target, context.currentTime, .06)
      if (!target || loop.source || loop.loading) continue
      const track = loop
      track.loading = this.load(context, recording, track).catch(error => {
        if (!this.disposed) console.warn('Could not load the rain recording.', error)
      }).finally(() => { track.loading = undefined })
    }
  }

  private async load(context: AudioContext, recording: RainRecording, loop: Loop) {
    const response = await fetch(recordings[recording].url, { signal: this.abort.signal })
    if (!response.ok) throw new Error('Rain recording unavailable (' + response.status + ')')
    const buffer = await context.decodeAudioData(await response.arrayBuffer())
    if (this.disposed) return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.loopEnd = buffer.duration
    source.connect(loop.gain)
    source.start()
    loop.source = source
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.silenceTimer)
    this.abort.abort()
    window.removeEventListener('pointerdown', this.gesture, true)
    window.removeEventListener('pointerup', this.gesture, true)
    window.removeEventListener('keydown', this.gesture, true)
    document.removeEventListener('visibilitychange', this.sync)
    for (const loop of this.loops.values()) {
      loop.source?.stop()
      loop.source?.disconnect()
      loop.gain.disconnect()
    }
    this.loops.clear()
    if (this.context) void this.context.close().catch(() => {})
  }
}
