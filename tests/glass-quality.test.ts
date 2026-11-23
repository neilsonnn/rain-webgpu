import { afterEach, expect, it, vi } from 'vitest'
import { defaultQuality, fillGlassDisks, loadQuality, maxGlassRays, supportedWireSamples } from '../src/glass/quality'

afterEach(() => vi.unstubAllGlobals())

it('covers the whole scattering lobe even when only a few rays are used', () => {
  const disk = new Float32Array(maxGlassRays * 4)
  for (const rays of [48, 1, 7, 12, 24]) {
    fillGlassDisks(disk, rays)
    for (let i = 0; i < rays; i++) {
      const [x, y, u, v] = disk.subarray(4*i, 4*i+4)
      expect(x*x + y*y).toBeCloseTo((i + .5) / rays, 6)
      expect(Math.hypot(u, v)).toBeLessThan(1)
    }
  }
})

it('keeps valid local settings while falling back for unsafe counts', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{"rays":12,"depthSteps":0,"waterSize":90000}' })
  expect(loadQuality()).toEqual({ ...defaultQuality, rays: 12 })
})

it('offers wire coverage levels supported by both color and depth', () => {
  expect(supportedWireSamples(new Int32Array([8,4,2]), new Int32Array([4,2]))).toEqual([1,2,4])
  expect(supportedWireSamples(null, new Int32Array([4]))).toEqual([1])
})
