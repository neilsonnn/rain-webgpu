import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { gridSideForDensity, matchLocalBuildings } from '../src/city/matching'
import type { MatchInput } from '../src/city/matching'

describe('local city assignment', () => {
  it('changes tile counts without changing the survey extent or allowing tile sharing', () => {
    const centers = new Float32Array([.4, .4, 1, .6, .4, 1, .4, .6, 1, .6, .6, 1])
    const bounds: MatchInput['bounds'] = [0, 1, 0, 1]
    const coarse = matchLocalBuildings({ centers, bounds, radius: 2, side: gridSideForDensity(4, .25) })
    const fine = matchLocalBuildings({ centers, bounds, radius: 2, side: gridSideForDensity(4, 4) })
    expect(coarse.side).toBe(1); expect(fine.side).toBe(4)
    expect(coarse.stats.matched).toBe(1); expect(coarse.stats.unmatched).toBe(3)
    expect(fine.stats.matched).toBe(4); expect(fine.stats.unmatched).toBe(0)
    expect(new Set(fine.tileForBuilding).size).toBe(4)
    for (const result of [coarse, fine]) {
      const tileStep = 1 / result.side
      expect(result.textureSize[0] * result.textureSize[1]).toBeGreaterThanOrEqual(Math.max(4, result.side ** 2))
      expect(result.stats.matched + result.stats.unusedTiles).toBe(result.side ** 2)
      for (let i = 0; i < 4; i++) if (result.tileForBuilding[i] >= 0) {
        expect(result.origins[i * 4 + 2]).toBe(tileStep)
        expect(result.origins[i * 4]).toBeGreaterThanOrEqual(0)
        expect(result.origins[i * 4] + tileStep).toBeLessThanOrEqual(1)
        expect(result.origins[i * 4 + 1] + tileStep).toBeLessThanOrEqual(1)
      }
    }
    expect(gridSideForDensity(256, 1)).toBe(16)
    expect(gridSideForDensity(256, 4)).toBe(32)
    expect(gridSideForDensity(256, 8)).toBe(46)
  })
  it('reconsiders contested tiles instead of stranding a building with only one local choice', () => {
    const result = matchLocalBuildings({ centers: new Float32Array([.9, .5, 1, .1, .5, 1]), side: 2, bounds: [0, 2, 0, 2], radius: .8 })
    expect(Array.from(result.tileForBuilding)).toEqual([1, 0])
    expect(result.stats.matched).toBe(2)
    expect(result.stats.unusedTiles).toBe(2)
  })
  it('never forces a distant match, and does not treat old padding as a building', () => {
    const result = matchLocalBuildings({ centers: new Float32Array([20, 20, 1, .5, .5, 0]), side: 2, bounds: [0, 2, 0, 2], radius: 1 })
    expect(Array.from(result.tileForBuilding)).toEqual([-1, -1])
    expect(Array.from(result.origins.slice(0, 3))).toEqual([20, 20, 0])
    expect(result.stats).toMatchObject({ buildings: 1, matched: 0, unmatched: 1, unusedTiles: 4, maxTravelMeters: 0 })
    expect(result.occupied.every(value => value === 0)).toBe(true)
  })
  for (const file of ['market', 'downtown', 'sf']) {
    it(`preserves a complete grid, unique local matches and every final building in ${file}`, () => {
      const bytes = gunzipSync(readFileSync(`public/data/city/${file}.bin.gz`))
      const header = new Uint32Array(bytes.buffer, bytes.byteOffset, 8), count = header[3], side = header[4]
      const records = new Float32Array(bytes.buffer, bytes.byteOffset + 32, count * 16), centers = new Float32Array(count * 3)
      const tileStep = records[14], span = tileStep * side
      const bounds: MatchInput['bounds'] = [records[0], records[0] + span, records[1], records[1] + span]
      let oldMean = 0, oldMax = 0, buildings = 0
      for (let i = 0; i < count; i++) {
        centers.set([records[i * 16 + 8], records[i * 16 + 9], records[i * 16 + 13]], i * 3)
        if (records[i * 16 + 13] < .5) continue
        const distance = Math.hypot(records[i * 16] + tileStep / 2 - records[i * 16 + 8], records[i * 16 + 1] + tileStep / 2 - records[i * 16 + 9]) * 100
        oldMean += distance; oldMax = Math.max(oldMax, distance); buildings++
      }
      const result = matchLocalBuildings({ centers, side, bounds, radius: 2 }), seen = new Set<number>()
      for (let i = 0; i < count; i++) {
        const tile = result.tileForBuilding[i], origin = result.origins.subarray(i * 4, i * 4 + 4)
        if (tile < 0) {
          // Unmatched buildings start at their own centres, with zero area.
          expect(origin[0]).toBe(centers[i * 3]); expect(origin[1]).toBe(centers[i * 3 + 1]); expect(origin[2]).toBe(0)
        } else {
          expect(centers[i * 3 + 2]).toBe(1); expect(seen.has(tile)).toBe(false); seen.add(tile)
          expect(result.occupied[tile]).toBe(255)
          const distance = Math.hypot(origin[0] + origin[2] / 2 - centers[i * 3], origin[1] + origin[2] / 2 - centers[i * 3 + 1])
          expect(distance).toBeLessThanOrEqual(tileStep * 2 + .00002)
        }
      }
      expect(result.stats.buildings).toBe(buildings)
      expect(result.stats.matched + result.stats.unmatched).toBe(buildings)
      expect(result.stats.matched + result.stats.unusedTiles).toBe(side ** 2)
      expect(result.occupied.filter(value => value === 255).length).toBe(seen.size)
      expect(result.stats.maxTravelMeters).toBeLessThanOrEqual(result.stats.limitMeters + .00001)
      expect(result.stats.meanTravelMeters).toBeLessThan(oldMean / buildings / 4)
      if (file === 'sf') expect(result.stats.maxTravelMeters).toBeLessThan(oldMax / 50)
    })
  }
  it('handles both more and fewer tiles than geometry records on the real Market crop', () => {
    const bytes = gunzipSync(readFileSync('public/data/city/market.bin.gz'))
    const header = new Uint32Array(bytes.buffer, bytes.byteOffset, 8), count = header[3], originalSide = header[4]
    const records = new Float32Array(bytes.buffer, bytes.byteOffset + 32, count * 16), centers = new Float32Array(count * 3)
    const span = records[14] * originalSide, bounds: MatchInput['bounds'] = [records[0], records[0] + span, records[1], records[1] + span]
    for (let i = 0; i < count; i++) centers.set([records[i * 16 + 8], records[i * 16 + 9], 1], i * 3)
    for (const density of [.25, .5, 1, 2, 4, 8]) {
      const side = gridSideForDensity(count, density), result = matchLocalBuildings({ centers, bounds, side, radius: 2 })
      const tiles = Array.from(result.tileForBuilding).filter(tile => tile >= 0)
      expect(new Set(tiles).size).toBe(tiles.length)
      expect(result.stats.matched).toBeLessThanOrEqual(Math.min(count, side ** 2))
      expect(result.stats.matched + result.stats.unmatched).toBe(count)
      expect(result.stats.matched + result.stats.unusedTiles).toBe(side ** 2)
      expect(result.stats.maxTravelMeters).toBeLessThanOrEqual(result.stats.limitMeters + .00001)
      expect(result.textureSize[0] * result.textureSize[1]).toBeGreaterThanOrEqual(Math.max(count, side ** 2))
      expect(result.origins.every(value => Number.isFinite(value))).toBe(true)
    }
  })
})
