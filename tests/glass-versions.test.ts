import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstancedBufferAttribute, InstancedMesh, Matrix4, UnsignedByteType, Vector3 } from 'three'
import { glassVersionFromSearch, glassVersionPath, glassVersions } from '../src/glass/versions'
import { createFoliage, growGarden, leafGeometry } from '../src/glass/earlier/foliage'
import { leafTextures, rolledGlassTexture } from '../src/glass/earlier/textures'
import { createFoliage as springFoliage } from '../src/glass/foliage'
import earlierPreset from '../src/glass/earlier/presets/neilson-2026-11-01.json'
import { rainDefaults } from '../src/glass/rain/settings'
import { saveDefaults } from '../src/glass/presets'
import { arrangementFromSearch, arrangements, paneContact } from '../src/glass/earlier/arrangements'
import { createArchitecture } from '../src/glass/earlier/environment'
vi.mock('../src/glass/default-presets.json', () => ({ default: {} }))

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

function leafFronts(model: Pick<ReturnType<typeof springFoliage>, 'group' | 'plants'>) {
  const matrix = new Matrix4(), vertex = new Vector3(), fronts: { front: number; near: boolean }[] = []
  for (const mesh of model.group.children) if (mesh instanceof InstancedMesh) {
    const positions = mesh.geometry.getAttribute('position'), proximity = mesh.geometry.getAttribute('plantNear'), ids = mesh.geometry.getAttribute('plantIndex')
    for (let instance = 0; instance < mesh.count; instance++) {
      mesh.getMatrixAt(instance, matrix)
      let front = -Infinity
      for (let i = 0; i < positions.count; i++) front = Math.max(front, vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix).z)
      fronts.push({ front, near: proximity ? proximity.getX(instance) > .5 : Boolean(model.plants[ids.getX(instance)].paneGap) })
    }
  }
  return fronts
}

describe('independent greenhouse versions', () => {
  it('retains bookmarkable Earlier/Current selection for the local comparison workbench', () => {
    expect(glassVersionFromSearch('')).toBe('current')
    expect(glassVersionFromSearch('?version=unknown')).toBe('current')
    expect(glassVersionFromSearch('?version=earlier')).toBe('earlier')
    for (const version of ['current', 'earlier'] as const) {
      const url = new URL(glassVersionPath(version), 'https://example.test')
      expect(url.pathname).toBe('/glass/')
      expect(glassVersionFromSearch(url.search)).toBe(version)
    }
  })
  it('keeps version tuning separate through save, switch and reload', () => {
    const current = { ...glassVersions.current.defaults, saturation: .41, wireRadius: .0008 }
    const earlier = { ...glassVersions.earlier.defaults, saturation: .8, wireRadius: .0003 }
    glassVersions.current.saveGlassSettings(current)
    glassVersions.earlier.saveGlassSettings(earlier)
    expect(store.size).toBe(2)
    expect(glassVersions.current.loadGlassSettings()).toEqual(current)
    expect(glassVersions.earlier.loadGlassSettings()).toEqual(earlier)
    glassVersions.current.saveGlassSettings({ ...current, contrast: 1.7 })
    expect(glassVersions.earlier.loadGlassSettings()).toEqual(earlier)
  })
  it('loads the captured Earlier tuning by default and preserves it through current migrations', () => {
    const earlier = glassVersions.earlier.defaults
    const captured = { ...rainDefaults, ...earlierPreset.settings, arrangement: 'original', textureScale: 1 }
    expect(glassVersions.earlier.loadGlassSettings()).toEqual(captured)
    glassVersions.earlier.saveGlassSettings(earlier)
    glassVersions.current.saveGlassSettings(glassVersions.current.defaults)
    expect(glassVersions.earlier.loadGlassSettings()).toEqual(earlier)
    expect(glassVersions.earlier.normalizeGlassSettings({})).toEqual(captured)
  })
  it('restores the earlier two-shape planting and byte-precision glass maps', () => {
    const foliage = createFoliage(), map = rolledGlassTexture(32)
    try {
      expect(foliage.leafCount).toBe(1161)
      expect(foliage.group.children.length).toBe(3)
      expect(map.type).toBe(UnsignedByteType)
      expect(map.image.data).toBeInstanceOf(Uint8Array)
    } finally { foliage.dispose(); map.dispose() }
  })
  it('starts the close canopy with existing tuning and keeps Original recoverable through changes and reloads', () => {
    const earlier = glassVersions.earlier
    const original = { ...earlier.defaults, contrast: 1.61, wireRadius: .00063, textureScale: 1.4 }
    earlier.saveGlassSettings(original)
    expect(earlier.loadGlassSettings('canopy')).toEqual({ ...original, arrangement: 'canopy' })
    const canopy = { ...earlier.loadGlassSettings('canopy'), contrast: 1.32, textureScale: 2.1 }
    earlier.saveGlassSettings(canopy)
    expect(earlier.loadGlassSettings('original')).toEqual(original)
    expect(earlier.loadGlassSettings('canopy')).toEqual(canopy)
    expect(earlier.loadGlassSettings('canopy-v1')).toEqual({ ...canopy, arrangement: 'canopy-v1' })
    earlier.saveGlassSettings({ ...earlier.loadGlassSettings('canopy-v1'), textureScale: .9 })
    expect(earlier.loadGlassSettings('canopy').textureScale).toBe(2.1)
    expect(arrangementFromSearch(new URL(glassVersionPath('earlier', 'original'), 'https://example.test').search)).toBe('original')
    expect(arrangementFromSearch('?version=earlier')).toBe('canopy')
  })
  it('saves independent reset defaults and leaves later slider adjustments recoverable', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', request)
    const earlier = glassVersions.earlier
    const defaults = { ...earlier.loadGlassSettings('canopy'), textureScale: 1.75, contrast: 1.46 }
    await saveDefaults('earlier:canopy', defaults)
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ key: 'earlier:canopy', settings: defaults })
    expect(earlier.getDefaults('canopy')).toEqual(defaults)
    expect(earlier.loadGlassSettings('canopy')).toEqual(defaults)
    earlier.saveGlassSettings({ ...defaults, textureScale: .65 })
    expect(earlier.loadGlassSettings('canopy').textureScale).toBe(.65)
    expect(earlier.getDefaults('canopy').textureScale).toBe(1.75)
    expect(earlier.getDefaults('original')).toEqual(earlier.defaults)
    const current = { ...glassVersions.current.defaults, exposure: .7, contrast: 1.71 }
    await saveDefaults('current', current)
    expect(glassVersions.current.loadGlassSettings()).toEqual(current)
  })
  it('reports a failed source save without silently replacing the default preset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const earlier = glassVersions.earlier
    await expect(saveDefaults('earlier:original', { ...earlier.defaults, contrast: 1.1 })).rejects.toThrow()
    expect(earlier.getDefaults('original')).toEqual(earlier.defaults)
  })
  it('layers new near and distant foliage while keeping the old planting and darker broken backdrop selectable', () => {
    const original = createFoliage('original'), canopy = createFoliage('canopy-v1'), backdrop = createArchitecture('canopy')
    try {
      expect(original.leafCount).toBe(1161)
      expect(canopy.leafCount).toBeGreaterThan(original.leafCount)
      expect(canopy.leaves.some(leaf => leaf.position.y > 2.5 && leaf.position.z > -.2)).toBe(true)
      expect(canopy.leaves.some(leaf => leaf.position.y < 1.2 && leaf.position.z > -.2)).toBe(true)
      expect(canopy.leaves.some(leaf => leaf.position.z < -2.5)).toBe(true)
      expect(canopy.uniforms.uPaneContact.value).toBe(1)
      expect(original.uniforms.uPaneContact.value).toBe(0)
      expect(backdrop.group.children.filter(mesh => mesh.name === 'Pale wall patch')).toHaveLength(4)
      expect(arrangements.canopy.skyFill).toBeLessThan(arrangements.original.skyFill)
      expect(arrangements.canopy.environment).toBeLessThan(arrangements.original.environment)
    } finally { original.dispose(); canopy.dispose(); backdrop.dispose() }
  })
  it('compares spring motion on the left with original sway on the right using the same leaf models', () => {
    const left = growGarden('canopy-v4', 'left'), right = growGarden('canopy-v4', 'right')
    expect(left.plants.every(plant => plant.root.x < 0)).toBe(true)
    expect(right.plants.every(plant => plant.root.x >= 0)).toBe(true)
    expect(left.leaves.length).toBeLessThan(right.leaves.length)
    expect(left.leaves.length + right.leaves.length).toBeLessThan(300)
    expect(left.plants.every(plant => plant.root.z > -1.2)).toBe(true)
    const plants = springFoliage({ garden: left, geometry: leafGeometry, textures: leafTextures, earlierLook: true, windScale: arrangements['canopy-v4'].windScale })
    try {
      for (let i = 0; i < 240; i++) plants.update(1 / 60, 1)
      expect(plants.uniforms.uBranchBend.value.some(bend => bend.length() > 1e-6)).toBe(true)
      const attributes = plants.group.children.filter(mesh => mesh instanceof InstancedMesh).map(mesh => mesh.geometry.getAttribute('leafDynamics') as InstancedBufferAttribute)
      expect(attributes.some(attribute => Array.from(attribute.array).some(value => Math.abs(value) > 1e-6))).toBe(true)
      const versions = attributes.map(attribute => attribute.version)
      plants.update(0, 1.5)
      expect(attributes.map(attribute => attribute.version)).toEqual(versions)
      expect(plants.uniforms.uBranchBend.value.every(bend => Number.isFinite(bend.length()))).toBe(true)
    } finally { plants.dispose() }
  })
  it('keeps the revised canopy curved and back from the glass, with more visible pale backdrop', () => {
    const canopy = createFoliage('canopy')
    const currentBackdrop = createArchitecture('canopy'), previousBackdrop = createArchitecture('canopy-v1')
    try {
      const far = leafFronts(canopy).filter(leaf => !leaf.near)
      expect(Math.max(...far.map(leaf => leaf.front)) + .056).toBeLessThanOrEqual(-.1 + 1e-6)
      expect(canopy.uniforms.uPaneContact.value).toBe(0)
      const area = (group: typeof currentBackdrop.group) => group.children
        .filter(mesh => mesh.name === 'Pale wall patch').reduce((total, mesh) => {
          const geometry = (mesh as InstancedMesh).geometry
          geometry.computeBoundingBox()
          return total + geometry.boundingBox!.getSize(new Vector3()).x * geometry.boundingBox!.getSize(new Vector3()).y
        }, 0)
      expect(area(currentBackdrop.group)).toBeGreaterThan(area(previousBackdrop.group) * 1.8)
    } finally { canopy.dispose(); currentBackdrop.dispose(); previousBackdrop.dispose() }
  })
  it('places curved leaves close to the glass on both sides while retaining farther foliage and limited depth motion', () => {
    const right = createFoliage('canopy-v4'), left = springFoliage({ garden: growGarden('canopy-v4', 'left'),
      geometry: leafGeometry, textures: leafTextures, earlierLook: true, windScale: arrangements['canopy-v4'].windScale })
    try {
      for (const plant of [left, right]) {
        const fronts = leafFronts(plant)
        expect(fronts.some(leaf => leaf.near && leaf.front > -.075)).toBe(true)
        expect(fronts.some(leaf => !leaf.near && leaf.front < -.3)).toBe(true)
        expect(fronts.every(leaf => leaf.front <= -.035 + 1e-6)).toBe(true)
        expect(plant.plants.some(body => body.paneGap === .02)).toBe(true)
      }
      for (let i = 0; i < 300; i++) left.update(1 / 60, 1.5)
      for (const mesh of left.group.children) if (mesh instanceof InstancedMesh) {
        const ids = mesh.geometry.getAttribute('plantIndex'), dynamics = mesh.geometry.getAttribute('leafDynamics')
        for (let i = 0; i < mesh.count; i++) if (left.plants[ids.getX(i)].paneGap) {
          expect(Math.abs(dynamics.getX(i))).toBeLessThanOrEqual(.18 * .2 + 1e-6)
          expect(Math.abs(dynamics.getY(i))).toBeLessThanOrEqual(.12 * .2 + 1e-6)
        }
      }
    } finally { left.dispose(); right.dispose() }
  })
  it('retains the previous pressed-leaf contact behavior only in the archived canopy arrangement', () => {
    for (let z = -4; z <= .6; z += .005) {
      const at = paneContact(z)
      expect(at).toBeLessThanOrEqual(-.02)
      if (z <= -.1) expect(at).toBeCloseTo(z, 12)
    }
    const epsilon = 1e-6
    const derivative = (z: number) => (paneContact(z + epsilon) - paneContact(z - epsilon)) / (2 * epsilon)
    expect(derivative(-.1)).toBeCloseTo(1, 4)
    expect(derivative(-.02)).toBeCloseTo(0, 4)
    expect(paneContact(.3)).toBe(-.02)
  })
})
