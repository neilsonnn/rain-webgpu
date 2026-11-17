export interface Planting {
  seed: number
  root: [number, number, number]
  height: number
  spread: number
  species: number
  leafScale?: number
  nearPane?: boolean
  form?: 'spray' | 'plush'
  lean?: [number, number]
}
export interface WallPatch {
  position: [number, number, number]
  outline: [number, number][]
}

// Add a named entry here for the next composition. The original generator is
// retained intact; arrangements only add plantings and replace backdrop pieces.
export interface SceneArrangement {
  label: string; description: string; background: string; recess: string
  skyFill: number; environment: number; fill: number; contact: boolean
  clearance: number; pullback: number; motion: 'earlier' | 'split' | 'breeze'
  wallColor: string; wallGap: number
  mainPlantSeeds?: number[]; pruneLeft?: number; windScale?: number
  pane?: { width: number; height: number; centerY: number }
  plantings: Planting[]; patches: WallPatch[]
}
const closeCanopyV1: SceneArrangement = {
    label: 'Close canopy', description: 'Layered leaves at the glass, deeper greens, and broken pale light.',
    background: '#020705', recess: '#030a06', skyFill: .36, environment: .4, fill: .6,
    contact: true,
    clearance: 0, pullback: 0, motion: 'earlier', wallColor: '#c0c0ad', wallGap: .64,
    plantings: [
      // Hanging shoots enter from above. Their supports stay outside the view.
      { seed: 4107, root: [-.72, 3.65, -.16], height: -1.3, spread: .48, species: 0, leafScale: 1.25 },
      { seed: 4119, root: [.48, 3.75, -.1], height: -1.05, spread: .56, species: 1, leafScale: 1.2 },
      { seed: 4151, root: [1.02, 3.6, -.48], height: -1.4, spread: .55, species: 0 },
      // Low shoots and broader leaves fill the lower edge in several depths.
      { seed: 4201, root: [-.7, -.25, -.075], height: 1.55, spread: .48, species: 0, leafScale: 1.4 },
      { seed: 4223, root: [.02, -.3, -.14], height: 1.42, spread: .5, species: 1, leafScale: 1.3 },
      { seed: 4243, root: [.88, -.2, -.24], height: 1.55, spread: .6, species: 0, leafScale: 1.2 },
      { seed: 4259, root: [-1.12, -.15, -.62], height: 1.9, spread: .5, species: 1 },
      { seed: 4283, root: [1.24, -.1, -.72], height: 2.5, spread: .62, species: 0 },
      // Distant, heavily diffused leaves remain behind the clear near silhouettes.
      { seed: 4307, root: [-.45, 0, -2.45], height: 2.9, spread: .75, species: 0 },
      { seed: 4327, root: [.9, 0, -3.0], height: 3.25, spread: .8, species: 1 },
    ],
    patches: [
      { position: [-1.75, 2.95, -2.18], outline: [[-.72, -.3], [-.62, .7], [-.14, .85], [.4, .61], [.62, .16], [.35, -.12], [-.04, -.04], [-.3, -.48]] },
      { position: [-1.62, 1.19, -2.2], outline: [[-.64, -.5], [-.58, .24], [-.25, .65], [.12, .43], [.3, .12], [.23, -.5]] },
      { position: [-.77, 2.64, -2.21], outline: [[-.17, -.12], [-.22, .43], [.1, .6], [.27, .35], [.24, -.26]] },
      { position: [-2.28, 1.98, -2.22], outline: [[-.24, -.21], [-.3, .35], [.1, .48], [.29, .16], [.18, -.35]] },
    ],
}

const closeCanopyV2: SceneArrangement = {
  ...closeCanopyV1, label: 'Close canopy', description: 'Room behind the glass; spring motion on the left, original sway on the right.',
  contact: false, clearance: .1, pullback: .14, motion: 'split', skyFill: .42,
  wallColor: '#dedfcb', wallGap: .35,
  patches: closeCanopyV1.patches.map((patch, index) => ({
    position: [patch.position[0] + (index < 2 ? .22 : .08), patch.position[1], patch.position[2]] as [number, number, number],
    outline: patch.outline.map(([x, y]) => [x * 1.55, y * 1.3] as [number, number]),
  })),
}

const closeCanopyV3 = {
  ...closeCanopyV2, description: 'Two pruned clusters, an open dark middle, and a finite pane with free orbit.',
  mainPlantSeeds: [100, 139, 217], pruneLeft: .4, windScale: 3.2, wallGap: .6,
  plantings: closeCanopyV1.plantings.filter(plant => [4107, 4151, 4243].includes(plant.seed)),
  pane: { width: 3.3, height: 3.5, centerY: 1.75 },
} satisfies SceneArrangement

const closeCanopyV4 = {
  ...closeCanopyV3, description: 'Near and farther leaves in both clusters, with an open middle and free orbit.',
  plantings: closeCanopyV3.plantings.map(plant => [4107, 4243].includes(plant.seed)
    ? { ...plant, root: [plant.root[0], plant.root[1], -.035] as [number, number, number], nearPane: true } : plant),
} satisfies SceneArrangement

export const arrangements = {
  original: {
    label: 'Original', description: 'The earlier study before the close foliage pass.',
    background: '#1b271f', recess: '#101a15', skyFill: .65, environment: .55, fill: .65,
    contact: false, clearance: 0, pullback: 0, motion: 'earlier', wallColor: '#c0c0ad', wallGap: 0,
    plantings: [], patches: [],
  },
  'canopy-v1': { ...closeCanopyV1, label: 'Close canopy · v1', description: 'The previous canopy with leaves flattened against the glass.' },
  'canopy-v2': { ...closeCanopyV2, label: 'Close canopy · v2', description: 'The previous full canopy and first motion comparison.' },
  'canopy-v3': { ...closeCanopyV3, label: 'Close canopy · v3', description: 'The pruned finite-pane composition before the near shoots were added.' },
  'canopy-v4': { ...closeCanopyV4, label: 'Close canopy · v4', description: 'The previous near-shoot layout, with spring motion on the left.' },
  canopy: {
    ...closeCanopyV4, description: 'Open left branches, a plush right canopy, and layered leaf-level breeze.',
    motion: 'breeze', mainPlantSeeds: [], pruneLeft: 0, pullback: 0,
    background: '#010503', recess: '#010402', skyFill: .4, environment: .44, fill: .62,
    wallColor: '#e3e1d0', wallGap: .78,
    plantings: [
      // Spacious sprays leave the pale patches visible through the left side.
      { seed: 5107, root: [-1.13, -.18, -.065], height: 2.95, spread: .36, species: 1, leafScale: 1.16, nearPane: true, form: 'spray', lean: [.1, -.08] },
      { seed: 5119, root: [-.94, 3.72, -.34], height: -1.22, spread: .38, species: 0, leafScale: 1.25, form: 'spray', lean: [-.15, -.08] },
      { seed: 5131, root: [-1.32, -.12, -.94], height: 1.85, spread: .3, species: 0, leafScale: 1.2, form: 'spray', lean: [.12, .06] },
      // Overlapping broad leaves, with depth inside the cluster rather than a
      // distant blanket of foliage. Supports remain above/below the pane.
      { seed: 5201, root: [.91, -.22, -.43], height: 3.02, spread: .57, species: 0, leafScale: 1.16, form: 'plush', lean: [.16, -.12] },
      { seed: 5227, root: [1.29, -.18, -1.12], height: 2.65, spread: .48, species: 1, leafScale: 1.1, form: 'plush', lean: [-.08, .08] },
      { seed: 5243, root: [.97, -.2, -.065], height: 1.85, spread: .43, species: 0, leafScale: 1.24, nearPane: true, form: 'plush', lean: [.08, -.12] },
      { seed: 5261, root: [1.19, 3.72, -.4], height: -1.3, spread: .45, species: 0, leafScale: 1.14, form: 'plush', lean: [.08, -.1] },
    ],
  },
} satisfies Record<string, SceneArrangement>
export type Arrangement = keyof typeof arrangements

export function arrangementFromSearch(search: string): Arrangement {
  const value = new URLSearchParams(search).get('arrangement')
  return value && Object.hasOwn(arrangements, value) ? value as Arrangement : 'canopy'
}

// Smooth contact with the pane's back face. A blade can flatten against the
// glass without either its wind motion or its shadow crossing the surface.
export function paneContact(z: number) {
  const edge = -.02, band = .08, q = Math.max(0, Math.min(1, (edge - z) / band))
  return z <= edge - band ? z : edge - band * q * q * (2 - q)
}
