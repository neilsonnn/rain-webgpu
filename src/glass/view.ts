import type { FrameTimings } from './performance'

export interface GlassView {
  position: [number, number, number]
  target: [number, number, number]
  time: number
}

export interface GlassSceneOptions {
  standalone?: boolean
  suspended?: boolean
  centerTaps?: { readonly current: boolean }
  timings?: FrameTimings
  gpuAdapter?: GPUAdapter
  onRainBackend?: (backend: 'webgpu') => void
  onWaterFlow?: (flow: number) => void
}
