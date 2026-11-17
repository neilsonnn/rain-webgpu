import { useEffect, useMemo, useState } from 'react'
import type { CityData } from './data'
import type { LocalMapping } from './matching'
import { gridSideForDensity } from './matching'

export function useLocalMatching(data: CityData | null, radius: number, density: number, enabled: boolean) {
  const [state, setState] = useState<{ data: CityData; radius: number; density: number; result?: LocalMapping; error?: string } | null>(null)
  const input = useMemo(() => {
    if (!data) return null
    const records = data.texture.image.data as Float32Array, centers = new Float32Array(data.count * 3)
    let buildings = 0
    for (let i = 0; i < data.count; i++) {
      centers.set([records[i * 16 + 8], records[i * 16 + 9], records[i * 16 + 13]], i * 3)
      if (records[i * 16 + 13] > .5) buildings++
    }
    return { centers, buildings }
  }, [data])
  useEffect(() => {
    if (!data || !input || !enabled) return
    // Debounce controls and cancel obsolete workers. Grid resolution changes
    // independently of survey geometry; full-city matching stays off-thread.
    let worker: Worker | undefined
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL('./matching.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<{ result?: LocalMapping; error?: string }>) => { setState({ data, radius, density, ...event.data }); worker?.terminate() }
        worker.onerror = () => { setState({ data, radius, density, error: 'Could not prepare local tile matching. Try reloading the scene.' }); worker?.terminate() }
        const centers = input.centers.slice()
        worker.postMessage({ centers, side: gridSideForDensity(input.buildings, density), bounds: data.gridBounds, radius }, [centers.buffer])
      } catch {
        setState({ data, radius, density, error: 'Could not prepare local tile matching. Try reloading the scene.' }); worker?.terminate()
      }
    }, 120)
    return () => { window.clearTimeout(timer); worker?.terminate() }
  }, [data, input, radius, density, enabled])
  const current = state?.data === data ? state : null
  return { mapping: current?.result ?? null, pending: enabled && (!current || current.radius !== radius || current.density !== density), error: current?.error }
}
