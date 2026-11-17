export type Mode = 'weave' | 'ripple' | 'flow'
export const modes: Record<Mode, { name: string; description: string; index: number }> = {
  flow: { name: 'Simultaneous flow', description: 'Squares become footprints as buildings rise. One continuous motion, with a slower start to the height.', index: 2 },
  weave: { name: 'Parcel weave', description: 'Move the connected grid first. Open the footprints, then raise the city.', index: 0 },
  ripple: { name: 'Radial breath', description: 'A shared swell travels out from the centre. Buildings rise in its wake.', index: 1 },
}
export const clamp = (x: number) => Math.max(0, Math.min(1, x))
export const ease = (x: number) => { const t = clamp(x); if (t < 1e-10) return 0; if (t > 1 - 1e-10) return 1; return clamp(t * t * t * (t * (t * 6 - 15) + 10)) }
// A full cycle includes a dwell at both endpoints, with zero endpoint velocity.
export function breathProgress(time: number, duration: number, dwell: number) {
  const half = duration / 2, span = half + dwell, t = ((time % (span * 2)) + span * 2) % (span * 2)
  return t < span ? ease((t - dwell) / half) : 1 - ease((t - span - dwell) / half)
}
export function phases(progress: number, mode: Mode, radius = 0, wave = .4, riseEase = 1.8) {
  const t = clamp(progress)
  if (mode === 'flow') return { layout: t, shape: t, release: t, rise: t ** riseEase }
  const local = mode === 'ripple' ? clamp((t - radius * wave * Math.sin(Math.PI * t)) / 1) : t
  const layout = ease(t / .52)
  const shape = ease((t - .25) / .45)
  const release = ease((t - .74) / .26)
  const rise = ease((local - .58) / .42)
  return { layout, shape, release, rise }
}
// A guard keeps vertices in their own interpolated partition while translating.
export function guardedPoint(source: [number, number], target: [number, number], rect: number[], center: number[], fit: number, phase: ReturnType<typeof phases>, sourceRect: number[]) {
  const safe = [center[0] + (target[0] - center[0]) * fit, center[1] + (target[1] - center[1]) * fit]
  const uv = [(safe[0] - rect[0]) / Math.max(1e-8, rect[1] - rect[0]), (safe[1] - rect[2]) / Math.max(1e-8, rect[3] - rect[2])]
  const box = rect.map((x, i) => sourceRect[i] + (x - sourceRect[i]) * phase.layout)
  const u = source[0] + (clamp(uv[0]) - source[0]) * phase.shape, v = source[1] + (clamp(uv[1]) - source[1]) * phase.shape
  const point = [box[0] + (box[1] - box[0]) * u, box[2] + (box[3] - box[2]) * v]
  return point.map((x, i) => x + (target[i] - x) * phase.release)
}
