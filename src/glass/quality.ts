export const maxGlassRays = 48
const integers = (max: number) => Array.from({ length: max }, (_, i) => i + 1)

export const qualityLevels = {
  pixelRatio: [0, .5, .75, 1, 1.25, 1.5, 2],
  rays: integers(maxGlassRays), depthSteps: integers(6), entrySteps: integers(5),
  bounces: [0, 1], reliefFilter: [1, 2, 4, 8, 16],
  wireSamples: [1, 2, 4, 8], shadowTaps: [1, 16, 17], shadowSize: [512, 1024, 2048, 4096],
  waterSize: [384, 512, 768, 1024, 1536, 2048], airPercent: [0, 10, 25, 50, 75, 100],
}
export type QualityKey = keyof typeof qualityLevels
export type GpuQuality = Record<QualityKey, number>
export type QualityCaps = Pick<typeof qualityLevels, 'wireSamples' | 'reliefFilter'>
export const defaultQuality: Readonly<GpuQuality> = {
  pixelRatio: 0, // Follow the display until a fixed ratio is chosen.
  rays: 24, depthSteps: 3, entrySteps: 3, bounces: 1, reliefFilter: 8, wireSamples: 4, shadowTaps: 16, shadowSize: 4096,
  waterSize: 1536, airPercent: 100,
}
const storageKey = 'wire-glass:gpu-quality:v1'
export function loadQuality(): GpuQuality {
  const result = { ...defaultQuality }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    for (const key of Object.keys(result) as QualityKey[])
      if (qualityLevels[key].includes(saved?.[key])) result[key] = saved[key]
  } catch { /* Storage is optional. */ }
  return result
}
export function storeQuality(quality: GpuQuality) {
  try { localStorage.setItem(storageKey, JSON.stringify(quality)) } catch { /* Keep the live settings. */ }
}
export function supportedWireSamples(color: Int32Array | null, depth: Int32Array | null): number[] {
  return qualityLevels.wireSamples.filter(n => n === 1 || (color?.includes(n) && depth?.includes(n)))
}
export function supportedLevel(requested: number, levels: readonly number[]) {
  return levels.filter(n => n <= requested).at(-1) ?? 1
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
