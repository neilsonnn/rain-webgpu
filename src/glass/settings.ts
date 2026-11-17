import { savedDefaults } from './presets'
import { rainDefaults, normalizeRain } from './rain/settings'
import type { RainSettings } from './rain/settings'
import type { Arrangement } from './presets'

export interface GlassSettings extends RainSettings {
  // Persisted model revision; lets construction corrections preserve all other tuning.
  constructionVersion: number
  referenceVersion: number
  arrangement: Arrangement
  textureScale: number
  playing: boolean
  relief: number
  diffusion: number
  surfaceRoughness: number
  gridRelief: number
  gridWidth: number
  gridPebbling: number
  embeddedMesh: boolean
  rearRelief: number
  ior: number
  thickness: number
  depthStrength: number
  depthScale: number
  depthCurve: number
  clearDepth: number
  wireSpacing: number
  wireRadius: number
  wireDepth: number
  wireRoughness: number
  wirePatina: number
  breeze: number
  drift: number
  exposure: number
  reflectionStrength: number
  skyFill: number
  recessBrightness: number
  glass: boolean
  contrast: number
  saturation: number
  blackPoint: number
  whitePoint: number
  temperature: number
  tint: number
  grain: number
  vignette: number
}

// Scene dimensions are in metres. Keep optical and artistic parameters separate.
export const optics = { ior: 1.52, thickness: .006, wireRadius: .0007, textureSize: .28 } as const
export const wiredPatternedGlass = { constructionVersion: 1, embeddedMesh: true, gridRelief: 0 } as const
export const steelRefinement = {
  referenceVersion: 2,
  embeddedMesh: true,
  gridRelief: 0,
  wireRadius: optics.wireRadius,
  wireRoughness: .38,
  wirePatina: .14,
  relief: .72,
  surfaceRoughness: .105,
  reflectionStrength: .82,
} as const
export const referenceLook = {
  ...wiredPatternedGlass,
  diffusion: .3,
  rearRelief: .48,
  depthStrength: 1.6,
  depthScale: .6,
  depthCurve: 1.6,
  clearDepth: .025,
  skyFill: .18,
  recessBrightness: .2,
  exposure: .96,
  contrast: 1.3,
  saturation: .58,
  blackPoint: .025,
  whitePoint: .96,
  temperature: -.045,
  tint: -.05,
  grain: .01,
  vignette: .12,
  ...steelRefinement,
} as const
export const defaults: GlassSettings = {
  ...rainDefaults,
  ...referenceLook,
  arrangement: 'original',
  textureScale: 1,
  playing: true,
  gridWidth: .00075,
  gridPebbling: .65,
  ior: optics.ior,
  thickness: optics.thickness,
  wireSpacing: .034,
  wireRadius: optics.wireRadius,
  wireDepth: .5,
  breeze: .65,
  drift: .7,
  glass: true,
}

export const neutralGrade = { contrast: 1, saturation: 1, blackPoint: 0, whitePoint: 1, temperature: 0, tint: 0, grain: 0, vignette: 0 } as const
export const physicalDepth = { depthStrength: 1, depthScale: 1, depthCurve: 1, clearDepth: 0 } as const

const settingsKey = 'neilsonks:glass:settings:v1'
export function getDefaults(_arrangement: Arrangement = 'original') { return savedDefaults('current', defaults) }
export function normalizeGlassSettings(saved: Partial<GlassSettings>): GlassSettings {
  const entries = Object.entries(saved).filter(([key, value]) => Object.hasOwn(defaults, key)
    && typeof value === typeof defaults[key as keyof GlassSettings]
    && (typeof value !== 'number' || Number.isFinite(value)))
  const settings = { ...getDefaults(), ...Object.fromEntries(entries), arrangement: 'original' as const }
  // Earlier tuning used a raised glass lattice with the metal disabled. Adopt
  // the confirmed wired construction once, including during a hot refresh.
  // Later experiments with mesh visibility or embossing remain persistent.
  if (saved.constructionVersion !== wiredPatternedGlass.constructionVersion) Object.assign(settings, wiredPatternedGlass)
  // Apply this requested reference-matching pass once to an already open page.
  // Further adjustments to the new look persist without being reset on reload.
  if (saved.referenceVersion === 1) Object.assign(settings, steelRefinement)
  else if (saved.referenceVersion !== referenceLook.referenceVersion) Object.assign(settings, referenceLook)
  // Keep divisors, optical media, and instance counts in their supported ranges.
  settings.wireSpacing = Math.max(.018, Math.min(.07, settings.wireSpacing))
  settings.depthScale = Math.max(.1, Math.min(3, settings.depthScale))
  settings.gridWidth = Math.max(.0002, Math.min(.002, settings.gridWidth))
  settings.ior = Math.max(1.01, Math.min(1.8, settings.ior))
  settings.textureScale = Math.max(.35, Math.min(3, settings.textureScale))
  settings.reflectionStrength = Math.max(0, Math.min(2.5, settings.reflectionStrength))
  settings.skyFill = Math.max(0, Math.min(.8, settings.skyFill))
  settings.recessBrightness = Math.max(0, Math.min(1.5, settings.recessBrightness))
  return normalizeRain(settings)
}
export function saveGlassSettings(settings: GlassSettings) {
  try { localStorage.setItem(settingsKey, JSON.stringify(normalizeGlassSettings(settings))) } catch { /* Storage may be disabled. */ }
}
export function loadGlassSettings(): GlassSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(settingsKey) ?? 'null')
    if (!saved || typeof saved !== 'object') return normalizeGlassSettings(getDefaults())
    return normalizeGlassSettings(saved)
  } catch { return normalizeGlassSettings(getDefaults()) }
}

export function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ state >>> 15, 1 | state)
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

// Periodic, differentiable value noise makes maps tile without a seam.
export function periodicNoise(x: number, y: number, period: number, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const smooth = (v: number) => v * v * v * (v * (v * 6 - 15) + 10)
  const hash = (a: number, b: number) => {
    let h = Math.imul((a % period + period) % period, 374761393) ^ Math.imul((b % period + period) % period, 668265263) ^ seed
    h = Math.imul(h ^ h >>> 13, 1274126177)
    return ((h ^ h >>> 16) >>> 0) / 4294967295
  }
  const sx = smooth(fx), sy = smooth(fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
}
