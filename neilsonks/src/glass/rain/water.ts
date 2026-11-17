import { DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType, Vector4 } from 'three'
import type { WebGLRenderer } from 'three'
import type { GlassSettings } from '../settings'
import type { PaneSize } from '../earlier/pane'
import type { RainTerrain } from './terrain'
import { createWebGPUFluid } from './fluid/webgpu'
import { createWebGLFluid } from './fluid/webgl'
import { fluidBudget } from './fluid/types'
import type { FluidBackend, FluidBatch } from './fluid/types'
import { PaneHydrology } from './hydrology'
export type { PaneImpact } from './hydrology'

export const rainDomain = { width: 4.8, height: 4.8, centerY: 1.8 }
export function createPaneWater(renderer: WebGLRenderer, terrain: RainTerrain, pane?: PaneSize, onReady?: () => void) {
  const span=pane ? Math.max(pane.width,pane.height) : rainDomain.width, centerY=pane?.centerY ?? rainDomain.centerY
  const bounds=new Vector4(-span/2,centerY-span/2,span,span)
  const edges=new Vector4(-(pane?.width ?? span)/2,centerY-(pane?.height ?? span)/2,(pane?.width ?? span)/2,centerY+(pane?.height ?? span)/2)
  const blank=new DataTexture(new Uint8Array([0,0,0,255]),1,1,RGBAFormat,UnsignedByteType)
  blank.colorSpace=NoColorSpace; blank.minFilter=blank.magFilter=LinearFilter; blank.needsUpdate=true
  let backend: FluidBackend | undefined, hydrology: PaneHydrology | undefined, batch: FluidBatch | undefined
  let disposed=false, pending=false, hasWater=false, accumulator=0, brushCount=0, dirty=true, weatherTime=12
  let settings: GlassSettings | undefined
  const brushes=new Float32Array(fluidBudget.brushes*8)
  const fallback=() => { backend=createWebGLFluid() }
  function initialize() {
    if (disposed || pending || backend) return
    hydrology ??= new PaneHydrology(bounds,edges,terrain)
    if (settings) hydrology.configure(settings)
    batch={ parameters:new Float32Array([span,span,bounds.x,bounds.y,fluidBudget.resolution,fluidBudget.optical,0,0]),
      shapes:hydrology.shapes, count:0, film:hydrology.film, revision:0 }
    pending=true
    void createWebGPUFluid().then(value => {
      if (disposed) { value?.dispose(); return }
      if (value) backend=value; else fallback()
    }).catch(error => {
      if (disposed) return
      console.warn('WebGPU water unavailable; using WebGL2 water.',error); fallback()
    }).finally(() => { pending=false; if (!disposed) onReady?.() })
  }
  return {
    bounds, texel:1/fluidBudget.optical,
    get texture() { return backend?.texture ?? blank },
    get ready() { return Boolean(backend) },
    get backend() { return backend?.kind ?? 'starting' },
    get wetness() { return Number(hasWater) },
    configure(s: GlassSettings) { settings=s; hydrology?.configure(s); if (s.rain || s.rainTouch) initialize() },
    step(dt: number, time?: number) {
      if (time!==undefined) weatherTime=time
      accumulator=Math.min(fluidBudget.maxSteps*fluidBudget.step,accumulator+Math.max(0,dt))
    },
    strike(x: number, y: number, diameter: number, speed: number, vx: number, vy: number, allowSpray=true) {
      initialize(); hasWater=dirty=true
      return hydrology!.strike(x,y,diameter,speed,vx,vy,allowSpray)
    },
    stroke(x0: number, y0: number, x1: number, y1: number, radius: number, pressure: number, dt: number) {
      initialize(); dirty=true
      const index=Math.min(brushCount,fluidBudget.brushes-1), at=index*8
      if (brushCount<fluidBudget.brushes) { brushes[at]=x0; brushes[at+1]=y0; brushCount++ }
      brushes[at+2]=x1; brushes[at+3]=y1; brushes[at+4]=radius; brushes[at+5]=pressure; brushes[at+6]=dt
    },
    render() {
      if (!backend || !hydrology || !batch || !settings) return
      if (backend.lost) { backend.dispose(); fallback(); dirty=true }
      const steps=Math.min(fluidBudget.maxSteps,Math.floor((accumulator+1e-8)/fluidBudget.step))
      if (!hasWater && !brushCount) { accumulator=0; return }
      if (!steps && !dirty && !brushCount) return
      for (let i=0;i<brushCount;i++) {
        const at=i*8
        hydrology.stroke(brushes[at],brushes[at+1],brushes[at+2],brushes[at+3],brushes[at+4],brushes[at+5],brushes[at+6])
      }
      brushCount=0
      hydrology.time=Math.max(hydrology.time,weatherTime-steps*fluidBudget.step)
      for (let i=0;i<steps;i++) hydrology.step(fluidBudget.step)
      accumulator=Math.max(0,accumulator-steps*fluidBudget.step)
      hydrology.pack(); batch.count=hydrology.count; batch.revision=hydrology.revision
      backend.render(batch,renderer); dirty=false
    },
    dispose() { disposed=true; backend?.dispose(); blank.dispose(); hydrology=undefined; batch=undefined },
  }
}
