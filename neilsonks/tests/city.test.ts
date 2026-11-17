import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { breathProgress, guardedPoint, modes, phases } from '../src/city/motion'
import { decodeCity } from '../src/city/data'
import { defaults } from '../src/city/types'

describe('city morph motion', () => {
  it('holds both endpoints and returns through a smooth breathing cycle', () => {
    expect(breathProgress(0, 18, 1)).toBe(0)
    expect(breathProgress(.9, 18, 1)).toBe(0)
    expect(breathProgress(10, 18, 1)).toBe(1)
    expect(breathProgress(10.9, 18, 1)).toBe(1)
    expect(breathProgress(20, 18, 1)).toBe(0)
    expect(breathProgress(1.001, 18, 1)).toBeLessThan(1e-8)
  })
  it('reaches exact grid and city geometry in every mode, at every wave delay', () => {
    for (const mode of Object.keys(modes) as (keyof typeof modes)[]) for (const r of [0, .3, .8]) {
      expect(phases(0, mode, r, .9)).toEqual({ layout: 0, shape: 0, release: 0, rise: 0 })
      expect(phases(1, mode, r, .9)).toEqual({ layout: 1, shape: 1, release: 1, rise: 1 })
    }
  })
  it('keeps footprint vertices in the moving parcel until all translation is done', () => {
    const rect = [4, 6, 10, 13], center = [5, 11.5], source = [0, 1, 0, 1]
    for (const mode of ['weave', 'ripple'] as const) for (let t = 0; t <= .74; t += .01) {
      const p = phases(t, mode), box = rect.map((x, i) => source[i] + (x - source[i]) * p.layout)
      for (const uv of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const xy = guardedPoint(uv as [number, number], [3, 15], rect, center, .3, p, source)
        expect(xy[0]).toBeGreaterThanOrEqual(box[0] - 1e-9); expect(xy[0]).toBeLessThanOrEqual(box[1] + 1e-9)
        expect(xy[1]).toBeGreaterThanOrEqual(box[2] - 1e-9); expect(xy[1]).toBeLessThanOrEqual(box[3] + 1e-9)
      }
      if (p.release > 0) expect(p.layout).toBe(1)
    }
  })
  it('morphs flow footprints directly while height grows from the start with adjustable easing', () => {
    expect(defaults.mode).toBe('flow'); expect(defaults.guard).toBe(false); expect(defaults.terrain).toBe(0)
    for (const t of [.01, .04, .25, .5, .74, .9, .99]) {
      const p = phases(t, 'flow', .8, .9, defaults.riseEase)
      expect([p.layout, p.shape, p.release]).toEqual([t, t, t])
      expect(p.rise).toBeGreaterThan(0); expect(p.rise).toBeLessThan(t)
      expect(phases(t, 'flow', 0, 0, 1).rise).toBe(t)
    }
  })
})

describe('bundled public city geometry', () => {
  it('maps every square of the compact Market Street study to a real building', () => {
    const bytes = gunzipSync(readFileSync('public/data/city/market.bin.gz'))
    const data = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect(data.side).toBe(16); expect(data.count).toBe(256)
    const records = data.texture.image.data as Float32Array
    const targets = new Set<string>()
    for (let i = 0; i < data.count; i++) {
      expect(records[i * 16 + 13]).toBe(1)
      targets.add(`${records[i * 16 + 8]},${records[i * 16 + 9]}`)
    }
    expect(targets.size).toBe(256)
    expect(data.gridBounds[1] - data.gridBounds[0]).toBeLessThan(9)
    data.geometry.dispose(); data.texture.dispose()
  })
  it('decodes a complete downtown dataset and covers every starting square', () => {
    const bytes = gunzipSync(readFileSync('public/data/city/downtown.bin.gz'))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const data = decodeCity(buffer), g = data.geometry
    expect(data.count).toBe(data.side ** 2)
    // Downtown's square board must occupy downtown's own region, rather than
    // retaining the full city's 14 km extent and travelling from its centre.
    expect(data.gridBounds[1] - data.gridBounds[0]).toBeLessThan(65)
    expect((data.gridBounds[0] + data.gridBounds[1]) / 2).toBeGreaterThan(25)
    expect((data.gridBounds[2] + data.gridBounds[3]) / 2).toBeLessThan(-10)
    const ids = g.getAttribute('cityID'), uv = g.getAttribute('cityUV'), position = g.getAttribute('position'), index = g.index!
    const area = new Float64Array(data.count)
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2)
      expect(Math.max(a, b, c)).toBeLessThan(position.count)
      if (position.getY(a) === 0 || position.getY(b) === 0 || position.getY(c) === 0) continue
      const id = ids.getX(a)
      expect(ids.getX(b)).toBe(id); expect(ids.getX(c)).toBe(id)
      area[id] += Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a))) / 2
    }
    for (const value of area) expect(Math.abs(value - 1)).toBeLessThan(1e-4)
    data.geometry.dispose(); data.texture.dispose()
  })
})
