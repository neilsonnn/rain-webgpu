import type { DataTexture, Vector2 } from 'three'
import type { GlassSettings } from '../earlier/settings'
import { optics } from '../earlier/settings'
import { rainNoise } from './weather'

export interface RainTerrain {
  texture?: DataTexture
  grid?: { origin: Vector2; warp: { value: number } }
  sample(x: number, y: number, radius: number): { x: number; y: number; pinning: number }
}

// Filter the SAME height texture used by the glass optics over a bead's contact
// footprint. Microscopic bumps affect contact hysteresis; resolved slopes steer
// the cap. The buried steel is not treated as an exposed obstacle.
export function createRainTerrain(texture: DataTexture, settings: () => GlassSettings,
  grid: { origin: Vector2; warp: { value: number } }): RainTerrain {
  const image = texture.image, bytes = image.data as Uint8Array
  const levels: { size: number; values: Float32Array }[] = []
  function cpuMips() {
    // Fine moving caps sample filtered copies of the same optical relief.
    // Build once, lazily, when the first water reaches the glass.
    levels.push({ size: image.width, values: Float32Array.from({ length: image.width * image.height }, (_, i) => (bytes[i * 4 + 3] / 255 - .5) * .0016) })
    while (levels.at(-1)!.size > 3) {
      const prior = levels.at(-1)!, size = Math.floor(prior.size / 2), values = new Float32Array(size * size)
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * 2 * prior.size + x * 2
        values[y * size + x] = (prior.values[i] + prior.values[i + 1] + prior.values[i + prior.size] + prior.values[i + prior.size + 1]) * .25
      }
      levels.push({ size, values })
    }
  }
  const fract = (v: number) => v - Math.floor(v), result = { x: 0, y: 0, pinning: 1 }
  function height(x: number, y: number, radius: number, s: GlassSettings, level: number) {
    const map = levels[level], tile = optics.textureSize * s.textureScale
    const u = fract(x / tile) * map.size - .5, v = fract(y / tile) * map.size - .5
    const ix = (Math.floor(u) + map.size) % map.size, iy = (Math.floor(v) + map.size) % map.size
    const nx = (ix + 1) % map.size, ny = (iy + 1) % map.size, fx = fract(u), fy = fract(v)
    const h = ((map.values[iy * map.size + ix] * (1 - fx) + map.values[iy * map.size + nx] * fx) * (1 - fy)
      + (map.values[ny * map.size + ix] * (1 - fx) + map.values[ny * map.size + nx] * fx) * fy) * s.relief
    if (s.gridRelief <= 0) return h
    const dx = (fract((x - grid.origin.x - Math.sin(y * 7.1) * grid.warp.value) / s.wireSpacing + .5) - .5) * s.wireSpacing
    const dy = (fract((y - grid.origin.y - Math.sin(x * 6.3) * grid.warp.value) / s.wireSpacing + .5) - .5) * s.wireSpacing
    const width = Math.hypot(s.gridWidth, radius * .5), amplitude = s.gridWidth / width
    const cx = Math.exp(-.5 * (dx / width) ** 2), cy = Math.exp(-.5 * (dy / width) ** 2)
    return h + s.gridRelief * amplitude * (cx + cy - cx * cy) * (1 + s.gridPebbling * Math.max(-.6, Math.min(.6, h / .0008)))
  }
  return { texture, grid, sample(x, y, radius) {
    if (!levels.length) cpuMips()
    const s = settings(), footprint = Math.max(.0005, radius * .7)
    const level = Math.max(0, Math.min(levels.length - 1, Math.floor(Math.log2(footprint * image.width / (optics.textureSize * s.textureScale)))))
    result.x = (height(x + footprint, y, radius, s, level) - height(x - footprint, y, radius, s, level)) / (2 * footprint)
    result.y = (height(x, y + footprint, radius, s, level) - height(x, y - footprint, radius, s, level)) / (2 * footprint)
    result.pinning = .7 + .65 * rainNoise(x * 85, y * 85, 8.9) + Math.max(0, -result.y) * 1.5
    return result
  } }
}
