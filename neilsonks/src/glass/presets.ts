import projectPresets from './default-presets.json'
import type { GlassSettings } from './settings'
import { arrangements } from './earlier/arrangements'
import type { Arrangement } from './earlier/arrangements'

export type { Arrangement } from './earlier/arrangements'
export type PresetKey = 'current' | `earlier:${Arrangement}`
export const presetKeys: PresetKey[] = ['current', ...Object.keys(arrangements).map(key => `earlier:${key}` as PresetKey)]
export function presetKey(version: 'current' | 'earlier', arrangement: Arrangement): PresetKey {
  return version === 'current' ? 'current' : `earlier:${arrangement}`
}
const localKey = (key: PresetKey) => `neilsonks:glass:defaults:${key}:v1`

// Keep shared source presets small; each arrangement retains its own tuning.
export function savedDefaults(key: PresetKey, factory: GlassSettings): GlassSettings {
  let local: unknown
  try { local = JSON.parse(localStorage.getItem(localKey(key)) ?? 'null') } catch { /* Source defaults still work without storage. */ }
  const source = (projectPresets as Partial<Record<PresetKey, Partial<GlassSettings>>>)[key]
  const candidate = { ...source, ...(local && typeof local === 'object' ? local : {}) }
  const entries = Object.entries(candidate).filter(([field, value]) => Object.hasOwn(factory, field)
    && typeof value === typeof factory[field as keyof GlassSettings]
    && (typeof value !== 'number' || Number.isFinite(value)))
  return { ...factory, ...Object.fromEntries(entries), arrangement: factory.arrangement }
}

export async function saveDefaults(key: PresetKey, settings: GlassSettings) {
  if (import.meta.env.DEV) {
    const response = await fetch('/__glass/defaults', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, settings }),
    })
    if (!response.ok) throw new Error('The project defaults could not be saved. Try again.')
  }
  try { localStorage.setItem(localKey(key), JSON.stringify(settings)) }
  catch { if (!import.meta.env.DEV) throw new Error('Browser storage is unavailable. Defaults could not be saved.') }
}
