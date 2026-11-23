import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { conductorF0, dielectricFresnel, diffusionDistance, embeddedWireDepth, iron } from '../src/glass/optics'
import { defaults, physicalDepth } from '../src/glass/settings'
import { createWireGrid } from '../src/glass/wire'

describe('glass construction and optical invariants', () => {
  it('matches normal-incidence Fresnel, vanishes for equal media, and tends to full reflection at grazing angles', () => {
    expect(dielectricFresnel(1, 1, 1.52)).toBeCloseTo(.04257999496, 8)
    for (const angle of [0, .2, .5, .9]) expect(dielectricFresnel(Math.cos(angle), 1.52, 1.52)).toBeCloseTo(0, 10)
    expect(dielectricFresnel(.00001, 1, 1.52)).toBeGreaterThan(.999)
  })
  it('conserves energy and produces total internal reflection above the glass-air critical angle', () => {
    const critical = Math.asin(1 / 1.52)
    expect(dielectricFresnel(Math.cos(critical + .01), 1.52, 1)).toBe(1)
    expect(dielectricFresnel(Math.cos(critical - .01), 1.52, 1)).toBeLessThan(1)
    for (let cosine = .01; cosine <= 1; cosine += .01) {
      const reflected = dielectricFresnel(cosine, 1, 1.52)
      expect(reflected).toBeGreaterThanOrEqual(0); expect(reflected).toBeLessThanOrEqual(1)
      const transmittedCosine = Math.sqrt(1 - (1 - cosine * cosine) / 1.52 ** 2)
      expect(dielectricFresnel(transmittedCosine, 1.52, 1)).toBeCloseTo(reflected, 8)
    }
  })
  it('uses immersed iron optical constants for the steel rather than a painted bright line', () => {
    for (let i = 0; i < 3; i++) {
      const inAir = conductorF0(iron.n[i], iron.k[i], 1)
      const inGlass = conductorF0(iron.n[i], iron.k[i], 1.52)
      expect(inGlass).toBeGreaterThan(.3); expect(inGlass).toBeLessThan(.5); expect(inGlass).toBeLessThan(inAir)
    }
  })
  it('recovers linear physical depth and strongly broadens the distant reference response', () => {
    const p = physicalDepth, s = defaults
    for (const gap of [0, .001, .1, .5, 2, 8]) expect(diffusionDistance(gap, p.depthStrength, p.depthScale, p.depthCurve, p.clearDepth)).toBeCloseTo(gap, 12)
    expect(diffusionDistance(s.clearDepth, s.depthStrength, s.depthScale, s.depthCurve, s.clearDepth)).toBe(0)
    expect(diffusionDistance(3, s.depthStrength, s.depthScale, s.depthCurve, s.clearDepth)).toBeGreaterThan(9)
    const near = diffusionDistance(.2, s.depthStrength, s.depthScale, s.depthCurve, s.clearDepth)
    const far = diffusionDistance(2, s.depthStrength, s.depthScale, s.depthCurve, s.clearDepth)
    expect(far / near).toBeGreaterThan(25)
  })
  it('instances one opaque quad per strand and embeds both families within the slab', () => {
    const grid = createWireGrid(1), matrix = new Matrix4(), vertex = new Vector3()
    for (const thickness of [.006, .012]) for (const wireRadius of [.0002, .0009]) for (const wireDepth of [.15, .85]) {
      const s = { ...defaults, thickness, wireRadius, wireDepth, relief: 1.5, rearRelief: 1.5 }
      grid.update(s)
      const depth = embeddedWireDepth(thickness, wireRadius, wireDepth, s.relief, s.rearRelief)
      expect(depth).toBeGreaterThan(wireRadius)
      const mesh = grid.mesh, positions = mesh.geometry.getAttribute('position')
      expect(positions.count).toBe(4)
      expect(mesh.geometry.index?.count).toBe(6)
      expect(mesh.material.transparent).toBe(false)
      expect(mesh.material.depthWrite).toBe(true)
      for (const instance of [0, mesh.count - 1]) {
        mesh.getMatrixAt(instance, matrix)
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix)
          expect(vertex.z + wireRadius).toBeLessThanOrEqual(-.0008 * s.relief + 1e-8)
          expect(vertex.z - wireRadius).toBeGreaterThanOrEqual(-thickness + .0008 * s.rearRelief - 1e-8)
        }
      }
    }
    grid.dispose()
  })
})
