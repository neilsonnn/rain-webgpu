import { describe, expect, it } from 'vitest'
import { DataUtils, HalfFloatType, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three'
import { createFoliage, growFern, growGarden, growPlant, leafGeometry } from '../src/glass/foliage'
import { optics, periodicNoise, random } from '../src/glass/settings'
import { rolledGlassTexture } from '../src/glass/textures'
import { motionLimits } from '../src/glass/dynamics'

describe('procedural greenhouse', () => {
  it('is reproducible and varies between seeds', () => {
    const first = random(19), again = random(19), other = random(20)
    const values = Array.from({ length: 20 }, () => first())
    expect(values).toEqual(Array.from({ length: 20 }, () => again()))
    expect(values).not.toEqual(Array.from({ length: 20 }, () => other()))
    expect(values.every(value => value >= 0 && value < 1)).toBe(true)
  })
  it('tiles the rolled-glass height field continuously in both directions', () => {
    for (const p of [12, 64, 128, 256]) for (const y of [.12, 1.7, 6.1]) {
      expect(periodicNoise(0, y, p, 39)).toBeCloseTo(periodicNoise(p, y, p, 39), 12)
      expect(periodicNoise(y, 0, p, 39)).toBeCloseTo(periodicNoise(y, p, p, 39), 12)
      const epsilon = .0001
      expect(periodicNoise(-epsilon, y, p, 39)).toBeCloseTo(periodicNoise(p - epsilon, y, p, 39), 10)
    }
  })
  it('generates a nonuniform tangent-space normal map at physical glass scale', () => {
    const texture = rolledGlassTexture(128), bytes = texture.image.data
    expect(optics.ior).toBe(1.52)
    expect(optics.thickness).toBe(.006)
    expect(texture.type).toBe(HalfFloatType)
    const red = new Set<number>()
    for (let i = 0; i < bytes.length; i += 4) {
      red.add(bytes[i])
      const normal = [bytes[i], bytes[i + 1], bytes[i + 2]].map(value => DataUtils.fromHalfFloat(value) * 2 - 1)
      expect(Math.hypot(...normal)).toBeCloseTo(1, 2)
      expect(normal[2]).toBeGreaterThan(.5)
    }
    expect(red.size).toBeGreaterThan(20)
    texture.dispose()
  })
  it('attaches every leaf to a petiole and grows finite, reproducible branches', () => {
    const root = new Vector3(.8, 0, -.4), first = growPlant(100, root, 2.65, .7), again = growPlant(100, root, 2.65, .7)
    expect(first.leaves.length).toBeGreaterThan(35)
    expect(first.leaves.map(leaf => leaf.position.toArray())).toEqual(again.leaves.map(leaf => leaf.position.toArray()))
    expect(first.stems[0].points[0].toArray()).toEqual(root.toArray())
    for (const leaf of first.leaves) {
      expect(first.stems.some(stem => stem.points.at(-1)!.distanceTo(leaf.position) < 1e-8)).toBe(true)
      expect(leaf.direction.length()).toBeCloseTo(1, 8)
      expect(leaf.length).toBeGreaterThan(.1)
      expect([...leaf.position.toArray(), ...leaf.direction.toArray()].every(Number.isFinite)).toBe(true)
    }
  })
  it('grows attached fern leaflets and a reproducible mixed garden', () => {
    const fern = growFern(1971, new Vector3(-1.08, .08, -.4)), garden = growGarden(), again = growGarden()
    expect(fern.leaves.length).toBeGreaterThan(100)
    for (const leaf of fern.leaves) {
      expect(fern.stems.some(stem => stem.points.at(-1)!.distanceTo(leaf.position) < 1e-8)).toBe(true)
      expect(leaf.direction.length()).toBeCloseTo(1, 8)
    }
    expect(garden.leaves.map(leaf => leaf.position.toArray())).toEqual(again.leaves.map(leaf => leaf.position.toArray()))
    expect(new Set(garden.leaves.map(leaf => leaf.species))).toEqual(new Set([0, 1, 2, 3]))
    expect(garden.leaves.every(leaf => [...leaf.position.toArray(), leaf.length, leaf.width].every(Number.isFinite))).toBe(true)
  })
  it('keeps curved foreground leaves behind the glass with room for flutter and maximum wind', () => {
    const foliage = createFoliage(), matrix = new Matrix4(), vertex = new Vector3()
    const xAxis = new Vector3(1, 0, 0), yAxis = new Vector3(0, 1, 0)
    let front = -Infinity, stemFront = -Infinity
    try {
      for (const mesh of foliage.group.children) {
        if (mesh instanceof InstancedMesh) {
          const position = mesh.geometry.getAttribute('position')
          const ages = mesh.geometry.getAttribute('leafMotion'), plantIds = mesh.geometry.getAttribute('plantIndex')
          for (let instance = 0; instance < mesh.count; instance++) {
            mesh.getMatrixAt(instance, matrix)
            const root = foliage.uniforms.uPlantRoots.value[plantIds.getX(instance)]
            for (const pitch of [-motionLimits.pitch, 0, motionLimits.pitch]) for (const torsion of [-motionLimits.torsion, 0, motionLimits.torsion]) {
              for (let i = 0; i < position.count; i++) {
                vertex.fromBufferAttribute(position, i)
                const h = vertex.y
                vertex.applyAxisAngle(yAxis, ((ages.getY(instance) - .5) * .24 + torsion) * h * h)
                  .applyAxisAngle(xAxis, pitch * h * h).applyMatrix4(matrix)
                const height = Math.max(0, Math.min(1.2, (vertex.y - root.y) / root.w))
                front = Math.max(front, vertex.z + motionLimits.branchDepth * .5 * height ** 2 * (3 - height))
              }
            }
          }
        } else if (mesh instanceof Mesh) {
          const position = mesh.geometry.getAttribute('position'), ids = mesh.geometry.getAttribute('plantIndex')
          for (let i = 0; i < position.count; i++) {
            const root = foliage.uniforms.uPlantRoots.value[ids.getX(i)]
            const h = Math.max(0, Math.min(1.2, (position.getY(i) - root.y) / root.w))
            stemFront = Math.max(stemFront, position.getZ(i) + motionLimits.branchDepth * .5 * h * h * (3 - h))
          }
        }
      }
      expect(Number.isFinite(front)).toBe(true)
      expect(front).toBeLessThan(-.006)
      expect(Number.isFinite(stemFront)).toBe(true)
      expect(stemFront).toBeLessThan(-.006)
    } finally { foliage.dispose() }
  })
  for (const species of [0, 1, 2, 3]) it(`builds an indexed, curved leaf with finite normals for species ${species}`, () => {
    const geometry = leafGeometry(species), position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal')
    expect(position.count).toBeGreaterThan(100)
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true)
    expect(Array.from(normal.array).every(Number.isFinite)).toBe(true)
    expect(Math.max(...position.array.filter((_, i) => i % 3 === 2)) - Math.min(...position.array.filter((_, i) => i % 3 === 2))).toBeGreaterThan(.08)
    expect(Math.max(...geometry.index!.array)).toBeLessThan(position.count)
    for (let i = 0; i <= 8; i++) expect(new Vector3().fromBufferAttribute(position, i).length()).toBeLessThan(1e-8)
    geometry.dispose()
  })
})
