import { FrameCounter } from './FrameCounter'
import { FrameTimings } from './performance'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { CloudRainIcon } from '@phosphor-icons/react/dist/csr/CloudRain'
import { rainPresets } from './rain/settings'
import { RainAudio } from './rain/audio'
import { requestWebGPUAdapter, webGPURequiredMessage, WebGPUUnavailableError } from './rain/webgpu'
import { recordings } from './rain/recordings'
import type { RainRecording } from './rain/recordings'
import { neutralGrade, physicalDepth, wiredPatternedGlass } from './settings'
import type { GlassSettings } from './settings'
import type { mountGreenhouse } from './scene'
import type { GlassView } from './view'
import { glassVersions } from './versions'
import type { GlassVersion } from './versions'
import { presentationSettings, savePresentationDefaults, settingsSnapshot } from './presentation'
import { embeddedWireDepth } from './optics'
import { arrangements } from './earlier/arrangements'
import { breezeMax } from './earlier/breeze'
import { presetKey, saveDefaults } from './presets'
import GlassGuide from './guide/GlassGuide'
import type { Arrangement, PresetKey } from './presets'
import './style.css'

const rainPresetHints = {
  Deluge: 'Driving rain and heavy spray',
  'Glass study': 'Slow rain and visible runoff',
  Drizzle: 'Light, scattered drops',
  Shower: 'Steady, moderate rainfall',
  Downpour: 'Heavy rain on glass',
} satisfies Record<keyof typeof rainPresets, string>

function Range({ label, hint, value, min, max, step = .01, display, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step?: number; display?: string; onChange: (value: number) => void
}) {
  return <label className="glass-range" title={hint}><span>{label}<output>{display ?? `${Math.round(value * 100)}%`}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} title={hint} aria-description={hint} onChange={event => onChange(Number(event.target.value))} />
  </label>
}

function Switch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="glass-switch" title={hint}>
    <input type="checkbox" checked={checked} title={hint} aria-description={hint} onChange={event => onChange(event.target.checked)} />{label}
  </label>
}

export default function Glass() {
  const [timings] = useState(() => new FrameTimings())
  const [workbench, setWorkbench] = useState(false)
  const standalone = !workbench
  const [studyVersion, setVersion] = useState<GlassVersion>('earlier')
  const [studyArrangement, setArrangement] = useState<Arrangement>('original')
  const version = standalone ? 'earlier' : studyVersion, arrangement = standalone ? 'original' : studyArrangement
  const sceneKey = presetKey(version, arrangement)
  const [tuning, setTuning] = useState<Record<PresetKey, GlassSettings>>(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const still = (settings: GlassSettings) => ({ ...settings, playing: settings.playing && !reduced })
    const earlier = Object.keys(arrangements).map(key => {
      const arrangement = key as Arrangement
      return [presetKey('earlier', arrangement), still(standalone && arrangement === 'original' ? presentationSettings() : glassVersions.earlier.loadGlassSettings(arrangement))]
    })
    return { ...Object.fromEntries(earlier), current: still(glassVersions.current.loadGlassSettings()) } as Record<PresetKey, GlassSettings>
  })
  const profile = glassVersions[version], defaults = standalone ? presentationSettings() : profile.getDefaults(arrangement)
  const settings = profile.normalizeGlassSettings(tuning[sceneKey])
  // Each mounted renderer owns a stable settings ref, including during cleanup.
  const liveVersions = useRef(Object.fromEntries(Object.entries(tuning).map(([key, settings]) => [key, { current: settings }])) as Record<PresetKey, { current: GlassSettings }>)
  const live = liveVersions.current[sceneKey], host = useRef<HTMLDivElement>(null)
  live.current = settings
  const setSettings = useCallback((value: GlassSettings) => {
    if (!standalone) profile.saveGlassSettings(value)
    setTuning(previous => ({ ...previous, [sceneKey]: value }))
  }, [sceneKey, profile, standalone])
  const world = useRef<ReturnType<typeof mountGreenhouse> | null>(null)
  const [centerTaps, setCenterTaps] = useState(false)
  const centerTapRef = useRef(false)
  useEffect(() => {
    centerTapRef.current = centerTaps
    world.current?.invalidate()
  }, [centerTaps])
  const [guideOpen, setGuideOpen] = useState(false)
  const guideOpenRef = useRef(false)
  const toggleGuide = useCallback((open: boolean) => {
    guideOpenRef.current = open
    world.current?.setSuspended(open)
    setGuideOpen(open)
    if (open) setPanel(false)
  }, [])
  const view = useRef<GlassView | undefined>(undefined)
  const rainAudio = useRef<RainAudio | null>(null)
  const [stormBackend, setStormBackend] = useState<'starting' | 'webgpu'>('starting')
  const [readyPreset, setReadyPreset] = useState<PresetKey | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const ready = readyPreset === sceneKey
  const [saving, setSaving] = useState(false), [saveStatus, setSaveStatus] = useState({ key: sceneKey, text: '' })
  const [panel, setPanel] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null), panelToggle = useRef<HTMLButtonElement>(null)
  const change = useCallback(<K extends keyof GlassSettings>(key: K, value: GlassSettings[K]) => {
    setSaveStatus({ key: sceneKey, text: '' })
    live.current = { ...live.current, [key]: value }
    setSettings(live.current); world.current?.invalidate()
  }, [live, setSettings, sceneKey])
  useEffect(() => {
    const rain = new RainAudio(); rainAudio.current = rain
    return () => { rain.dispose(); rainAudio.current = null }
  }, [])
  useEffect(() => {
    rainAudio.current?.set(ready && !error && version === 'earlier' && settings.rain ? .03 + .97 * settings.rainIntensity : 0, settings.rainVolume, settings.rainRecording)
    if (error) rainAudio.current?.touch(0,settings.rainVolume)
  }, [version, ready, error, settings.rain, settings.rainIntensity, settings.rainVolume, settings.rainRecording])
  useEffect(() => {
    // Discard old bookmark parameters; all scene/menu choices live in React.
    window.history.replaceState(window.history.state, '', window.location.pathname.startsWith('/glass') ? '/glass/' : '/')
  }, [])
  useEffect(() => {
    timings.reset()
    setReadyPreset(null); setError(''); setStormBackend('starting')
    if (!host.current) return
    let cancelled = false, instance: ReturnType<typeof mountGreenhouse> | undefined
    void requestWebGPUAdapter().then(async gpuAdapter => ({ gpuAdapter, module: await profile.loadScene() })).then(({ gpuAdapter, module }) => {
      if (cancelled || !host.current) return
      instance = module.mountGreenhouse(host.current, live, () => { if (!cancelled) setReadyPreset(sceneKey) }, message => { if (!cancelled) setError(message) }, {
        standalone, timings, centerTaps: centerTapRef, gpuAdapter,
        suspended: guideOpenRef.current,
        onRainBackend: backend => { if (!cancelled) setStormBackend(backend) },
        onWaterFlow: flow => rainAudio.current?.touch(flow,live.current.rainVolume),
      })
      if (view.current) instance.setView(view.current)
      world.current = instance
    }).catch(reason => {
      if (cancelled) return
      console.error('Could not create greenhouse.', reason)
      setError(reason instanceof WebGPUUnavailableError ? webGPURequiredMessage : 'The scene could not start. Please reload and check that hardware acceleration is enabled.')
    })
    return () => {
      cancelled = true
      if (instance) {
        view.current = instance.getView(); instance.dispose()
        if (world.current === instance) world.current = null
      }
    }
  }, [retry, sceneKey, profile, live, standalone, timings])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = () => { if (media.matches) change('playing', false) }
    media.addEventListener('change', reduced)
    return () => media.removeEventListener('change', reduced)
  }, [change])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel) { setPanel(false); panelToggle.current?.focus(); return }
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.target instanceof Element && event.target.closest('input, button, select, textarea, a, summary')) return
      if (!standalone && event.code === 'Space') { event.preventDefault(); change('playing', !live.current.playing) }
    }
    const outside = (event: PointerEvent) => {
      if (panel && !panelRef.current?.contains(event.target as Node) && !panelToggle.current?.contains(event.target as Node)) setPanel(false)
    }
    window.addEventListener('keydown', key); document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside) }
  }, [change, panel, standalone])
  const reset = () => {
    setSaveStatus({ key: sceneKey, text: '' })
    live.current = { ...defaults, playing: live.current.playing }
    setSettings(live.current); world.current?.resetView()
  }
  const tune = (values: Partial<GlassSettings>) => {
    setSaveStatus({ key: sceneKey, text: '' })
    live.current = { ...live.current, ...values }
    setSettings(live.current); world.current?.invalidate()
  }
  const saveAsDefaults = async () => {
    const snapshot = { ...live.current }, key = sceneKey
    setSaving(true); setSaveStatus({ key, text: '' })
    try {
      if (standalone) await savePresentationDefaults(snapshot)
      else await saveDefaults(key, snapshot)
      setSaveStatus({ key, text: import.meta.env.DEV ? 'Page defaults saved to the project.' : 'Defaults saved for this browser. Export JSON to keep a portable copy.' })
    } catch (reason) {
      setSaveStatus({ key, text: reason instanceof Error ? reason.message : 'Defaults could not be saved. Try again.' })
    } finally { setSaving(false) }
  }
  const exportSettings = () => {
    const url = URL.createObjectURL(new Blob([settingsSnapshot(live.current) + '\n'], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'glass-original-settings.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const copySettings = async () => {
    try { await navigator.clipboard.writeText(settingsSnapshot(live.current)); setSaveStatus({ key: sceneKey, text: 'Settings JSON copied.' }) }
    catch { setSaveStatus({ key: sceneKey, text: 'Clipboard unavailable. Use Export JSON to save a copy.' }) }
  }
  const referenceDepth = () => tune({ diffusion: defaults.diffusion, depthStrength: defaults.depthStrength, depthScale: defaults.depthScale, depthCurve: defaults.depthCurve, clearDepth: defaults.clearDepth })
  const referenceGrade = () => tune({ contrast: defaults.contrast, saturation: defaults.saturation, blackPoint: defaults.blackPoint, whitePoint: defaults.whitePoint, temperature: defaults.temperature, tint: defaults.tint, grain: defaults.grain, vignette: defaults.vignette })
  return <section className={`glass-experiment ${standalone ? 'glass-standalone' : ''} ${ready && !error ? 'glass-ready' : ''}`} aria-label="Summer, through glass">
    <h1 className="sr-only">Summer, through glass</h1>
    <p className="sr-only" aria-live="polite">{profile.label} version{ready ? ' ready' : ' loading'}</p>
    <button type="button" className="glass-guide-toggle" title="Explore the glass shader" aria-haspopup="dialog" aria-expanded={guideOpen} aria-controls="glass-guide" onClick={() => toggleGuide(true)}>About the glass <span aria-hidden="true">↗</span></button>
    <div ref={host} className={`glass-canvas ${version === 'earlier' ? 'glass-water-mode' : ''}`} role="img" tabIndex={standalone ? 0 : undefined} aria-label={`Sunlit plants behind pebbled glass. ${version === 'earlier' ? 'Left-click or touch to add water. Hold or drag to keep painting. ' : ''}Right-drag or swipe with two fingers to orbit. Scroll or pinch to zoom.${standalone ? ' Arrow keys also orbit.' : ''}`} />
    {!standalone && !ready && !error && <div className="glass-loading" role="status"><span /> <span className="sr-only">Growing the greenhouse…</span></div>}
    {error && <div className={`glass-error ${error === webGPURequiredMessage ? 'glass-compatibility' : ''}`} role="alert"><p>{error}</p><button type="button" title="Restart the greenhouse" onClick={() => setRetry(value => value + 1)}>Reload scene</button></div>}
    <div className="glass-tools">
    <button ref={panelToggle} type="button" className="glass-debug-toggle" title="Show or hide settings" aria-expanded={panel} aria-controls="glass-settings" onClick={() => setPanel(value => !value)}>
      <SlidersHorizontalIcon size={14} /><span>Debug</span>
    </button>
    {version === 'earlier' && <button type="button" className="glass-rain-toggle" aria-pressed={settings.rain} title="Toggle ambient rainfall" onClick={() => change('rain', !settings.rain)}>
      <CloudRainIcon size={15} /><span>Rain {settings.rain ? 'on' : 'off'}</span>
    </button>}
    </div>
    <FrameCounter timings={timings} paused={!settings.playing || guideOpen} storm={version === 'earlier' ? stormBackend : undefined} />
    {panel && <div ref={panelRef} id="glass-settings" className="glass-settings" role="region" aria-label="Scene settings">
      <div className="glass-panel-heading"><span>{standalone ? 'Original · debug' : `${profile.label} study`}</span><button type="button" onClick={reset} title="Restore defaults and camera">{version === 'earlier' ? 'Reset study' : 'Match reference'}</button><button type="button" aria-label="Close debug panel" title="Close (Escape)" onClick={() => setPanel(false)}><XIcon size={16} /></button></div>
      <div className="glass-save-actions"><button type="button" disabled={saving} title="Save current scene defaults" onClick={() => void saveAsDefaults()}>{saving ? 'Saving…' : standalone ? 'Save page defaults' : 'Save as defaults'}</button>{standalone && <><button type="button" title="Download settings as JSON" onClick={exportSettings}>Export JSON</button><button type="button" title="Copy settings to clipboard" onClick={() => void copySettings()}>Copy JSON</button></>}</div>
      <p className="glass-save-status" role="status">{saveStatus.key === sceneKey ? saveStatus.text : ''}</p>
      {standalone && <p className="glass-control-note">Save page defaults locks in the scene; Export JSON keeps a recovery copy.</p>}
      {import.meta.env.DEV && <details className="glass-control-group"><summary title="Compare earlier scene layouts">Archived scenes</summary>
        <Switch label="Compare previous scenes" hint="Open the scene workbench" checked={workbench} onChange={setWorkbench} />
        {workbench && <>
          <div className="glass-presets" role="group" aria-label="Scene renderer"><button type="button" title="Use the earlier scene" aria-pressed={version === 'earlier'} onClick={() => setVersion('earlier')}>Earlier</button><button type="button" title="Use the current scene" aria-pressed={version === 'current'} onClick={() => setVersion('current')}>Current</button></div>
          {version === 'earlier' && <label className="glass-debug-arrangement" title="Choose a plant layout">Arrangement<select title="Choose a plant layout" value={arrangement} onChange={event => setArrangement(event.target.value as Arrangement)}>{Object.entries(arrangements).map(([key, scene]) => <option key={key} value={key}>{scene.label}</option>)}</select></label>}
          <div className="glass-presets"><button type="button" title="Play or pause motion" onClick={() => change('playing', !settings.playing)}>{settings.playing ? 'Pause' : 'Resume'}</button></div>
        </>}
      </details>}
      {version === 'earlier' && <details className="glass-control-group" open={settings.rain}>
        <summary title="Tune rain and impacts">Rain shower</summary>
        {stormBackend === 'webgpu' && <p className="glass-control-note">WebGPU simulation</p>}
        <Switch label="Rain on" hint="Toggle ambient rainfall" checked={settings.rain} onChange={value => change('rain', value)} />
        <Switch label="Debug rain touches" hint="Hold at top center, tap around middle" checked={centerTaps} onChange={setCenterTaps} />
        <details className="glass-control-group"><summary title="Tune water under your finger">Rain brush</summary>
          <Range label="Brush radius" hint="Spread around each touch" min={4} max={700} step={1} value={settings.rainBrushRadius} display={`${settings.rainBrushRadius} px`} onChange={value => change('rainBrushRadius', value)} />
          <Range label="Full hold flow" hint="Multiply rain while held" min={1} max={32} step={.25} value={settings.rainBrushGain} display={`${settings.rainBrushGain.toFixed(2)}×`} onChange={value => change('rainBrushGain', value)} />
          <Range label="Time to full flow" hint="Set hold buildup time" min={.1} max={10} step={.05} value={settings.rainBrushRamp} display={`${settings.rainBrushRamp.toFixed(2)} s`} onChange={value => change('rainBrushRamp', value)} />
          <Range label="Release patter" hint="Set the fading tail" min={0} max={4} step={.05} value={settings.rainBrushTail} display={`${settings.rainBrushTail.toFixed(2)} s`} onChange={value => change('rainBrushTail', value)} />
        </details>
        <div className="glass-presets" role="group" aria-label="Rain presets">
          {(Object.keys(rainPresets) as (keyof typeof rainPresets)[]).map(name => <button key={name} type="button" title={rainPresetHints[name]} onClick={() => tune(rainPresets[name])}>{name}</button>)}
        </div>
        <Range label="Rain intensity" hint="Set the rainfall rate" min={0} max={1} value={settings.rainIntensity} onChange={value => change('rainIntensity', value)} />
        <Range label="Airborne density" hint="Thicken the falling rain" min={.1} max={8} value={settings.rainParticles} display={`${Math.round(settings.rainParticles * 100)}%`} onChange={value => change('rainParticles', value)} />
        <Range label="Storm camera shake" hint="Shake camera on impact" min={0} max={4} value={settings.rainShake} display={settings.rainShake === 0 ? 'Off' : `${settings.rainShake.toFixed(2)}×`} onChange={value => change('rainShake', value)} />
        <Range label="Glass strike rate" hint="Multiply rain hitting glass" min={0} max={64} value={settings.rainGlass} display={`${settings.rainGlass.toFixed(1)}×`} onChange={value => change('rainGlass', value)} />
        <Range label="Rain size" hint="Scale drops and beads" min={.5} max={16} value={settings.rainDropSize} display={`${settings.rainDropSize.toFixed(2)}×`} onChange={value => change('rainDropSize', value)} />
        <Range label="Bead formation" hint="Chance to bead on bare glass" min={0} max={1} value={settings.rainBeadChance} display={`${Math.round(settings.rainBeadChance * 100)}%`} onChange={value => change('rainBeadChance', value)} />
        <Range label="Inherited bead velocity" hint="Maximum randomly inherited speed" min={0} max={1} value={settings.rainBeadVelocity} display={`0–${Math.round(settings.rainBeadVelocity * 100)}%`} onChange={value => change('rainBeadVelocity', value)} />
        <Range label="Bead lifetime" hint="Random duration, up to this limit" min={.05} max={60} step={.05} value={settings.rainBeadLifetime} display={`Up to ${settings.rainBeadLifetime.toFixed(2)} s`} onChange={value => change('rainBeadLifetime', value)} />
        <Range label="Impact footprint" hint="Size of the initial splash rim" min={.1} max={2} value={settings.rainImpactScale} display={`${settings.rainImpactScale.toFixed(2)}×`} onChange={value => change('rainImpactScale', value)} />
        <Range label="Impact smear duration" hint="Time for the brief moving bead" min={0} max={.4} step={.005} value={settings.rainImpactDuration} display={`${Math.round(settings.rainImpactDuration * 1000)} ms`} onChange={value => change('rainImpactDuration', value)} />
        <Range label="Falling speed" hint="Speed up falling drops" min={.15} max={4} value={settings.rainSpeed} display={`${settings.rainSpeed.toFixed(2)}×`} onChange={value => change('rainSpeed', value)} />
        <Range label="Wind direction" hint="Blow rain left or right" min={-1} max={1} value={settings.rainWind} display={Math.abs(settings.rainWind) < .03 ? 'Centered' : `${settings.rainWind < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(settings.rainWind) * 100)}%`} onChange={value => change('rainWind', value)} />
        <Range label="Wind strength" hint="Push rain farther sideways" min={0} max={5} value={settings.rainWindStrength} display={`${settings.rainWindStrength.toFixed(2)}×`} onChange={value => change('rainWindStrength', value)} />
        <Range label="Rain toward glass" hint="Angle rain into pane" min={0} max={1} value={settings.rainIncidence} display={`${Math.round(settings.rainIncidence * 100)}%`} onChange={value => change('rainIncidence', value)} />
        <Range label="Gusts & turbulence" hint="Deepen lulls between squalls" min={0} max={4} value={settings.rainTurbulence} onChange={value => change('rainTurbulence', value)} />
        <Range label="Squall speed" hint="Move and reshape gusts" min={0} max={8} step={.05} value={settings.rainSquallSpeed} display={`${settings.rainSquallSpeed.toFixed(2)}×`} onChange={value => change('rainSquallSpeed', value)} />
        <Range label="Squall size" hint="Widen bands of rain" min={.25} max={6} step={.05} value={settings.rainSquallSize} display={`${settings.rainSquallSize.toFixed(2)} m`} onChange={value => change('rainSquallSize', value)} />
        <Range label="Runoff speed" hint="Speed up sliding beads" min={.25} max={8} value={settings.rainFlow} display={`${settings.rainFlow.toFixed(2)}×`} onChange={value => change('rainFlow', value)} />
        <Range label="Glass friction" hint="Resist beads sliding down" min={.25} max={3} value={settings.rainFriction} display={`${settings.rainFriction.toFixed(2)}×`} onChange={value => change('rainFriction', value)} />
        <Range label="Wet trail persistence" hint="Set trail drying time" min={15} max={600} step={5} value={settings.rainDrying} display={`${settings.rainDrying.toFixed(0)} s`} onChange={value => change('rainDrying', value)} />
        <Range label="Surface tension" hint="Keep small beads pinned" min={.3} max={2} value={settings.rainSurfaceTension} display={`${settings.rainSurfaceTension.toFixed(2)}×`} onChange={value => change('rainSurfaceTension', value)} />
        <Range label="Falling rain visibility" hint="Brighten airborne drops" min={.2} max={2.5} value={settings.rainVisibility} onChange={value => change('rainVisibility', value)} />
        <Range label="Rain shutter" hint="Lengthen airborne motion blur" min={2} max={30} step={1} value={settings.rainShutter} display={`${settings.rainShutter.toFixed(0)} ms`} onChange={value => change('rainShutter', value)} />
        <Range label="Glass meander" hint="Widen sideways bead movement" min={0} max={2} value={settings.rainWander} onChange={value => change('rainWander', value)} />
        <Range label="Leaf impact response" hint="Strengthen each leaf kick" min={0} max={8} value={settings.rainImpact} display={`${settings.rainImpact.toFixed(2)}×`} onChange={value => change('rainImpact', value)} />
        <Range label="Plant flexibility" hint="Let wet foliage bend" min={.35} max={2.5} value={settings.rainFlexibility} display={`${settings.rainFlexibility.toFixed(2)}×`} onChange={value => change('rainFlexibility', value)} />
        <Range label="Main stem stiffness" hint="Steady the main stem" min={1} max={12} step={.1} value={settings.rainMainBranchStiffness} display={`${settings.rainMainBranchStiffness.toFixed(1)}×`} onChange={value => change('rainMainBranchStiffness', value)} />
        <Range label="Side branch stiffness" hint="Resist bending at forks" min={.5} max={5} value={settings.rainBranchStiffness} display={`${settings.rainBranchStiffness.toFixed(2)}×`} onChange={value => change('rainBranchStiffness', value)} />
        <Range label="Water retention" hint="Hold water on leaves" min={.2} max={3} value={settings.rainRetention} display={`${settings.rainRetention.toFixed(2)}×`} onChange={value => change('rainRetention', value)} />
        <Range label="Wet leaf sheen" hint="Strengthen wet leaf highlights" min={0} max={1.5} value={settings.rainWetness} onChange={value => change('rainWetness', value)} />
        <label className="glass-debug-arrangement" title="Choose the looping field recording">Rain ambience<select value={settings.rainRecording} onChange={event => change('rainRecording', event.target.value as RainRecording)}>{Object.entries(recordings).map(([key, recording]) => <option key={key} value={key}>{recording.label}</option>)}</select></label>
        <Range label="Ambience volume" hint="Adjust the recording volume" min={0} max={1} value={settings.rainVolume} onChange={value => change('rainVolume', value)} />
        <p className="glass-control-note">The glass recording follows touch and brush flow. The tin roof recording follows ambient rain.</p>
        <details className="glass-control-group"><summary>Recording credits</summary>
          {Object.values(recordings).map(recording => <p className="glass-control-note" key={recording.source}>
            <a href={recording.source}>{recording.title}</a> by {recording.artist} on Freesound. <a href={recording.licenseUrl}>{recording.license}</a>. {recording.edit}.
          </p>)}
        </details>
        <Range label="Roof runoff" hint="Feed water down chains" min={0} max={2} value={settings.rainChainFlow} display={`${settings.rainChainFlow.toFixed(2)}×`} onChange={value => change('rainChainFlow', value)} />
        <p className="glass-control-note">Click or touch for a short patter. Hold or drag to paint. Right-drag or swipe with two fingers to orbit. Scroll or pinch to zoom.</p>
        {!settings.playing && <p className="glass-control-note">The scene is paused. Turn on Animate scene under Movement to let the rain fall.</p>}
      </details>}
      <details className="glass-control-group" open>
        <summary title="Adjust distance blur">Diffusion</summary>
        <div className="glass-presets"><button type="button" title="Restore saved depth blur" onClick={referenceDepth}>Reference depth</button><button type="button" title="Use actual scene distances" onClick={() => tune(physicalDepth)}>Physical depth</button></div>
        <Range label="Rear surface scattering" hint="Scatter light behind glass" min={0} max={.7} value={settings.diffusion} onChange={value => change('diffusion', value)} />
        <Range label="Depth strength" hint="Intensify distance blur" min={0} max={4} value={settings.depthStrength} display={`${settings.depthStrength.toFixed(2)}×`} onChange={value => change('depthStrength', value)} />
        <Range label="Depth scale" hint="Set blur reference distance" min={.1} max={3} value={settings.depthScale} display={`${settings.depthScale.toFixed(2)} m`} onChange={value => change('depthScale', value)} />
        <Range label="Depth falloff" hint="Shape blur with distance" min={.35} max={3} value={settings.depthCurve} display={settings.depthCurve.toFixed(2)} onChange={value => change('depthCurve', value)} />
        <Range label="Clear zone" hint="Keep nearby leaves sharp" min={0} max={.5} step={.005} value={settings.clearDepth} display={`${Math.round(settings.clearDepth * 100)} cm`} onChange={value => change('clearDepth', value)} />
        <p className="glass-control-note">Higher falloff keeps close leaves clearer and dissolves distant shapes more strongly. Physical depth uses the actual distance.</p>
      </details>
      <details className="glass-control-group">
        <summary title="Tune glass and steel">Glass surface &amp; wire mesh</summary>
        <div className="glass-presets"><button type="button" title="Use embedded steel mesh" onClick={() => tune(wiredPatternedGlass)}>Wired patterned glass</button></div>
        <Range label="Front micro-roughness" hint="Broaden reflected highlights" min={.02} max={.4} step={.005} value={settings.surfaceRoughness ?? defaults.surfaceRoughness} onChange={value => change('surfaceRoughness', value)} />
        <Range label="Glass bump size" hint="Resize the pebble pattern" min={.35} max={3} step={.05} value={settings.textureScale} display={`${settings.textureScale.toFixed(2)}×`} onChange={value => change('textureScale', value)} />
        <Range label="Front bump strength" hint="Deepen front surface bumps" min={0} max={1.5} value={settings.relief} onChange={value => change('relief', value)} />
        <Range label="Rear texture relief" hint="Deepen rear surface bumps" min={0} max={1.5} value={settings.rearRelief} onChange={value => change('rearRelief', value)} />
        <Range label="Index of refraction" hint="Bend light entering glass" min={1.01} max={1.8} value={settings.ior} display={settings.ior.toFixed(2)} onChange={value => change('ior', value)} />
        <Range label="Pane thickness" hint="Set glass slab thickness" min={.006} max={.012} step={.0005} value={settings.thickness} display={`${(settings.thickness * 1000).toFixed(1)} mm`} onChange={value => change('thickness', value)} />
        <Range label="Grid spacing" hint="Space the strands apart" min={.018} max={.07} step={.001} value={settings.wireSpacing} display={`${Math.round(settings.wireSpacing * 1000)} mm`} onChange={value => change('wireSpacing', value)} />
        <p className="glass-control-note">Bump size changes the spacing of the pebbles; bump strength changes their height. Both reflection and refraction follow the surface. Wire thickness changes the actual embedded strands.</p>
        <Switch label="Embedded wire mesh" hint="Show the steel lattice" checked={settings.embeddedMesh} onChange={value => change('embeddedMesh', value)} />
        {settings.embeddedMesh && <>
          <Range label="Wire thickness" hint="Thicken the steel strands" min={.0002} max={.0009} step={.00001} value={settings.wireRadius} display={`${(settings.wireRadius * 2000).toFixed(2)} mm`} onChange={value => change('wireRadius', value)} />
          <Range label="Mesh embed depth" hint="Shift steel within glass" min={.15} max={.85} value={settings.wireDepth} display={`${(embeddedWireDepth(settings.thickness, settings.wireRadius, settings.wireDepth, settings.relief, settings.rearRelief) * 1000).toFixed(1)} mm`} onChange={value => change('wireDepth', value)} />
          <Range label="Mesh roughness" hint="Soften steel highlights" min={.08} max={.85} value={settings.wireRoughness} onChange={value => change('wireRoughness', value)} />
          <Range label="Mesh oxidation" hint="Tarnish the steel" min={0} max={1} value={settings.wirePatina} onChange={value => change('wirePatina', value)} />
        </>}
        <Switch label="Look through the glass" hint="View plants through glass" checked={settings.glass} onChange={value => change('glass', value)} />
      </details>
      <details className="glass-control-group">
        <summary title="Shape the raised glass grid">Optional glass grid relief</summary>
        <Range label="Grid crest height" hint="Raise the glass ridges" min={0} max={.0008} step={.00001} value={settings.gridRelief} display={`${(settings.gridRelief * 1000).toFixed(2)} mm`} onChange={value => change('gridRelief', value)} />
        <Range label="Grid crest width" hint="Widen the glass ridges" min={.0002} max={.002} step={.00001} value={settings.gridWidth} display={`${(settings.gridWidth * 2000).toFixed(2)} mm`} onChange={value => change('gridWidth', value)} />
        <Range label="Pebbling across crests" hint="Texture the raised ridges" min={0} max={1} value={settings.gridPebbling} onChange={value => change('gridPebbling', value)} />
        <p className="glass-control-note">Adds a raised glass lattice. Keep crest height at zero for the wired obscure glass construction.</p>
      </details>
      {version === 'current' && <details className="glass-control-group" open>
        <summary title="Balance greenhouse lighting">Light &amp; shadow</summary>
        <Range label="Glass reflections" hint="Strengthen reflected light" min={0} max={2.5} value={settings.reflectionStrength} display={`${settings.reflectionStrength.toFixed(2)}×`} onChange={value => change('reflectionStrength', value)} />
        <Range label="Sky fill" hint="Light shadows from above" min={0} max={.8} value={settings.skyFill} onChange={value => change('skyFill', value)} />
        <Range label="Recess brightness" hint="Light the rear alcove" min={0} max={1.5} value={settings.recessBrightness} onChange={value => change('recessBrightness', value)} />
        <p className="glass-control-note">Lower sky fill deepens foliage shadows. Recess brightness controls the dark space behind the plants; glass reflections keep the surface glints independent.</p>
      </details>}
      <details className="glass-control-group" open>
        <summary title="Grade the final image">Color &amp; tone</summary>
        <div className="glass-presets"><button type="button" title="Restore saved color grade" onClick={referenceGrade}>Reference grade</button><button type="button" title="Reset to neutral color" onClick={() => tune(neutralGrade)}>Neutral grade</button></div>
        <Range label="Exposure" hint="Adjust overall brightness" min={.4} max={1.6} value={settings.exposure} display={`${settings.exposure.toFixed(2)}×`} onChange={value => change('exposure', value)} />
        <Range label="Contrast" hint="Separate lights and darks" min={.65} max={1.8} value={settings.contrast} display={`${settings.contrast.toFixed(2)}×`} onChange={value => change('contrast', value)} />
        <Range label="Saturation" hint="Adjust color intensity" min={0} max={1.5} value={settings.saturation} onChange={value => change('saturation', value)} />
        <Range label="Black point" hint="Set the darkest cutoff" min={0} max={.12} step={.002} value={settings.blackPoint} onChange={value => change('blackPoint', value)} />
        <Range label="White point" hint="Set the brightest cutoff" min={.65} max={1.2} value={settings.whitePoint} onChange={value => change('whitePoint', value)} />
        <Range label="Warmth" hint="Shift blue to amber" min={-.5} max={.5} value={settings.temperature} display={settings.temperature.toFixed(2)} onChange={value => change('temperature', value)} />
        <Range label="Green / magenta" hint="Shift the color tint" min={-.3} max={.3} value={settings.tint} display={settings.tint.toFixed(2)} onChange={value => change('tint', value)} />
        <Range label="Film grain" hint="Add fine image grain" min={0} max={.035} step={.001} value={settings.grain} display={`${Math.round(settings.grain * 1000)}`} onChange={value => change('grain', value)} />
        <Range label="Vignette" hint="Darken the image edges" min={0} max={.5} value={settings.vignette} onChange={value => change('vignette', value)} />
      </details>
      <details className="glass-control-group">
        <summary title="Adjust plants and camera">Movement</summary>
        {standalone && <Switch label="Animate scene" hint="Play or pause motion" checked={settings.playing} onChange={value => change('playing', value)} />}
        <Range label="Breeze" hint="Sway leaves and stems" min={0} max={version === 'earlier' && arrangements[arrangement].motion === 'breeze' ? breezeMax : 1.5} value={settings.breeze} onChange={value => change('breeze', value)} />
        {version === 'earlier' && arrangements[arrangement].motion === 'split' && <p className="glass-control-note">Breeze drives both sides: spring movement on the left, original sway on the right. Zero lets the left plant settle.</p>}
        {version === 'earlier' && arrangements[arrangement].motion === 'breeze' && <p className="glass-control-note">Breeze reaches 500%: slow branch sway, individual leaf twist and soft tip flutter. Zero holds the foliage still.</p>}
        <Range label="Camera drift" hint="Add slow camera movement" min={0} max={1.5} value={settings.drift} onChange={value => change('drift', value)} />

      </details>
      {standalone && <details className="glass-control-group"><summary title="Inspect current scene values">Settings snapshot</summary><textarea id="glass-settings-snapshot" className="glass-snapshot" title="Inspect current settings JSON" aria-label="Current Original settings JSON" readOnly value={settingsSnapshot(settings)} spellCheck={false} /></details>}
    </div>}
    {guideOpen && <GlassGuide onClose={() => toggleGuide(false)} />}
  </section>
}
