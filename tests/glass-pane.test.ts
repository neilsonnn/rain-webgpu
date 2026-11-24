import { describe, expect, it } from 'vitest'
import { Box3, DataTexture, Matrix4, MeshPhysicalMaterial, Raycaster, Vector3 } from 'three'
import { createPane, standalonePaneSize } from '../src/glass/earlier/pane'
import { createWireGrid } from '../src/glass/earlier/wire'
import { defaults } from '../src/glass/earlier/settings'
import { arrangements } from '../src/glass/earlier/arrangements'
import { createGlassMaterial } from '../src/glass/earlier/material'

describe('finite wired pane', () => {
  it('keeps procedural crests on the wire centerlines when pane center, pitch, or gauge changes', () => {
    const map = new DataTexture(), matrix = new Matrix4(), point = new Vector3()
    for (const centerY of [0, 1.75, 1.8]) {
      const grid = createWireGrid(3.3, 3.5, centerY)
      const glass = createGlassMaterial(map, map, map, map, map, map, grid.surfaceGrid)
      try {
        for (const wireSpacing of [.018, .034, .07]) for (const wireRadius of [.0002, .0009]) {
          grid.update({ ...defaults, wireSpacing, wireRadius })
          glass.uniforms.uGridPitch.value = wireSpacing
          const origin = glass.uniforms.uGridOrigin.value, warp = glass.uniforms.uGridWarp.value
          for (let index = 0; index < grid.mesh.count; index++) {
            grid.mesh.getMatrixAt(index, matrix)
            const vertical = Math.abs(matrix.elements[5]) > Math.abs(matrix.elements[4])
            for (const along of [-.4, 0, .4]) {
              point.set(0, along, 0).applyMatrix4(matrix)
              // Evaluate the strand's actual shader deformation, then compare
              // it with the crest phase supplied to the glass material.
              if (vertical) point.x += Math.sin(point.y * 7.1) * wireRadius * .28
              else point.y += Math.sin(point.x * 6.3) * wireRadius * .28
              const phase = vertical ? point.x - origin.x - Math.sin(point.y * 7.1) * warp
                : point.y - origin.y - Math.sin(point.x * 6.3) * warp
              expect(Math.abs(phase / wireSpacing - Math.round(phase / wireSpacing))).toBeLessThan(1e-5)
            }
          }
        }
      } finally { grid.dispose(); glass.material.dispose() }
    }
    const original = createGlassMaterial(map, map, map, map, map, map)
    expect(original.uniforms.uGridOrigin.value.toArray()).toEqual([0, 0])
    expect(original.uniforms.uGridWarp.value).toBe(-.00008)
    original.material.dispose(); map.dispose()
  })
  const paneSizes = [
    { label: 'standalone', size: standalonePaneSize },
    { label: 'canopy', size: arrangements.canopy.pane },
  ]

  it.each(paneSizes)('keeps the physical cut edges and front-facing glass on the $label pane', ({ size }) => {
    const material = new MeshPhysicalMaterial()
    const pane = createPane(material, size)
    try {
      for (const thickness of [.006, .012]) {
        pane.update({ ...defaults, thickness }); pane.group.updateMatrixWorld(true)
        const bounds = new Box3().setFromObject(pane.group)
        expect(bounds.min.x).toBeCloseTo(-size.width / 2, 6)
        expect(bounds.max.x).toBeCloseTo(size.width / 2, 6)
        expect(bounds.min.y).toBeCloseTo(size.centerY - size.height / 2, 6)
        expect(bounds.max.y).toBeCloseTo(size.centerY + size.height / 2, 6)
        expect(bounds.min.z).toBeCloseTo(-thickness, 6)
        expect(bounds.max.z).toBeCloseTo(0, 6)
        const frontRay = new Raycaster(new Vector3(.13, size.centerY, 1), new Vector3(0, 0, -1))
        const backRay = new Raycaster(new Vector3(.13, size.centerY, -1), new Vector3(0, 0, 1))
        expect(frontRay.intersectObject(pane.group).map(hit => hit.object)).toEqual([pane.front])
        expect(backRay.intersectObject(pane.group)).toHaveLength(0)
      }
    } finally { pane.dispose(); material.dispose() }
  })
  it.each(paneSizes)('ends both wire families at the edges of the $label pane', ({ size }) => {
    const grid = createWireGrid(size.width, size.height, size.centerY)
    const matrix = new Matrix4(), vertex = new Vector3()
    try {
      for (const wireSpacing of [.018, .034, .07]) {
        grid.update({ ...defaults, wireSpacing })
        const mesh = grid.mesh, positions = mesh.geometry.getAttribute('position')
        const edgeClearance = defaults.wireRadius * 1.28
        expect(mesh.count).toBe(2 + 2 * (Math.floor((size.width / 2 - edgeClearance) / wireSpacing) + Math.floor((size.height / 2 - edgeClearance) / wireSpacing)))
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (let instance = 0; instance < mesh.count; instance++) {
          mesh.getMatrixAt(instance, matrix)
          for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix)
            minX = Math.min(minX, vertex.x); maxX = Math.max(maxX, vertex.x)
            minY = Math.min(minY, vertex.y); maxY = Math.max(maxY, vertex.y)
          }
        }
        expect(minX).toBeGreaterThanOrEqual(-size.width / 2 - 1e-6)
        expect(maxX).toBeLessThanOrEqual(size.width / 2 + 1e-6)
        expect(minY).toBeGreaterThanOrEqual(size.centerY - size.height / 2 - 1e-6)
        expect(maxY).toBeLessThanOrEqual(size.centerY + size.height / 2 + 1e-6)
      }
    } finally { grid.dispose() }
  })
})
