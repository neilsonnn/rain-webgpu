import type { Vector3 } from 'three'
import type { RainSettings } from './settings'
import { fallSpeed } from './settings'

const hash = (x: number, y: number, z: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return n - Math.floor(n)
}
const smooth = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
export function rainNoise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz)
  return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), u),
    mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
  mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u),
    mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v), w)
}

// Shared weather coordinates: coherent fronts travel across BOTH the airborne
// volume and the glass. No independent per-particle, per-frame jitter.
export function rainDensity(x: number, y: number, z: number, time: number, s: RainSettings) {
  const t = time * (.35 + .65 * s.rainSpeed)
  const advect = s.rainWind * s.rainWindStrength
  const front = rainNoise(x * .65 - t * advect * .55, y * .24 + t * .22, z * .55 + t * .38)
  const patch = rainNoise(x * 2.2 - t * advect * 1.1, y * .7 + t * .75, z * 1.8 + t * .9 + 31)
  return Math.min(1, Math.max(.06, .46 + (front - .5) * 1.2 + (patch - .5) * .65 * s.rainTurbulence))
}

export function rainAir(out: Vector3, point: Vector3, time: number, s: RainSettings, intensity: number, phase = time * s.rainSquallSpeed) {
  const t = phase * (.35 + .65 * s.rainSpeed), advect = s.rainWind * s.rainWindStrength
  const scale = 1.25 / s.rainSquallSize, x = point.x * scale, y = point.y * scale, z = point.z * scale
  const gust = rainNoise(x * .45 - t * advect * .25, y * .19, t * .38 + z * .38) * 2 - 1
  const eddy = rainNoise(x * 1.7 - t * advect * .65, y * .6 + t * .55, z * 1.4 + t * .8) * 2 - 1
  const cross = rainNoise(z * 2 + t * .8, x * 1.2 - t * advect, y * .8 + 43) * 2 - 1
  const wind = s.rainWindStrength, turbulence = s.rainTurbulence * wind
  return out.set(
    (s.rainWind * (2.8 + intensity * 1.8) * wind * (1 + gust * .65) + eddy * 1.7 * turbulence) * s.rainSpeed,
    cross * .4 * turbulence * s.rainSpeed,
    -(.12 + s.rainIncidence * (1.6 + wind * 1.8)) * (1 + gust * .55) * s.rainSpeed + cross * .26 * turbulence * s.rainSpeed,
  )
}
export function rainVelocity(out: Vector3, point: Vector3, time: number, settings: RainSettings, intensity: number, diameter: number, phase?: number) {
  rainAir(out, point, time, settings, intensity, phase)
  out.y -= fallSpeed(diameter) * settings.rainSpeed
  return out
}
export const rainBurst = (time: number) => .35 + rainNoise(time * .7, 2.8, 17.9) ** 2 * 1.8
