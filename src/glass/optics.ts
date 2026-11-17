// Carbon-steel appearance approximated by measured iron, not a zinc coating.
// Johnson & Christy (1974), linearly interpolated at 640, 560 and 440 nm.
// https://doi.org/10.1103/PhysRevB.9.5056
// https://refractiveindex.info/?shelf=main&book=Fe&page=Johnson
export const iron = { n: [2.901905, 2.946667, 2.5295], k: [3.077381, 2.95, 2.737] } as const

export function conductorF0(n: number, k: number, medium: number) {
  return ((n - medium) ** 2 + k * k) / ((n + medium) ** 2 + k * k)
}

export function dielectricFresnel(cosine: number, incidentIOR: number, transmittedIOR: number) {
  let c = Math.max(-1, Math.min(1, cosine)), a = incidentIOR, b = transmittedIOR
  if (c < 0) { [a, b] = [b, a]; c = -c }
  const sineSquared = (a / b) ** 2 * (1 - c * c)
  if (sineSquared >= 1) return 1
  const transmittedCosine = Math.sqrt(1 - sineSquared)
  const rs = (a * c - b * transmittedCosine) / (a * c + b * transmittedCosine)
  const rp = (b * c - a * transmittedCosine) / (b * c + a * transmittedCosine)
  return (rs * rs + rp * rp) * .5
}

export function embeddedWireDepth(thickness: number, radius: number, fraction: number, frontRelief = 0, rearRelief = 0) {
  const frontMargin = radius * 1.65 + .0008 * frontRelief
  const rearMargin = radius * 1.65 + .0008 * rearRelief
  return Math.max(frontMargin, Math.min(thickness - rearMargin, thickness * fraction))
}

export function diffusionDistance(distance: number, strength: number, scale: number, curve: number, clearDepth: number) {
  return strength * scale * Math.pow(Math.max(0, distance - clearDepth) / scale, curve)
}
