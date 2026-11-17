import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaults, loadGlassSettings, normalizeGlassSettings, referenceLook, saveGlassSettings, steelRefinement, wiredPatternedGlass } from '../src/glass/settings'
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

describe('glass tuning persistence', () => {
  it('restores custom optical and grading controls after a refresh', () => {
    const tuned = { ...defaults, relief: 1.2, diffusion: .23, contrast: 1.5, saturation: .44, wireSpacing: .025 }
    saveGlassSettings(tuned)
    expect(loadGlassSettings()).toEqual(tuned)
  })
  it('adds new surface controls without replacing an earlier saved grade', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ referenceVersion: defaults.referenceVersion, diffusion: .21, contrast: 1.4, saturation: .52 }) })
    const restored = loadGlassSettings()
    expect(restored.diffusion).toBe(.21)
    expect(restored.contrast).toBe(1.4)
    expect(restored.saturation).toBe(.52)
    expect(restored.surfaceRoughness).toBe(defaults.surfaceRoughness)
    expect(restored.gridRelief).toBe(defaults.gridRelief)
    expect(restored.embeddedMesh).toBe(true)
  })
  it('adopts wired glass from the earlier raised-grid model while preserving custom tuning', () => {
    const { constructionVersion: _previousVersion, ...legacy } = {
      ...defaults, embeddedMesh: false, gridRelief: .0006,
      exposure: 1.1, relief: 1.05, diffusion: .27, contrast: 1.4, saturation: .49,
      wireSpacing: .024, wireRadius: .00045,
    }
    // An open page can still hold the legacy shape during hot refresh.
    const expected = { ...legacy, ...wiredPatternedGlass }
    expect(normalizeGlassSettings(legacy)).toEqual(expected)
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) })
    expect(loadGlassSettings()).toEqual(expected)
  })
  it('keeps deliberate mesh and embossing experiments after the construction update', () => {
    const experiment = { ...defaults, embeddedMesh: false, gridRelief: .0003, contrast: 1.35 }
    saveGlassSettings(experiment)
    expect(loadGlassSettings()).toEqual(experiment)
  })
  it('applies the reference look once while preserving camera, pane thickness and grid pitch', () => {
    const { referenceVersion: _previousLook, ...previous } = {
      ...defaults, playing: false, drift: .2, breeze: .35,
      thickness: .008, wireSpacing: .025, wireRadius: .0005,
      contrast: 1.05, reflectionStrength: .4, skyFill: .6, recessBrightness: .9,
    }
    const updated = normalizeGlassSettings(previous)
    expect(updated).toEqual({ ...previous, ...referenceLook })
    const retuned = { ...updated, contrast: 1.16, reflectionStrength: .75, skyFill: .3, recessBrightness: .5 }
    saveGlassSettings(retuned)
    expect(loadGlassSettings()).toEqual(retuned)
  })
  it('updates steel heft and glass sheen without overwriting a custom grade from the previous pass', () => {
    const previous = { ...defaults, referenceVersion: 1, wireRadius: .00038, relief: 1, surfaceRoughness: .055,
      reflectionStrength: 1.05, contrast: 1.18, saturation: .65, diffusion: .28 }
    expect(normalizeGlassSettings(previous)).toEqual({ ...previous, ...steelRefinement })
  })
  it('falls back safely when storage is unavailable and clamps invalid divisors', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ wireSpacing: 0, depthScale: 0, gridWidth: 0, ior: 0, contrast: 'broken' }) })
    const restored = loadGlassSettings()
    expect(restored.wireSpacing).toBeGreaterThan(0)
    expect(restored.depthScale).toBeGreaterThan(0)
    expect(restored.gridWidth).toBeGreaterThan(0)
    expect(restored.ior).toBeGreaterThan(1)
    expect(restored.contrast).toBe(defaults.contrast)
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled') }, setItem: () => { throw new Error('disabled') } })
    expect(loadGlassSettings()).toEqual(defaults)
    expect(() => saveGlassSettings(defaults)).not.toThrow()
  })
})
