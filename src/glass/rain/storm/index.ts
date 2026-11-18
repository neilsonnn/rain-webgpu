import { DataTexture, Group, RGBAFormat, Vector2, Vector3, Vector4 } from 'three'
import type { WebGLRenderer } from 'three'
import type { GlassSettings } from '../../settings'
import type { FrameTimings } from '../../performance'
import type { PaneSize } from '../../earlier/pane'
import type { createRainPlants } from '../plants'
import type { createRainHanging } from './hanging'
import { createGpuStorm } from './gpu'
import { createStormColliders } from './colliders'
import { createStormShake } from './shake'
import { stormBudget } from './budget'
import { rainDiameter } from '../settings'
import { rainVelocity } from '../weather'
import { createRainCurtain } from '../curtain'
import { createSqualls } from '../squalls'
import { createPaneFilm } from '../film'
import { WebGPUUnavailableError } from '../webgpu'
import type { RainTerrain } from '../terrain'

export function createStorm(renderer: WebGLRenderer, plants: ReturnType<typeof createRainPlants>,
  hanging: ReturnType<typeof createRainHanging>, readSettings: () => GlassSettings, pane?: PaneSize, onReady?: () => void, timings?: FrameTimings, options: { adapter?: GPUAdapter; terrain?: Pick<RainTerrain,'texture'|'grid'>; onFailure?: (message: string) => void } = {}) {
  const mesh = new Group(), front = new Group(), shake = createStormShake()
  const width = pane?.width ?? 4.8, height = pane?.height ?? 4.8, centerY = pane?.centerY ?? 1.8
  const bounds = new Vector4(-width * .5, centerY - height * .5, width, height)
  const squalls = createSqualls(bounds)
  const film = createPaneFilm(bounds)
  const blank = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat); blank.needsUpdate = true
  const colliders = createStormColliders(plants, hanging.colliders), dripVelocity = new Vector3(0, -.3, 0)
  plants.colliders(12, readSettings().breeze, false)
  const uniforms = { uRainResolution: { value: new Vector2(1, 1) } }
  let gpu: Awaited<ReturnType<typeof createGpuStorm>> | undefined
  let curtain: ReturnType<typeof createRainCurtain> | undefined
  let started = false, disposed = false, failed = false, strength = 0, wetUntil = 0, clock = 12
  let plantsMoving = false, nextSettleCheck = 0
  // Keep taps during asynchronous GPU startup, including on a dry, paused pane.
  const strokes = Array.from({ length: 48 }, () => ({ ax: 0, ay: 0, bx: 0, by: 0, radius: 0, pressure: 0, dt: 0, hits: 0, push: false }))
  const point = new Vector3(), velocity = new Vector3()
  let strokeCount = 0
  function applyStrokes(settings: GlassSettings) {
    if (!gpu || !strokeCount) return
    const intensity = Math.max(.65, strength)
    let requested = 0
    for (let i = 0; i < strokeCount; i++) requested += strokes[i].hits
    const share = Math.min(1, stormBudget.brushCommands / Math.max(1, requested))
    let cumulative = 0, allocated = 0
    for (let i = 0; i < strokeCount; i++) {
      const { ax, ay, bx, by, radius, pressure, dt, hits, push } = strokes[i]
      if (push) {
        film.stroke(ax,ay,bx,by,radius,pressure)
        gpu.stroke(ax, ay, bx, by, radius, pressure, dt)
      }
      // A center tap and a real brush stroke can share the same frame.
      cumulative += hits
      const count = Math.round(cumulative * share) - allocated
      allocated += count
      for (let j = 0; j < hits; j++) {
        const t = (j + Math.random()) / hits
        // The minimum of two uniform area samples gives a density proportional
        // to 1-r², with occasional isolated drops out near the edge.
        const radial = Math.sqrt(Math.min(Math.random(), Math.random()))
        const angle = Math.random() * Math.PI * 2, spread = radius * radial
        point.set(ax + (bx - ax) * t + spread * Math.cos(angle), ay + (by - ay) * t + spread * Math.sin(angle), 0)
        if (point.x < bounds.x || point.x > bounds.x + bounds.z || point.y < bounds.y || point.y > bounds.y + bounds.w) continue
        const diameter = rainDiameter(.35 + .65 * Math.random(), intensity, settings.rainDropSize) * (1 - .38 * radial * radial)
        if (Math.floor((j+1)*count/hits) === Math.floor(j*count/hits)) { film.contact(point.x,point.y,diameter,clock); continue }
        rainVelocity(velocity, point, clock, settings, intensity, diameter, squalls.phase)
        velocity.z = -Math.max(Math.abs(velocity.z), 2 + 3 * Math.random())
        gpu.paneHit(point, velocity, diameter)
      }
    }
    strokeCount = 0
  }
  const emitDrip = (point: Vector3, velocity: Vector3, diameter: number) => {
    gpu?.drip(point, velocity, diameter)
  }
  const leafDrip = (point: Vector3, diameter: number) => emitDrip(point, dripVelocity, diameter)
  function fail(error: unknown) {
    if (disposed || failed) return
    failed = true
    console.error('WebGPU simulation stopped.',error)
    gpu?.dispose(); gpu = undefined
    mesh.clear(); front.clear()
    options.onFailure?.(error instanceof WebGPUUnavailableError ? error.message : 'The WebGPU simulation stopped. Please reload the scene.')
  }
  function initialize() {
    if (started || disposed || failed) return
    started = true
    void createGpuStorm(renderer, bounds, colliders, squalls, {
      hit(index, point, velocity, diameter) {
        const settings = readSettings()
        if (disposed || !settings.playing) return
        if (index < plants.blades.length) {
          plantsMoving = true
          plants.impact(index, point, velocity, diameter, settings)
        }
        else hanging.hit(index - plants.blades.length, point, velocity, diameter)
      },
      pressure(energy, hits) { if (!disposed && readSettings().playing) shake.pressure(energy, hits) },
    }, timings, { adapter: options.adapter, terrain: options.terrain, onFailure: fail }).then(value => {
      if (disposed || failed) { value.dispose(); return }
      gpu = value; mesh.add(value.mesh); front.add(value.front); onReady?.()
    }).catch(fail)
  }
  queueMicrotask(initialize)

  // A stable object is retained by the glass and pointer handlers while the
  // required WebGPU renderer initializes.
  const surface = {
    get ready() { return Boolean(gpu) && !failed },
    get texture() { return gpu?.texture ?? blank },
    get bounds() { return bounds },
    texel: 1 / 1536,
    stroke(ax: number, ay: number, bx: number, by: number, radius: number, pressure: number, dt: number, hits: number, push: boolean) {
      if (disposed || failed) return
      initialize()
      const slot = strokes[Math.min(strokeCount, strokes.length - 1)]
      slot.ax = ax; slot.ay = ay; slot.bx = bx; slot.by = by
      slot.radius = radius; slot.pressure = pressure; slot.dt = dt; slot.hits = hits; slot.push = push
      strokeCount = Math.min(strokes.length, strokeCount + 1)
      const settings=readSettings()
      wetUntil = Math.max(wetUntil, clock + settings.rainBeadLifetime + settings.rainDrying)
    },
  }
  return {
    mesh, front, surface, uniforms, shake,
    get strength() { return strength },
    get wetness() { return Number(clock < wetUntil) },
    get backend(): 'webgpu' | 'starting' { return gpu ? 'webgpu' : 'starting' },
    update(dt: number, settings: GlassSettings, time: number) {
      if (disposed || failed) return
      clock = time
      if (gpu?.lost) { fail(new Error('WebGPU device lost')); return }
      applyStrokes(settings)
      strength += ((settings.rain ? settings.rainIntensity : 0) - strength) * (1 - Math.exp(-dt * 1.7))
      if (strength < .0001) strength = 0
      squalls.update(dt, settings, strength)
      if (strength > .0001) wetUntil = time + Math.max(40, settings.rainBeadLifetime + settings.rainDrying)
      hanging.update(dt, time, settings, strength, emitDrip)
      if (gpu) {
        if (plantsMoving && dt > 0) {
          const steps = Math.ceil(dt * 120), substep = dt / steps
          for (let step = 0; step < steps; step++) plants.step(substep, settings, strength, leafDrip, undefined, true)
          plants.upload()
          if (time >= nextSettleCheck) {
            plantsMoving = !plants.settled()
            nextSettleCheck = time + .25
          }
        }
        gpu.uniforms.uRainResolution.value.copy(uniforms.uRainResolution.value)
        gpu.update(dt, time, strength, settings)
      }
      if (!curtain && gpu && strength > 0 && settings.rainParticles > 1) {
        curtain = createRainCurtain(bounds, uniforms.uRainResolution, squalls)
        mesh.add(curtain.back); front.add(curtain.front)
      }
      curtain?.update(dt, time, settings, strength)
      film.update(dt,time,0,strength,settings,squalls)
      shake.update(dt, time, settings.rainShake, strength)
      mesh.visible = front.visible = Boolean(gpu) && !failed && (strength > 0 || time < wetUntil)
    },
    renderWater() {
      if (!mesh.visible) return
      film.step(renderer,gpu)
      gpu?.renderWater(renderer,film.draw)
    },
    dispose() {
      disposed = true; film.dispose(); curtain?.dispose(); squalls.dispose(); gpu?.dispose(); blank.dispose(); mesh.clear(); front.clear()
    },
  }
}
