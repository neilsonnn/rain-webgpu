import { EventDispatcher, PerspectiveCamera, Spherical, Vector2, Vector3 } from 'three'

export const orbitLimits = { yaw: .48, pitch: .26, softZone: .45, minDistance: 1.05, maxDistance: 4.8 } as const

// The final part of each outward drag consumes the remaining angle
// exponentially. Reverse input responds immediately, without hidden overscroll.
export function softenOrbit(angle: number, delta: number, min: number, max: number, zone: number) {
  const at = Math.max(min, Math.min(max, angle))
  if (!delta) return at
  const direction = Math.sign(delta), edge = direction > 0 ? max : min
  const distance = Math.abs(edge - at), linear = Math.max(0, distance - zone), travel = Math.abs(delta)
  if (travel <= linear) return at + delta
  const remaining = Math.min(distance, zone)
  return edge - direction * remaining * Math.exp(-(travel - linear) / zone)
}

type OrbitEvents = { change: {}; start: {}; end: {} }

// Mouse and touch navigation share the same angular response and soft stops.
export class SoftOrbitControls extends EventDispatcher<OrbitEvents> {
  readonly target: Vector3
  enableDamping = true
  private readonly pending = new Vector2()
  private pendingZoom = 0
  private readonly sphere = new Spherical()
  private readonly offset = new Vector3()
  private mouseId: number | null = null
  private readonly mouseAt = new Vector2()
  private readonly savedPosition: Vector3
  private readonly savedTarget: Vector3
  private readonly oldTouchAction: string

  constructor(private camera: PerspectiveCamera, private element: HTMLElement, target: Vector3) {
    super()
    this.target = target.clone()
    this.savedPosition = camera.position.clone(); this.savedTarget = this.target.clone()
    this.oldTouchAction = element.style.touchAction; element.style.touchAction = 'none'
    element.addEventListener('pointerdown', this.down)
    element.addEventListener('pointermove', this.move)
    element.addEventListener('pointerup', this.up)
    element.addEventListener('pointercancel', this.cancel)
    element.addEventListener('lostpointercapture', this.cancel)
    element.addEventListener('wheel', this.wheel, { passive: false })
    element.addEventListener('keydown', this.key)
    this.update()
  }

  private turn(x: number, y: number) {
    // Clear residual outward momentum when the user turns back from an edge.
    if (this.pending.x * x < 0) this.pending.x = 0
    if (this.pending.y * y < 0) this.pending.y = 0
    this.pending.x += x; this.pending.y += y
    this.dispatchEvent({ type: 'change' })
  }
  drag(dx: number, dy: number, distanceRatio = 1) {
    const scale = Math.PI * 2 * .35 / Math.max(1, this.element.clientHeight)
    this.pendingZoom += Math.log(distanceRatio)
    this.turn(-dx * scale, -dy * scale)
  }
  private down = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 2 || this.mouseId !== null) return
    event.preventDefault()
    this.mouseId = event.pointerId
    this.mouseAt.set(event.clientX, event.clientY)
    this.element.setPointerCapture(event.pointerId)
    this.element.focus({ preventScroll: true })
    this.pending.set(0, 0); this.dispatchEvent({ type: 'start' })
  }
  private move = (event: PointerEvent) => {
    if (this.mouseId !== event.pointerId) return
    this.drag(event.clientX - this.mouseAt.x, event.clientY - this.mouseAt.y)
    this.mouseAt.set(event.clientX, event.clientY)
  }
  private up = (event: PointerEvent) => {
    if (this.mouseId !== event.pointerId) return
    this.mouseId = null
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId)
    this.dispatchEvent({ type: 'end' })
  }
  private cancel = (event: PointerEvent) => {
    if (this.mouseId !== event.pointerId) return
    this.pending.set(0, 0); this.pendingZoom = 0
    this.up(event)
  }
  private wheel = (event: WheelEvent) => {
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.element.clientHeight : 1
    this.pendingZoom += event.deltaY * unit * -Math.log(.95) * .006
    this.dispatchEvent({ type: 'change' })
  }
  private key = (event: KeyboardEvent) => {
    const turns: Record<string, [number, number]> = { ArrowLeft: [-.06, 0], ArrowRight: [.06, 0], ArrowUp: [0, -.04], ArrowDown: [0, .04] }
    const turn = turns[event.key]
    if (!turn || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault(); this.turn(...turn)
  }

  update(deltaTime = 1 / 60) {
    this.sphere.setFromVector3(this.offset.copy(this.camera.position).sub(this.target))
    const weight = this.enableDamping ? -Math.expm1(-Math.max(0, Math.min(deltaTime, .1)) * 9) : 1
    this.sphere.theta = softenOrbit(this.sphere.theta, this.pending.x * weight, -orbitLimits.yaw, orbitLimits.yaw, orbitLimits.yaw * orbitLimits.softZone)
    this.sphere.phi = softenOrbit(this.sphere.phi, this.pending.y * weight, Math.PI / 2 - orbitLimits.pitch, Math.PI / 2 + orbitLimits.pitch, orbitLimits.pitch * orbitLimits.softZone)
    const zoom = Math.max(-1, Math.min(1, this.pendingZoom * weight))
    this.sphere.radius = Math.max(orbitLimits.minDistance, Math.min(orbitLimits.maxDistance, this.sphere.radius * Math.exp(zoom)))
    this.pending.multiplyScalar(1 - weight); this.pendingZoom *= 1 - weight
    if (this.pending.lengthSq() < 1e-12) this.pending.set(0, 0)
    if (Math.abs(this.pendingZoom) < 1e-6) this.pendingZoom = 0
    this.offset.setFromSpherical(this.sphere).add(this.target)
    const changed = this.camera.position.distanceToSquared(this.offset) > 1e-14
    this.camera.position.copy(this.offset); this.camera.lookAt(this.target)
    if (changed) this.dispatchEvent({ type: 'change' })
    return changed
  }
  saveState() { this.savedPosition.copy(this.camera.position); this.savedTarget.copy(this.target) }
  reset() {
    this.pending.set(0, 0); this.pendingZoom = 0
    this.camera.position.copy(this.savedPosition); this.target.copy(this.savedTarget)
    this.update(); this.dispatchEvent({ type: 'change' })
  }
  dispose() {
    this.element.removeEventListener('pointerdown', this.down)
    this.element.removeEventListener('pointermove', this.move)
    this.element.removeEventListener('pointerup', this.up)
    this.element.removeEventListener('pointercancel', this.cancel)
    this.element.removeEventListener('lostpointercapture', this.cancel)
    this.element.removeEventListener('wheel', this.wheel)
    this.element.removeEventListener('keydown', this.key)
    if (this.mouseId !== null && this.element.hasPointerCapture(this.mouseId)) this.element.releasePointerCapture(this.mouseId)
    this.mouseId = null; this.element.style.touchAction = this.oldTouchAction
  }
}
