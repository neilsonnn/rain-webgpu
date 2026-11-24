import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import { orbitLimits, softenOrbit, SoftOrbitControls } from '../src/glass/orbit'

class Surface extends EventTarget {
  clientHeight = 800
  style = { touchAction: 'pan-y' }
  capture = new Set<number>()
  focus = vi.fn()
  setPointerCapture(id: number) { this.capture.add(id) }
  hasPointerCapture(id: number) { return this.capture.has(id) }
  releasePointerCapture(id: number) { this.capture.delete(id) }
}
function pointer(surface: Surface, type: string, x: number, y: number, id = 1, pointerType = 'mouse', button = 0) {
  surface.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: id, pointerType, button }))
}
function setup() {
  const camera = new PerspectiveCamera(), surface = new Surface(), target = new Vector3(0, 1.8, -.4)
  camera.position.set(0, 1.8, 2.25)
  const orbit = new SoftOrbitControls(camera, surface as unknown as HTMLElement, target)
  const pose = () => new Spherical().setFromVector3(camera.position.clone().sub(orbit.target))
  return { camera, surface, orbit, pose }
}

describe('standalone greenhouse orbit', () => {
  it('keeps central motion linear, then consumes the remaining angle exponentially in both directions', () => {
    const min = -.48, max = .48, zone = .216
    expect(softenOrbit(0, .1, min, max, zone)).toBe(.1)
    for (const sign of [-1, 1]) {
      let at = sign * (max - zone)
      const remaining: number[] = []
      for (let i = 0; i < 6; i++) {
        at = softenOrbit(at, sign * .1, min, max, zone)
        remaining.push(max - Math.abs(at))
      }
      for (let i = 1; i < remaining.length; i++) expect(remaining[i] / remaining[i - 1]).toBeCloseTo(Math.exp(-.1 / zone), 12)
      const reverse = softenOrbit(at, -sign * .02, min, max, zone)
      expect(reverse).toBeCloseTo(at - sign * .02, 12)
    }
  })
  it('never overshoots and gives the same endpoint for one large drag or many small moves', () => {
    for (const sign of [-1, 1]) {
      let fine = 0
      for (let i = 0; i < 400; i++) fine = softenOrbit(fine, sign * .005, -.48, .48, .216)
      expect(fine).toBeCloseTo(softenOrbit(0, sign * 2, -.48, .48, .216), 12)
      const huge = softenOrbit(fine, sign * 1e6, -.48, .48, .216)
      expect(Math.abs(huge)).toBeLessThanOrEqual(.48)
      expect(softenOrbit(huge, -sign * .05, -.48, .48, .216)).toBeCloseTo(huge - sign * .05, 12)
    }
  })
  it('reserves primary input for water and applies the same soft stops to right drag and touch navigation', () => {
    const { orbit, surface, pose } = setup()
    orbit.enableDamping = false
    for (const type of ['mouse', 'touch']) {
      pointer(surface, 'pointerdown', 400, 400, 1, type)
      pointer(surface, 'pointermove', 230, 490, 1, type)
      pointer(surface, 'pointerup', 230, 490, 1, type)
    }
    orbit.update()
    expect(pose().theta).toBe(0)
    pointer(surface, 'pointerdown', 400, 400, 1, 'mouse', 2)
    pointer(surface, 'pointermove', 230, 490, 1, 'mouse', 2)
    orbit.update()
    const rightDrag = pose()
    expect(rightDrag.theta).toBeGreaterThan(.3)
    expect(rightDrag.theta).toBeLessThan(orbitLimits.yaw)
    pointer(surface, 'pointerup', 230, 490, 1, 'mouse', 2)
    expect(surface.capture.size).toBe(0)
    orbit.reset(); orbit.drag(-170, 90); orbit.update()
    expect(pose().theta).toBeCloseTo(rightDrag.theta, 12)
    expect(pose().phi).toBeCloseTo(rightDrag.phi, 12)
    orbit.dispose()
    expect(surface.style.touchAction).toBe('pan-y')
  })
  it('retains wheel/pinch zoom, clamps distance, and restores the original pose', () => {
    const { orbit, surface, pose } = setup()
    orbit.saveState()
    const initial = pose().radius
    orbit.drag(0, 0, .8); orbit.update()
    expect(pose().radius).toBeCloseTo(initial * .8 ** 2, 10)
    orbit.update()
    expect(pose().radius).toBeCloseTo(initial * .8 ** 2, 10)
    orbit.enableDamping = false
    for (let i = 0; i < 8; i++) {
      surface.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 10000, deltaMode: 0 }))
      orbit.update()
    }
    expect(pose().radius).toBeCloseTo(1.8, 12)
    orbit.reset()
    expect(pose().theta).toBe(0); expect(pose().phi).toBeCloseTo(Math.PI / 2, 12); expect(pose().radius).toBeCloseTo(initial, 12)
    orbit.dispose()
  })
  it('amplifies trackpad pinches on the first frame while keeping regular wheel zoom damped', () => {
    const { orbit, surface, pose } = setup()
    const initial = pose().radius
    const wheel = (ctrlKey: boolean) => surface.dispatchEvent(Object.assign(
      new Event('wheel', { cancelable: true }), { deltaY: -60, deltaMode: 0, ctrlKey },
    ))
    wheel(false); orbit.update()
    expect(pose().radius).toBeCloseTo(initial * .95 ** (60 * .006 * -Math.expm1(-9 / 60)), 10)
    orbit.reset()
    wheel(true); orbit.update()
    expect(pose().radius).toBeCloseTo(initial * .95 ** (60 * .006 * 12), 10)
    orbit.update()
    expect(pose().radius).toBeCloseTo(initial * .95 ** (60 * .006 * 12), 10)
    orbit.dispose()
  })
})
