import type { WebGLRenderer } from 'three'

interface FrameSample {
  fps: number
  frame: number
  simulation: number
  render: number
  renderGpu?: number
  stormGpu?: number
  flightHits?: number
  patterHits?: number
}

// Only the small counter subscribes. Publishing twice a second keeps frame
// measurements out of React's scene settings and render loop.
export class FrameTimings {
  expanded = false
  private fineHits = 0
  renderGpu?: number
  stormGpu?: number
  private listeners = new Set<() => void>()
  private sample: FrameSample = { fps: 0, frame: 0, simulation: 0, render: 0 }
  private frames = 0
  private elapsed = 0
  private simulation = 0
  private render = 0
  private rainAt = -1
  private lastFlight = 0
  private lastPatter = 0
  private flightHits?: number
  private patterHits?: number

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  snapshot = () => this.sample
  addFeedbackTime(ms: number) { this.simulation += ms }
  addFineHits(count: number) { this.fineHits += count }
  paneTotals(flight: number, patter: number, now: number) {
    if (!this.expanded || now <= this.rainAt) return
    const seconds = (now - this.rainAt) / 1000
    if (this.rainAt >= 0 && flight >= this.lastFlight && patter >= this.lastPatter) {
      if (seconds < .5) return
      this.flightHits = Math.round((flight - this.lastFlight) / seconds)
      this.patterHits = Math.round((patter - this.lastPatter) / seconds)
    } else this.flightHits = this.patterHits = undefined
    this.rainAt = now; this.lastFlight = flight; this.lastPatter = patter
  }
  reset() {
    this.frames = this.elapsed = this.simulation = this.render = 0
    this.renderGpu = this.stormGpu = undefined
    this.rainAt = -1; this.flightHits = this.patterHits = undefined
    this.fineHits = 0
    this.sample = { fps: 0, frame: 0, simulation: 0, render: 0 }
    this.listeners.forEach(listener => listener())
  }
  record(interval: number, simulation: number, render: number) {
    if (interval <= 0) return
    this.frames++
    this.elapsed += interval
    this.simulation += simulation
    this.render += render
    if (this.elapsed < .5) return
    this.sample = {
      fps: Math.round(this.frames / this.elapsed), frame: this.elapsed * 1000 / this.frames,
      simulation: this.simulation / this.frames, render: this.render / this.frames,
      renderGpu: this.renderGpu, stormGpu: this.stormGpu, flightHits: this.flightHits,
      patterHits: this.patterHits === undefined ? undefined : this.patterHits + Math.round(this.fineHits / this.elapsed),
    }
    this.frames = this.elapsed = this.simulation = this.render = this.fineHits = 0
    this.listeners.forEach(listener => listener())
  }
}

// One reusable timer query. Never wait on the GPU or read an unfinished query.
export function createRenderTimer(renderer: WebGLRenderer, timings?: FrameTimings) {
  const gl = renderer.getContext() as WebGL2RenderingContext
  let ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined
  let query: WebGLQuery | null = null, pending = false, measuring = false, last = -Infinity
  return {
    begin(now: number) {
      if (!timings?.expanded) return
      if (ext === undefined) ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      if (!ext) return
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        if (query) gl.deleteQuery(query)
        query = null; pending = false; timings.renderGpu = undefined
        return
      }
      if (pending && query) {
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return
        timings.renderGpu = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6
        pending = false
      }
      if (now - last < 250) return
      query ??= gl.createQuery()
      if (!query) return
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query); measuring = true; last = now
    },
    end() {
      if (!measuring || !ext) return
      gl.endQuery(ext.TIME_ELAPSED_EXT); measuring = false; pending = true
    },
    dispose() { if (query) gl.deleteQuery(query) },
  }
}
