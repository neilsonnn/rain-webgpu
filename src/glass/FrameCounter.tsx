import { useState, useSyncExternalStore } from 'react'
import type { FrameTimings } from './performance'

const ms = (value: number) => value.toFixed(1) + ' ms'

export function FrameCounter({ timings, paused, storm }: { timings: FrameTimings; paused: boolean; storm?: 'starting' | 'webgpu' }) {
  const [open, setOpen] = useState(false)
  const sample = useSyncExternalStore(timings.subscribe, timings.snapshot)
  const toggle = () => {
    timings.expanded = !open
    timings.reset()
    setOpen(!open)
  }
  const measured = sample.fps > 0 && !paused
  return <aside className="glass-fps">
    <button type="button" aria-label="Frame timings" title={open ? 'Hide frame timings' : 'Show frame timings'} aria-expanded={open} aria-controls="glass-frame-times" onClick={toggle}>
      {paused ? 'Paused' : (sample.fps || '…') + ' FPS'}
    </button>
    {open && <div className="glass-frame-times" id="glass-frame-times">
      <dl>
        <dt>Frame interval</dt><dd>{measured ? ms(sample.frame) : '—'}</dd>
        <dt>Simulation CPU</dt><dd>{measured ? ms(sample.simulation) : '—'}</dd>
        <dt>Render CPU</dt><dd>{measured ? ms(sample.render) : '—'}</dd>
        {storm === 'webgpu' && <><dt>Storm compute GPU</dt><dd>{measured && sample.stormGpu !== undefined ? ms(sample.stormGpu) : '—'}</dd></>}
        <dt>Render GPU</dt><dd>{measured && sample.renderGpu !== undefined ? ms(sample.renderGpu) : '—'}</dd>
        {storm === 'webgpu' && <>
          <dt>Glass pass GPU</dt><dd>{measured && sample.glassGpu !== undefined ? ms(sample.glassGpu) : '—'}</dd>
          <dt>Pack rain GPU</dt><dd>{measured && sample.packGpu !== undefined ? ms(sample.packGpu) : '—'}</dd>
          <dt>Rain import CPU / GPU</dt><dd>{measured && sample.importCpu !== undefined ? ms(sample.importCpu) : '—'} / {measured && sample.importGpu !== undefined ? ms(sample.importGpu) : '—'}</dd>
          <dt>Rain atlas per upload</dt><dd>{measured && sample.atlasBytes !== undefined ? (sample.atlasBytes / 1048576).toFixed(2) + ' MiB' : '—'}</dd>
        </>}
        {storm && <>
          <dt>Airborne pane hits/s</dt><dd>{measured && sample.flightHits !== undefined ? sample.flightHits.toLocaleString() : '—'}</dd>
          <dt>Direct pane hits/s</dt><dd>{measured && sample.patterHits !== undefined ? sample.patterHits.toLocaleString() : '—'}</dd>
        </>}
      </dl>
      <p>CPU and GPU work can overlap. GPU times appear when the browser supplies them.</p>
    </div>}
  </aside>
}
