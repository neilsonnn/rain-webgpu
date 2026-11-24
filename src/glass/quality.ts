export const maxGlassRays = 48
const maxWaterSurfaceSize = 2048
const integers = (max: number) => Array.from({ length: max }, (_, i) => i + 1)

export const qualityLevels = {
  pixelRatio: [0, .5, .75, 1, 1.25, 1.5, 2],
  rays: integers(maxGlassRays), depthSteps: integers(6), entrySteps: integers(5),
  bounces: [0, 1], reliefFilter: [1, 2, 4, 8, 16],
  wireSamples: [1, 2, 4, 8],
  waterSize: [384, 512, 768, 1024, 1536, maxWaterSurfaceSize], airPercent: [0, 10, 25, 50, 75, 100],
}
export type QualityKey = keyof typeof qualityLevels
export type GpuQuality = Record<QualityKey, number>
export type QualityCaps = Pick<typeof qualityLevels, 'wireSamples' | 'reliefFilter'>
export const defaultQuality: Readonly<GpuQuality> = {
  pixelRatio: 0, // Follow the display until a fixed ratio is chosen.
  rays: 12, depthSteps: 3, entrySteps: 3, bounces: 1, reliefFilter: 8, wireSamples: 2,
  waterSize: maxWaterSurfaceSize, airPercent: 100,
}
const storageKey = 'wire-glass:gpu-quality:v2'
export function loadQuality(): GpuQuality {
  const result = { ...defaultQuality }
  try {
    const current = localStorage.getItem(storageKey)
    const saved = current === null
      ? { ...JSON.parse(localStorage.getItem('wire-glass:gpu-quality:v1') ?? '{}'),
          rays: defaultQuality.rays, wireSamples: defaultQuality.wireSamples, waterSize: defaultQuality.waterSize }
      : JSON.parse(current)
    for (const key of Object.keys(result) as QualityKey[])
      if (qualityLevels[key].includes(saved?.[key])) result[key] = saved[key]
  } catch { /* Storage is optional. */ }
  return result
}
export function storeQuality(quality: GpuQuality) {
  try { localStorage.setItem(storageKey, JSON.stringify(quality)) } catch { /* Keep the live settings. */ }
}
export function supportedLevel(requested: number, levels: readonly number[]) {
  return levels.filter(n => n <= requested).at(-1) ?? 1
}

export function supportedWireSamples(gl: WebGL2RenderingContext): number[] {
  const color = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array | null
  const depth = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) as Int32Array | null
  return qualityLevels.wireSamples.filter(n => n === 1 || (color?.includes(n) && depth?.includes(n)))
}

// Re-stratify the full scattering lobe at each quality, instead of taking a
// biased prefix of the 24-ray pattern. The default reproduces the saved look.
export function fillGlassDisks(out: Float32Array, rays: number) {
  for (let i = 0; i < rays; i++) {
    const x = (i + .5) / rays
    let y = 0
    for (let bit = 0; bit < 6; bit++) y += ((i >> bit) & 1) / 2 ** (bit + 1)
    const frontRadius = Math.sqrt(x), frontAngle = 2 * Math.PI * y
    const rearRadius = Math.sqrt((y + .381966) % 1), rearAngle = 2 * Math.PI * ((x + .754877) % 1)
    out[i*4] = frontRadius * Math.cos(frontAngle); out[i*4+1] = frontRadius * Math.sin(frontAngle)
    out[i*4+2] = rearRadius * Math.cos(rearAngle); out[i*4+3] = rearRadius * Math.sin(rearAngle)
  }
  return out
}
