import type { FrameTimings } from './performance'
import type { GpuQuality, QualityCaps } from './quality'

export interface GlassView {
  position: [number, number, number]
  target: [number, number, number]
  time: number
}

export interface GlassSceneOptions {
  standalone?: boolean
  centerTaps?: { readonly current: boolean }
  timings?: FrameTimings
  quality?: { readonly current: GpuQuality }
  profileView?: { readonly current: ProfileView }
  onRenderSize?: (width: number, height: number) => void
  onQualityCaps?: (caps: QualityCaps) => void
  gpuAdapter?: GPUAdapter
  onRainBackend?: (backend: 'webgpu') => void
  onBrushHits?: (contact: number, hits: number) => void
}

export type ProfileView = 'scene' | 'garden' | 'meshes'
