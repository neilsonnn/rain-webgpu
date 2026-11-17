import type { Texture, WebGLRenderer } from 'three'

export const fluidBudget = { resolution: 1024, optical: 2048, beads: 6144, brushes: 8, maxSteps: 6, step: 1/120 } as const
// The persistent reservoir and continuous caps share one volume ledger. GPU
// compute reconstructs their joined optical surface at twice the film scale.
export interface FluidBatch {
  parameters: Float32Array<ArrayBuffer>
  shapes: Float32Array<ArrayBuffer>
  count: number
  film: Float32Array<ArrayBuffer>
  revision: number
}
export interface FluidBackend {
  readonly kind: 'WebGPU' | 'WebGL2'
  readonly texture: Texture
  readonly lost: boolean
  render(batch: FluidBatch, renderer: WebGLRenderer): void
  dispose(): void
}
