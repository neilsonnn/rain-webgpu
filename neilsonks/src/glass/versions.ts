import * as current from './settings'
import * as earlier from './earlier/settings'
import type { Arrangement } from './presets'

export type GlassVersion = 'current' | 'earlier'
export const glassVersions = {
  current: { label: 'Current', ...current, loadScene: () => import('./scene') },
  earlier: { label: 'Earlier', ...earlier, loadScene: () => import('./earlier/scene') },
} as const

export function glassVersionFromSearch(search: string): GlassVersion {
  return new URLSearchParams(search).get('version') === 'earlier' ? 'earlier' : 'current'
}
export function glassVersionPath(version: GlassVersion, arrangement: Arrangement = 'canopy') {
  return version === 'earlier' ? `/glass/?version=earlier${arrangement === 'canopy' ? '' : `&arrangement=${encodeURIComponent(arrangement)}`}` : '/glass/'
}
