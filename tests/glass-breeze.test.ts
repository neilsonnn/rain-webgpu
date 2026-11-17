import { describe, expect, it } from 'vitest'
import { Color, InstancedMesh, Matrix4, Vector3 } from 'three'
import { arrangements } from '../src/glass/earlier/arrangements'
import { bladeAt, branchAt, breezeMax, breezeResponse } from '../src/glass/earlier/breeze'
import { createFoliage, growGarden } from '../src/glass/earlier/foliage'
import { normalizeGlassSettings } from '../src/glass/earlier/settings'

describe('layered canopy breeze', () => {
  it('uses sparse branching on the left and a fuller right canopy without a distant foliage blanket', () => {
    const garden = growGarden('canopy'), repeat = growGarden('canopy')
    const left = garden.leaves.filter(leaf => garden.plants[leaf.plant].root.x < 0)
    const right = garden.leaves.filter(leaf => garden.plants[leaf.plant].root.x > 0)
    expect(arrangements.canopy.motion).toBe('breeze')
    expect(arrangements['canopy-v4'].motion).toBe('split')
    expect(left.length).toBeGreaterThan(20)
    expect(right.length).toBeGreaterThan(left.length * 2.5)
    expect(garden.plants).toHaveLength(7)
    expect(garden.plants.every(plant => plant.root.z > -1.2)).toBe(true)
    expect(garden.leaves.map(leaf => leaf.position.toArray())).toEqual(repeat.leaves.map(leaf => leaf.position.toArray()))
    expect(new Set(garden.leaves.map(leaf => leaf.species)).size).toBe(3)
    expect(garden.leaves.filter(leaf => leaf.direction.y < 0).length).toBeGreaterThan(garden.leaves.length * .2)
    expect(garden.leaves.some(leaf => leaf.direction.z > .5)).toBe(true)
    expect(garden.leaves.some(leaf => leaf.direction.z < -.5)).toBe(true)
    for (const leaf of garden.leaves) expect(garden.stems.some(stem => stem.points.at(-1) === leaf.position)).toBe(true)
  })
  it('keeps the root and petiole attachment fixed, holds still at zero, and adds independent leaf motion', () => {
    const root = new Vector3(.9, -.2, -.4), bladeBase = new Vector3(0, 0, 0), tip = new Vector3(.1, .9, -.06)
    for (const height of [2.9, -1.3]) for (const time of [0, 4.2, 19.8]) for (const strength of [0, .65, 5]) {
      expect(branchAt(root, root, height, time, strength, false).distanceTo(root)).toBe(0)
      expect(bladeAt(bladeBase, time, strength, 2, .4, false).length()).toBe(0)
    }
    expect(bladeAt(tip, 12, 0, 1, .5, false).distanceTo(tip)).toBe(0)
    expect(branchAt(tip, root, 2.9, 12, 0, false).distanceTo(tip)).toBe(0)
    expect(bladeAt(tip, 4, .65, 1, .5, false).distanceTo(bladeAt(tip, 4, .65, 3, .5, false))).toBeGreaterThan(.005)
    expect(breezeResponse(5)).toBeGreaterThan(breezeResponse(1.5))
    expect(breezeResponse(500)).toBe(breezeResponse(5))
    expect(normalizeGlassSettings({ arrangement: 'canopy', breeze: 5 }).breeze).toBe(breezeMax)
    expect(normalizeGlassSettings({ arrangement: 'canopy-v4', breeze: 5 }).breeze).toBe(1.5)
  })
  it('keeps moving curved blades behind the pane at the full breeze range and retains near/far layers on each side', () => {
    const foliage = createFoliage('canopy'), matrix = new Matrix4(), vertex = new Vector3()
    const nearFronts: number[][] = [[], []], farFronts: number[][] = [[], []]
    try {
      for (const mesh of foliage.group.children) if (mesh instanceof InstancedMesh) {
        const positions = mesh.geometry.getAttribute('position'), anchors = mesh.geometry.getAttribute('plantAnchor')
        const motions = mesh.geometry.getAttribute('leafMotion'), proximity = mesh.geometry.getAttribute('plantNear')
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix)
          const root = new Vector3(anchors.getX(i), anchors.getY(i), anchors.getZ(i)), height = anchors.getW(i), near = proximity.getX(i) > .5
          let restFront = -Infinity, movingFront = -Infinity
          for (let j = 0; j < positions.count; j++) {
            vertex.fromBufferAttribute(positions, j)
            restFront = Math.max(restFront, vertex.clone().applyMatrix4(matrix).z)
            for (const strength of [.65, 2.5, 5]) for (const time of [0, 1.7, 5.3, 17.2, 57.8]) {
              const at = bladeAt(vertex, time, strength, motions.getX(i), motions.getY(i), near).applyMatrix4(matrix)
              movingFront = Math.max(movingFront, branchAt(at, root, height, time, strength, near).z)
            }
          }
          expect(movingFront).toBeLessThanOrEqual((near ? -.02 : -.1) + 1e-6)
          const layer = near ? nearFronts : farFronts
          layer[Number(root.x > 0)].push(restFront)
        }
      }
      for (const side of [0, 1]) {
        expect(nearFronts[side].some(front => front > -.09 && front <= -.035 + 1e-6)).toBe(true)
        expect(farFronts[side].some(front => front < -.6)).toBe(true)
      }
      // Retreatment moves shared endpoints, so petioles remain attached.
      for (const leaf of foliage.leaves) expect(foliage.stems.some(stem => stem.points.at(-1) === leaf.position)).toBe(true)
    } finally { foliage.dispose() }
  })
  it('varies wax finish and greens with a small minority of yellow outliers', () => {
    const foliage = createFoliage('canopy'), color = new Color(), hues: number[] = [], lights: number[] = []
    try {
      for (const mesh of foliage.group.children) if (mesh instanceof InstancedMesh) {
        const ages = mesh.geometry.getAttribute('leafMotion'), values: number[] = []
        for (let i = 0; i < mesh.count; i++) {
          mesh.getColorAt(i, color)
          const hsl = color.getHSL({ h: 0, s: 0, l: 0 })
          hues.push(hsl.h); lights.push(hsl.l); values.push(ages.getY(i))
        }
        expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(.7)
      }
      const yellow = hues.filter(hue => hue < .16)
      expect(yellow.length).toBeGreaterThan(3)
      expect(yellow.length).toBeLessThan(hues.length * .18)
      expect(Math.max(...lights) - Math.min(...lights)).toBeGreaterThan(.2)
    } finally { foliage.dispose() }
  })
})
