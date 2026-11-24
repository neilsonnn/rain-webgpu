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

it('starts existing browsers at 12 rays and the maximum water map while keeping other preferences', () => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key.endsWith(':v1') ? '{"rays":24,"waterSize":768,"pixelRatio":0.75,"shadowSize":4096,"wireSamples":4}' : null,
  })
  expect(loadQuality()).toEqual({ ...defaultQuality, rays: 12, waterSize: 2048, wireSamples: 2, pixelRatio: .75 })
})

it('offers only wire samples supported by both the color and depth buffers', () => {
  const getInternalformatParameter = vi.fn()
    .mockReturnValueOnce(new Int32Array([8, 4, 2]))
    .mockReturnValueOnce(new Int32Array([2]))
  const gl = { RENDERBUFFER: 36161, RGBA16F: 34842, DEPTH_COMPONENT24: 33190, SAMPLES: 32937, getInternalformatParameter }
  expect(supportedWireSamples(gl as unknown as WebGL2RenderingContext)).toEqual([1, 2])
})
