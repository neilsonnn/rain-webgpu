import type { GlassSettings } from '../settings'
import { savedDefaults } from '../presets'
import type { Arrangement } from '../presets'
import { arrangements } from './arrangements'
import { breezeMax } from './breeze'
import { rainDefaults, normalizeRain } from '../rain/settings'
export type { GlassSettings } from '../settings'

// Earlier renderer with Neilson's live tuning captured on 2026-11-01.
// The complete preset is archived in presets/neilson-2026-11-01.json.
// This renderer has its own storage and never applies current migrations.
export const optics = { ior: 1.52, thickness: .006, wireRadius: .00038, textureSize: .28 } as const
export const defaults: GlassSettings = {
  ...rainDefaults,
  constructionVersion: 1, referenceVersion: 0,
  arrangement: 'original', textureScale: 1,
  playing: true, relief: .8, diffusion: .38, surfaceRoughness: .205,
  gridRelief: 0, gridWidth: .00075, gridPebbling: .65, embeddedMesh: true,
  rearRelief: .55, ior: optics.ior, thickness: optics.thickness,
  depthStrength: 1.65, depthScale: 1.44, depthCurve: 1, clearDepth: .035,
  wireSpacing: .034, wireRadius: optics.wireRadius, wireDepth: .5,
  wireRoughness: .34, wirePatina: .3, breeze: .65, drift: .7,
  exposure: .4, glass: true, contrast: 1.8, saturation: .62,
  blackPoint: .12, whitePoint: .85, temperature: -.06, tint: -.035,
  grain: .009, vignette: .17,
  // Kept in the common UI schema; lighting in this renderer is fixed at the
  // original values and does not consume these later-added controls.
  reflectionStrength: .7, skyFill: .65, recessBrightness: 1,
}

const settingsKey = (arrangement: Arrangement) => arrangement === 'original'
  ? 'neilsonks:glass:earlier:v1' : `neilsonks:glass:earlier:${arrangement}:v1`
export function getDefaults(arrangement: Arrangement = 'original') {
  return savedDefaults(`earlier:${arrangement}`, { ...defaults, arrangement })
}
export function normalizeGlassSettings(saved: Partial<GlassSettings>, base?: GlassSettings): GlassSettings {
  const entries = Object.entries(saved).filter(([key, value]) => Object.hasOwn(defaults, key)
    && typeof value === typeof defaults[key as keyof GlassSettings]
    && (typeof value !== 'number' || Number.isFinite(value)))
  const arrangement: Arrangement = saved.arrangement && Object.hasOwn(arrangements, saved.arrangement) ? saved.arrangement : 'original'
  const settings = { ...(base ?? getDefaults(arrangement)), ...Object.fromEntries(entries), arrangement }
  settings.wireSpacing = Math.max(.018, Math.min(.07, settings.wireSpacing))
  settings.depthScale = Math.max(.1, Math.min(3, settings.depthScale))
  settings.gridWidth = Math.max(.0002, Math.min(.002, settings.gridWidth))
  settings.ior = Math.max(1.01, Math.min(1.8, settings.ior))
  settings.textureScale = Math.max(.35, Math.min(3, settings.textureScale))
  settings.breeze = Math.max(0, Math.min(arrangements[arrangement].motion === 'breeze' ? breezeMax : 1.5, settings.breeze))
  return normalizeRain(settings)
}
export function saveGlassSettings(settings: GlassSettings) {
  try { localStorage.setItem(settingsKey(settings.arrangement), JSON.stringify(normalizeGlassSettings(settings))) } catch { /* Storage may be disabled. */ }
}
export function loadGlassSettings(arrangement: Arrangement = 'original'): GlassSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(settingsKey(arrangement)) ?? 'null')
    if (saved && typeof saved === 'object') return normalizeGlassSettings({ ...saved, arrangement })
    // A new layout starts with the user's existing Earlier grade and optics.
    // Saving it never modifies the Original layout's settings.
    if (arrangement !== 'original') {
      const previous = loadGlassSettings(arrangement.startsWith('canopy-') ? 'canopy' : 'original')
      return normalizeGlassSettings(savedDefaults(`earlier:${arrangement}`, { ...previous, arrangement }))
    }
    return normalizeGlassSettings({ arrangement })
  } catch { return normalizeGlassSettings({ arrangement }) }
}

export function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
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
