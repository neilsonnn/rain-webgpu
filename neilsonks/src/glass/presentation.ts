import projectPresets from './default-presets.json'
import { defaults, normalizeGlassSettings } from './earlier/settings'
import { saveDefaults } from './presets'
import type { GlassSettings } from './settings'

const personalKey = 'neilsonks:glass:presentation:original:v1'

// The public artwork uses the source preset Neilson locked in, independently
// of a visitor's old study drafts or browser-specific reset defaults.
export function presentationSettings() {
  const preset = projectPresets['earlier:original']
  const source = normalizeGlassSettings({ ...preset, arrangement: 'original', rainRecording: preset.rainRecording === 'glass' ? 'glass' : 'tin' }, defaults)
  let personal: Partial<GlassSettings> = {}
  if (!import.meta.env.DEV) {
    try { personal = JSON.parse(localStorage.getItem(personalKey) ?? '{}') ?? {} } catch { /* Use the project preset. */ }
  }
  return normalizeGlassSettings({ ...personal, arrangement: 'original' }, source)
}

export async function savePresentationDefaults(settings: GlassSettings) {
  await saveDefaults('earlier:original', settings)
  if (!import.meta.env.DEV) localStorage.setItem(personalKey, JSON.stringify(settings))
}

export function settingsSnapshot(settings: GlassSettings) {
  return JSON.stringify({ schemaVersion: 1, preset: 'earlier:original', settings: { ...settings, arrangement: 'original' } }, null, 2)
}
