import type { RainRecording } from './recordings'

export interface RainSettings {
  rain: boolean
  rainIntensity: number
  rainGlass: number
  rainDropSize: number
  rainBeadChance: number
  rainBeadVelocity: number
  rainBeadLifetime: number
  rainImpactScale: number
  rainImpactDuration: number
  rainFlow: number
  rainFriction: number
  rainDrying: number
  rainSurfaceTension: number
  rainTouch: boolean
  rainBrushRadius: number
  rainBrushGain: number
  rainBrushRamp: number
  rainBrushTail: number
  rainImpact: number
  rainFlexibility: number
  rainRetention: number
  rainWetness: number
  rainWind: number
  rainSpeed: number
  rainWindStrength: number
  rainIncidence: number
  rainParticles: number
  rainSpray: number
  rainShake: number
  rainTurbulence: number
  rainSquallSpeed: number
  rainSquallSize: number
  rainWander: number
  rainMainBranchStiffness: number
  rainBranchStiffness: number
  rainShutter: number
  rainVisibility: number
  rainVolume: number
  rainRecording: RainRecording
}

export const rainDefaults: RainSettings = {
  rain: false, rainIntensity: .78, rainGlass: 1.3, rainDropSize: 2, rainBeadChance: .25, rainBeadVelocity: .14,
  rainImpactScale: 1.4, rainImpactDuration: .12, rainBeadLifetime: 24,
  rainFlow: .3, rainFriction: 1.4, rainImpact: 2.2, rainFlexibility: 1, rainRetention: 1,
  rainDrying: 120, rainSurfaceTension: 1, rainTouch: false,
  rainBrushRadius: 112, rainBrushGain: 4, rainBrushRamp: 1.5, rainBrushTail: .55,
  rainWetness: 1, rainWind: .25, rainTurbulence: 1, rainSquallSpeed: 1, rainSquallSize: 1.25, rainWander: 1,
  rainSpeed: 1, rainWindStrength: 1, rainIncidence: .55,
  rainParticles: 1, rainSpray: 1.4, rainShake: 1,
  rainMainBranchStiffness: 8, rainBranchStiffness: 1.8, rainShutter: 12, rainVisibility: 1, rainVolume: .45, rainRecording: 'tin',
}

export function normalizeRain<T extends RainSettings>(settings: T): T {
  if (settings.rainRecording !== 'glass') settings.rainRecording = 'tin'
  const ranges = { rainIntensity: [0, 1], rainGlass: [0, 64], rainDropSize: [.5, 16], rainFlow: [.25, 8], rainFriction: [.25, 3],
    rainBeadChance: [0, 1], rainBeadVelocity: [0, 1],
    rainBeadLifetime: [.05, 60],
    rainImpactScale: [.1, 2], rainImpactDuration: [0, .4],
    rainBrushRadius: [4, 700], rainBrushGain: [1, 32], rainBrushRamp: [.1, 10], rainBrushTail: [0, 4],
    rainDrying: [15, 600], rainSurfaceTension: [.3, 2],
    rainImpact: [0, 8], rainFlexibility: [.35, 2.5], rainRetention: [.2, 3], rainWetness: [0, 1.5], rainWind: [-1, 1],
    rainSpeed: [.15, 4], rainWindStrength: [0, 5], rainIncidence: [0, 1],
    rainParticles: [.1, 8], rainSpray: [.2, 6], rainShake: [0, 4],
    rainTurbulence: [0, 4], rainSquallSpeed: [0, 8], rainSquallSize: [.25, 6], rainWander: [0, 2], rainMainBranchStiffness: [1, 12], rainBranchStiffness: [.5, 5], rainShutter: [2, 30], rainVisibility: [.2, 2.5], rainVolume: [0, 1] } as const
  for (const name of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const [min, max] = ranges[name]
    settings[name] = Math.max(min, Math.min(max, Number.isFinite(settings[name]) ? settings[name] : rainDefaults[name]))
  }
  return settings
}

// Glass study is an opt-in complete rain look for this model. The intensity
// presets preserve the user's chosen bead size, weather and mobility.
export const rainPresets = {
  Deluge: { rain: true, rainIntensity: 1, rainGlass: 32, rainDropSize: 4.6,
    rainSpeed: 1.75, rainWind: .67, rainWindStrength: 1.9, rainIncidence: .96, rainTurbulence: 2.8, rainSquallSize: 1.35, rainSquallSpeed: 2.4,
    rainParticles: 4.5, rainSpray: 3.2, rainShake: 2.5, rainFlow: 1.3, rainFriction: 1.05,
    rainShutter: 10, rainVisibility: 1.9, rainImpact: 4, rainBranchStiffness: 2.3, rainRetention: 1.8 },
  'Glass study': { rain: true, rainIntensity: .82, rainGlass: 2.2, rainDropSize: 2.8,
    rainSpeed: .7, rainWind: .45, rainWindStrength: 1.1, rainIncidence: .65, rainTurbulence: 1.5,
    rainFlow: .85, rainFriction: 1.25, rainSurfaceTension: 1.1, rainDrying: 150,
    rainShutter: 9, rainVisibility: 1.3, rainImpact: 1.4, rainBranchStiffness: 3.2 },
  Drizzle: { rain: true, rainIntensity: .18, rainGlass: .55 },
  Shower: { rain: true, rainIntensity: .55, rainGlass: 1 },
  Downpour: { rain: true, rainIntensity: 1, rainGlass: 1.7 },
} satisfies Record<string, Partial<RainSettings>>

// mm/hour; intensity changes rain flux as well as visible particle count.
export const rainfallRate = (intensity: number) => 2 + 158 * Math.max(0, Math.min(1, intensity)) ** 2
// Fine contacts per second over the Original pane. Falling speed controls
// motion and impact momentum; intensity and incidence control water arrivals.
export function panePatterRate(strength: number, settings: RainSettings, area: number) {
  return (20 * strength + 16000 * strength ** 4) * settings.rainGlass
    * (.15 + .85 * settings.rainIncidence) * area / (4.8 * 4.8)
}
export const water = { density: 998, tension: .072, viscosity: .001, gravity: 9.81, ior: 1.333 } as const
export const dropVolume = (diameter: number) => Math.PI / 6 * diameter ** 3
// Atlas et al. terminal-speed approximation, diameter in metres, speed in m/s.
export const fallSpeed = (diameter: number) => Math.max(.6, 9.65 - 10.3 * Math.exp(-600 * diameter))

// A broad right-skewed population: mostly fine rain, occasional large drops.
// Increasing size extends the heavy tail without doubling every small bead.
// Preserve the saved .5–2 range. Above 2, scale the entire water population
// beyond natural rain sizes for the art direction, including collision volumes.
export function rainDiameter(sample: number, intensity: number, scale: number) {
  const tail = -Math.log(Math.max(.000001, 1 - Math.max(0, Math.min(1, sample))))
  const size = (.00065 + .00115 * intensity ** 1.3) * Math.min(2, scale) * tail ** 1.3
  return (.00045 + .00675 * (1 - Math.exp(-size / .00675))) * Math.max(1, scale / 2)
}
