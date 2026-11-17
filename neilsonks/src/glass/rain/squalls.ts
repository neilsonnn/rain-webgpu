import { DataTexture, LinearFilter, RedFormat } from 'three'
import type { Vector3, Vector4 } from 'three'
import { random } from '../settings'
import type { RainSettings } from './settings'

export const squallSide = 40
const count = squallSide * squallSide
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const rng = random(561721)
const lattice = Float32Array.from({ length: 4096 }, rng)
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(x - ix), ty = smooth(y - iy)
  const row = (iy & 63) * 64, next = ((iy + 1) & 63) * 64, a = ix & 63, b = (ix + 1) & 63
  const low = lattice[row + a] + tx * (lattice[row + b] - lattice[row + a])
  const high = lattice[next + a] + tx * (lattice[next + b] - lattice[next + a])
  return low + ty * (high - low)
}

// One wind field drives airborne births, pane strikes, and the fine optical
// layers on both backends. Its alias table samples dense patches in O(1).
export function createSqualls(bounds: Vector4) {
  const cells = new Float32Array(count * 4), pixels = new Uint8Array(count)
  const small = new Uint16Array(count), large = new Uint16Array(count), weight = new Float32Array(count)
  const texture = new DataTexture(pixels, squallSide, squallSide, RedFormat)
  texture.minFilter = texture.magFilter = LinearFilter
  let ox = 0, oy = 0, phase = 0, elapsed = Infinity, revision = 0, mean = 1, flux = 1, wind = 0
  let lastSize = -1, lastContrast = -1
  for (let i = 0; i < count; i++) { cells[i * 4] = cells[i * 4 + 1] = 1; cells[i * 4 + 2] = i }
  pixels.fill(255); texture.needsUpdate = true
  function update(dt: number, s: RainSettings, strength: number) {
    if (!s.rain && strength < .001) return
    wind = s.rainWind * s.rainWindStrength
    const travel = dt * s.rainSquallSpeed
    phase += travel; ox += travel * wind * .82; oy -= travel * (.24 + .24 * strength)
    elapsed += dt
    const contrast = clamp(s.rainTurbulence * .54) * clamp(s.rainWindStrength * .8 + .2) * (.45 + .55 * strength)
    const changed = s.rainSquallSize !== lastSize || Math.abs(contrast - lastContrast) > .035
    if (!changed && (elapsed < 1 / 30 || !travel || !contrast)) return
    elapsed = 0; lastSize = s.rainSquallSize; lastContrast = contrast
    let sum = 0
    for (let row = 0; row < squallSide; row++) for (let col = 0; col < squallSide; col++) {
      const x = (bounds.x + (col + .5) / squallSide * bounds.z - ox) / s.rainSquallSize
      const y = (bounds.y + (row + .5) / squallSide * bounds.w - oy) / s.rainSquallSize
      const warp = noise(x * .51 + phase * .12, y * .77 - phase * .17) - .5
      const band = noise(1.6 * x + .65 * y + warp * 2.4, .58 * y - .22 * x - phase * .22)
      const fleck = noise(x * 4.3 - phase * .31 + warp, y * 3.2 + phase * .37)
      const front = smooth(clamp((band * .76 + fleck * .24 - .31) / .40))
      const density = 1 - contrast * (1 - (.008 + .992 * front * front))
      const i = col + row * squallSide
      cells[i * 4] = density; pixels[i] = Math.round(density * 255); sum += density
    }
    mean = sum / count
    flux = 1 + Math.max(-.55, Math.min(.65, (mean - (1 - .62 * contrast)) * 2.5))
    let ns = 0, nl = 0
    for (let i = 0; i < count; i++) {
      weight[i] = cells[4 * i] / mean
      if (weight[i] < 1) small[ns++] = i
      else large[nl++] = i
    }
    while (ns && nl) {
      const a = small[--ns], b = large[--nl]
      cells[a * 4 + 1] = weight[a]; cells[a * 4 + 2] = b
      weight[b] += weight[a] - 1
      if (weight[b] < 1) small[ns++] = b
      else large[nl++] = b
    }
    while (ns) cells[4 * small[--ns] + 1] = 1
    while (nl) cells[4 * large[--nl] + 1] = 1
    texture.needsUpdate = true; revision++
  }
  return { cells, texture, update, get revision() { return revision }, get phase() { return phase }, get flux() { return flux },
    density(x: number, y: number, z: number) {
      const col = Math.min(squallSide - 1, Math.floor(clamp((x + z * wind * .32 - bounds.x) / bounds.z) * squallSide))
      const row = Math.min(squallSide - 1, Math.floor(clamp((y - z * .22 - bounds.y) / bounds.w) * squallSide))
      return cells[4 * (row * squallSide + col)]
    },
    sample(out: Vector3, rng: () => number) {
      let i = Math.min(count - 1, Math.floor(rng() * count))
      if (rng() > cells[4 * i + 1]) i = cells[4 * i + 2]
      return out.set(bounds.x + (i % squallSide + rng()) / squallSide * bounds.z,
        bounds.y + (Math.floor(i / squallSide) + rng()) / squallSide * bounds.w, 0)
    },
    dispose() { texture.dispose() },
  }
}
export type RainSqualls = ReturnType<typeof createSqualls>
