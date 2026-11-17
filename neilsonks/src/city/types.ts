import type { Mode } from './motion'
export interface Settings {
  mode: Mode; progress: number; playing: boolean; duration: number; dwell: number
  height: number; riseEase: number; terrain: number; swell: number; wave: number; gap: number
  matching: 'local' | 'forced'; matchRadius: number; gridDensity: number; unmatched: 'hide' | 'grow'
  guard: boolean; shadows: boolean; wireframe: boolean; ground: boolean; rotate: boolean; epoch: number
}
export const defaults: Settings = {
  mode: 'flow', progress: 0, playing: true, duration: 18, dwell: 1.2,
  height: 1, riseEase: 1.8, terrain: 0, swell: 0, wave: .45, gap: 0,
  matching: 'local', matchRadius: 2, gridDensity: 4, unmatched: 'hide',
  guard: false, shadows: true, wireframe: false, ground: false, rotate: false, epoch: 0,
}
export type View = 'city' | 'downtown' | 'top'
