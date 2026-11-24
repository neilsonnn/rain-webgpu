import { useState, useSyncExternalStore } from 'react'
import type { FrameTimings } from './performance'
import type { ProfileView } from './view'
import { defaultQuality, qualityLevels, supportedLevel, type GpuQuality, type QualityCaps, type QualityKey } from './quality'

const ms = (value: number) => value.toFixed(1) + ' ms'

const controls: { key: QualityKey; label: string; hint: string; format?: (v: number) => string }[] = [
  { key: 'rays', label: 'Glass scattering', hint: 'Rays per pixel through the garden. Fewer rays may soften or mottle foliage.', format: v => v + (v === 1 ? ' ray' : ' rays') },
  { key: 'depthSteps', label: 'Garden depth steps', hint: 'Depth lookups per ray. More steps refine the outlines of nearby leaves.' },
  { key: 'entrySteps', label: 'Glass relief steps', hint: 'Refinements where the viewing ray first meets the bumpy glass.' },
  { key: 'bounces', label: 'Internal reflection', hint: 'Include the light that bounces inside the slab. Front-surface reflections stay on.', format: v => v ? '1 bounce' : 'Off' },
  { key: 'reliefFilter', label: 'Glass texture filtering', hint: 'Anisotropic filtering of the rolled-glass maps, most visible at oblique angles.', format: v => v + '×' },
  { key: 'wireSamples', label: 'Wire antialiasing', hint: 'Coverage samples on thin wires. Higher settings reduce shimmer.', format: v => v === 1 ? 'No multisampling' : v + '×' },
  { key: 'waterSize', label: 'Water surface map', hint: 'Bead and streak shading detail on wet glass. The stored water stays in place.', format: v => v + '²' },
  { key: 'airPercent', label: 'Airborne rain', hint: 'Share of falling drops to simulate and draw. Fewer drops also means fewer airborne hits on leaves and glass.', format: v => v + '%' },
]

export function FrameCounter({ timings, paused, storm, quality, caps, onQuality, renderSize, view, onView }: {
  timings: FrameTimings; paused: boolean; storm?: 'starting' | 'webgpu'
  quality: GpuQuality; caps: QualityCaps; onQuality: (q: GpuQuality) => void
  renderSize: { width: number; height: number }; view: ProfileView; onView: (view: ProfileView) => void
}) {
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
      {storm === 'webgpu' && <fieldset className="glass-profile">
        <legend>Render comparison</legend>
        <label className="glass-pixel-ratio" title="Rendered pixels per CSS pixel along each axis">
          Pixel ratio
          <select value={quality.pixelRatio} onChange={event => onQuality({ ...quality, pixelRatio: Number(event.target.value) })}>
            {qualityLevels.pixelRatio.map(ratio => <option key={ratio} value={ratio}>
              {ratio ? ratio + '×' : 'Native (' + (window.devicePixelRatio || 1) + '×)'}
            </option>)}
          </select>
        </label>
        <div className="glass-render-size">Render size <output>{renderSize.width} × {renderSize.height} px</output></div>
        <label title="Skip the glass, embedded wire and pane-water rendering">
          <input type="checkbox" checked={view !== 'scene'} onChange={event => onView(event.target.checked ? 'garden' : 'scene')} />
          Disable glass pane
        </label>
        {view !== 'scene' && <label title="Draw garden geometry with a simple unlit material. Skip rain and grading.">
          <input type="checkbox" checked={view === 'meshes'} onChange={event => onView(event.target.checked ? 'meshes' : 'garden')} />
          Mesh only
        </label>}
      </fieldset>}
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
      {storm === 'webgpu' && <fieldset className="glass-gpu-quality">
        <legend>GPU quality</legend>
        {controls.map(({ key, label, hint, format = String }) => {
          const levels = key === 'wireSamples' || key === 'reliefFilter' ? caps[key] : qualityLevels[key]
          const value = supportedLevel(quality[key], levels)
          return <label key={key} title={hint}>
            <span>{label}<output>{format(value)}</output></span>
            <input type="range" aria-label={label} aria-description={hint} aria-valuetext={format(value)}
              min={0} max={levels.length - 1} step={1} value={levels.indexOf(value)} disabled={levels.length < 2}
              onChange={event => onQuality({ ...quality, [key]: levels[Number(event.target.value)] })} />
          </label>
        })}
        <button type="button" onClick={() => onQuality({ ...defaultQuality })}>Reset GPU quality</button>
        <p>GPU quality and pixel ratio are saved in this browser.</p>
      </fieldset>}
    </div>}
  </aside>
}
