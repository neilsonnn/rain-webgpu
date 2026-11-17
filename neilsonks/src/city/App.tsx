import { Component, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import World from './World'
import { loadCity } from './data'
import type { CityData, CityDetail, TerrainData } from './data'
import { defaults } from './types'
import type { Settings, View } from './types'
import { modes } from './motion'
import { useLocalMatching } from './useLocalMatching'
import type { Mode } from './motion'
import './style.css'

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? null : this.props.children }
}
function Range({ label, value, min, max, step, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void
}) {
  return <label className="city-range"><span>{label}<output>{Number(value.toFixed(2))}{unit}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
  </label>
}
export default function City() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...defaults, playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches }))
  const live = useRef(settings)
  const [detail, setDetail] = useState<CityDetail>('market')
  const [data, setData] = useState<CityData | null>(null), [terrain, setTerrain] = useState<TerrainData | null>(null)
  const [download, setDownload] = useState(0), [error, setError] = useState(''), [ready, setReady] = useState(false), [retry, setRetry] = useState(0)
  const [visible, setVisible] = useState(!document.hidden), [panel, setPanel] = useState(false)
  const [view, setView] = useState<View>('downtown'), [viewVersion, setViewVersion] = useState(0)
  const useLocal = settings.mode === 'flow' && settings.matching === 'local'
  const localMatching = useLocalMatching(data, settings.matchRadius, settings.gridDensity, useLocal)
  const change = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    live.current = { ...live.current, [key]: value }
    setSettings({ ...live.current })
  }, [])
  const report = useCallback((progress: number) => setSettings(s => ({ ...s, progress })), [])
  const onReady = useCallback(() => setReady(true), [])
  const onFailure = useCallback((message?: string) => setError(message || 'The 3D scene could not run. Try the Market Street study or disable shadows, then reload.'), [])
  useEffect(() => { if (localMatching.error) onFailure(localMatching.error) }, [localMatching.error, onFailure])
  useEffect(() => {
    const changed = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => {
    const abort = new AbortController(); let owned: CityData | null = null
    setData(null); setReady(false); setError(''); setDownload(0)
    const json = async <T,>(path: string): Promise<T> => { const r = await fetch(path, { signal: abort.signal }); if (!r.ok) throw new Error('Data download failed'); return r.json() }
    const cityPromise = loadCity(detail, abort.signal, setDownload).then(city => { owned = city; return city })
    Promise.all([cityPromise, json<TerrainData>('/data/city/terrain.json')]).then(([city, land]) => {
      if (abort.signal.aborted) { city.geometry.dispose(); city.texture.dispose(); return }
      owned = city; setData(city); setTerrain(land)
      live.current.progress = 0; live.current.epoch++; setSettings({ ...live.current })
    }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load city data') })
    return () => { abort.abort(); owned?.geometry.dispose(); owned?.texture.dispose() }
  }, [detail, retry])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof Element && e.target.closest('input, button, select, textarea, summary')) return
      if (e.code === 'Space') { e.preventDefault(); change('playing', !live.current.playing) }
      if (e.key.toLowerCase() === 'r') { live.current = { ...defaults, playing: live.current.playing, epoch: live.current.epoch + 1 }; setSettings({ ...live.current }); setView(detail === 'full' ? 'city' : 'downtown'); setViewVersion(v => v + 1) }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [change, detail])
  const jump = (value: number) => { live.current = { ...live.current, progress: value, playing: false }; setSettings({ ...live.current }) }
  const selectView = (value: View) => { setView(value); setViewVersion(v => v + 1) }
  const reset = () => { live.current = { ...defaults, playing: live.current.playing, epoch: live.current.epoch + 1 }; setSettings({ ...live.current }); selectView(detail === 'full' ? 'city' : 'downtown') }
  const gridSide = localMatching.mapping?.side
  const mapped = localMatching.mapping?.stats
  return <div className="city-experiment">
    <div className="city-canvas" role="img" aria-label="Interactive chess grid morphing into San Francisco buildings. Drag to orbit, scroll or pinch to zoom.">
      {data && terrain && !error && <SceneBoundary key={`${detail}-${retry}`} onFailure={onFailure}><World data={data} terrain={terrain} mapping={localMatching.mapping} settings={live} onProgress={report} onReady={onReady} visible={visible} view={view} viewVersion={viewVersion} onFailure={onFailure} /></SceneBoundary>}
    </div>
    {(!ready || error) && <div className={`city-loading${error ? ' city-loading-error' : ''}`} role="status" aria-label={error ? 'Simulation error' : 'Loading simulation'}>
      {error && <p>{error}</p>}
      {!error && <progress aria-label="Loading simulation" value={download} max={1} />}
      {error && <><button onClick={() => setRetry(r => r + 1)}>Reload scene</button><button onClick={() => { setDetail('market'); setRetry(r => r + 1) }}>Try Market Street</button></>}
    </div>}
    <button className="city-panel-toggle" aria-expanded={panel} aria-controls="city-controls" onClick={() => setPanel(p => !p)}>Settings</button>
    {panel && <aside className="city-controls" id="city-controls" aria-label="Simulation settings">
      <div className="city-control-title">Settings</div>
      <div className="city-modes" role="group" aria-label="Morph approach">{(Object.keys(modes) as Mode[]).map(mode => <button key={mode} aria-pressed={settings.mode === mode} onClick={() => change('mode', mode)}>{modes[mode].name}</button>)}</div>
      <Range label="Grid → city" value={settings.progress} min={0} max={1} step={.001} onChange={jump} />
      <div className="city-playback"><button aria-pressed={settings.playing} onClick={() => change('playing', !settings.playing)}>{settings.playing ? 'Pause' : 'Breathe'}</button><button onClick={() => jump(0)}>Flat grid</button><button onClick={() => jump(1)}>City</button></div>
      {settings.mode === 'flow' && <div className="city-matching">
        <label className="city-select">Tile matching<select value={settings.matching} onChange={e => change('matching', e.target.value as Settings['matching'])}><option value="local">Local · allow unused tiles</option><option value="forced">Forced one-to-one · compare</option></select></label>
        {settings.matching === 'local' && <>
          <label className="city-select">Grid tiles per building<select value={settings.gridDensity} onChange={e => change('gridDensity', Number(e.target.value))}>
            <option value={.25}>¼× · fewer, larger tiles</option><option value={.5}>½×</option><option value={1}>1× · about equal counts</option><option value={2}>2×</option><option value={4}>4×</option><option value={8}>8× · more, smaller tiles</option>
          </select></label>
          <label className="city-select">Unmatched buildings<select value={settings.unmatched} onChange={e => change('unmatched', e.target.value as Settings['unmatched'])}><option value="hide">Hide · strict tile → building</option><option value="grow">Grow in place · complete city</option></select></label>
          <Range label="Travel limit" value={settings.matchRadius} min={.5} max={4} step={.25} unit=" tiles" onChange={v => change('matchRadius', v)} />
          <p className="city-match-stats" role="status">{localMatching.pending ? 'Finding nearby tiles…' : mapped && gridSide ? <>{gridSide} × {gridSide} grid · {(gridSide ** 2).toLocaleString()} tiles<br />{mapped.matched.toLocaleString()} / {mapped.buildings.toLocaleString()} buildings mapped ({(mapped.matched / mapped.buildings * 100).toFixed(1)}%)<br />{mapped.unusedTiles.toLocaleString()} spare tiles · {mapped.unmatched.toLocaleString()} buildings {settings.unmatched === 'hide' ? 'hidden' : 'grow in place'}<br />Centre travel: {mapped.meanTravelMeters.toFixed(0)} m mean · {mapped.maxTravelMeters.toFixed(0)} m max</> : ''}</p>
        </>}
      </div>}
      <div className="city-control-section">
        <Range label="Breath duration" value={settings.duration} min={6} max={40} step={1} unit="s" onChange={v => change('duration', v)} />
        <Range label="Endpoint pause" value={settings.dwell} min={0} max={4} step={.1} unit="s" onChange={v => change('dwell', v)} />
        <Range label="Building height" value={settings.height} min={.25} max={5} step={.05} unit="×" onChange={v => change('height', v)} />
        {settings.mode === 'flow' && <Range label="Rise easing" value={settings.riseEase} min={1} max={3} step={.1} onChange={v => change('riseEase', v)} />}
        <Range label="Hill relief" value={settings.terrain} min={0} max={4} step={.05} unit="×" onChange={v => change('terrain', v)} />
        <Range label="Shared swell" value={settings.swell} min={0} max={15} step={.1} onChange={v => change('swell', v)} />
        {settings.mode === 'ripple' && <Range label="Wave spread" value={settings.wave} min={0} max={.9} step={.01} onChange={v => change('wave', v)} />}
        {settings.mode !== 'flow' && <Range label="Moving tile gap" value={settings.gap} min={0} max={.2} step={.005} onChange={v => change('gap', v)} />}
      </div>
      {settings.mode !== 'flow' && <label className="city-legacy-guard"><input type="checkbox" checked={settings.guard} onChange={e => change('guard', e.target.checked)} /> Parcel guard</label>}
      <div className="city-switches">{([
        ['ground', 'Coast & terrain'], ['shadows', 'Chess shadows'], ['wireframe', 'Wireframe'], ['rotate', 'Slow orbit'],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key]} onChange={e => change(key, e.target.checked)} /><span>{label}</span></label>)}</div>
      <label className="city-select">Geometry<select value={detail} onChange={e => { setDetail(e.target.value as CityDetail); selectView(e.target.value === 'full' ? 'city' : 'downtown') }}><option value="market">Market Street · 256 buildings</option><option value="downtown">Downtown · 5,592 buildings</option><option value="full">Whole city · 176,899 buildings</option></select></label>
      <div className="city-view-buttons" role="group" aria-label="Camera view"><button onClick={() => selectView('city')}>Overview</button><button onClick={() => selectView('downtown')}>Close</button><button onClick={() => selectView('top')}>Above</button><button onClick={reset}>Reset</button></div>
    </aside>}
  </div>
}
