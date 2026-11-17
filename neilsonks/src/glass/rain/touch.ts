import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import type { GlassSettings } from '../settings'

const between = (low: number, high: number) => low + Math.random() * (high - low)
function emptyPress() {
  return { down: false, virtual: false, moved: false, anchored: false,
    screenX: 0, screenY: 0, force: 0, x: 0, y: 0, radius: 0,
    start: 0, last: 0, carry: 0, pending: 0, next: 0, tailAt: 0, tailEnd: 0, flow: 0 }
}
type Press = ReturnType<typeof emptyPress>
type Contact = { touch: boolean; x: number; y: number; force: number; due: number; patter?: Press }
type Pair = { a: Contact; b: Contact; x: number; y: number; span: number; orbiting: boolean }

export function attachWaterTouch(host: HTMLElement, camera: PerspectiveCamera, settings: () => GlassSettings,
  water: { readonly ready: boolean; stroke(ax: number, ay: number, bx: number, by: number, radius: number, pressure: number, dt: number, hits: number, push: boolean): void },
  invalidate: () => void, begin: () => void, orbit: (dx: number, dy: number, distanceRatio: number) => void,
  onFlow?: (flow: number) => void) {
  const ray = new Raycaster(), ndc = new Vector2(), plane = new Plane(new Vector3(0, 0, 1), 0), point = new Vector3()
  const pool = Array.from({ length: 24 }, emptyPress), fingers = new Map<number, Contact>()
  let pair: Pair | undefined
  let steady: Press | undefined, wandering: Press | undefined, liftAt = 0, nextTap = 0, wake = 0
  const consume = (event: PointerEvent) => { event.preventDefault(); event.stopImmediatePropagation() }

  function deposit(p: Press, hits: number, spread = 1) {
    water.stroke(p.x, p.y, p.x, p.y, p.radius * spread, p.force, 0, hits, false)
  }

  function sample(p: Press, now: number, first = false) {
    const rect = host.getBoundingClientRect(), s = settings()
    const x = p.virtual ? p.screenX : (p.screenX - rect.left) / rect.width * 2 - 1
    const y = p.virtual ? p.screenY : 1 - (p.screenY - rect.top) / rect.height * 2
    const dt = Math.max(0, Math.min(.1, (now - p.last) / 1000))
    p.last = Math.max(now, p.last)
    if (!rect.width || !rect.height || camera.position.z <= 0 || Math.abs(x) > 1 || Math.abs(y) > 1 || !s.glass) {
      p.anchored = false; return false
    }
    ray.setFromCamera(ndc.set(x, y), camera)
    if (!ray.ray.intersectPlane(plane, point)) { p.anchored = false; return false }
    const pixel = 2 * camera.position.distanceTo(point) * Math.tan(camera.fov * Math.PI / 360) / rect.height
    p.radius = pixel * s.rainBrushRadius
    const age = Math.min(1, Math.max(0, (now - p.start) / (1000 * s.rainBrushRamp)))
    const gain = 1 + (s.rainBrushGain - 1) * age * age * (3 - 2 * age)
    p.flow = Math.min(1,(150+80*p.force)*gain/(230*Math.max(1,s.rainBrushGain)))
    if (p.moved && p.anchored) {
      const demand = p.carry + Math.hypot(point.x - p.x, point.y - p.y) * 44 * Math.sqrt(gain) / Math.max(.003, p.radius)
      const hits = Math.floor(demand)
      p.carry = demand - hits
      water.stroke(p.x, p.y, point.x, point.y, p.radius, p.force, dt, hits, !p.virtual)
    }
    p.x = point.x; p.y = point.y; p.anchored = true; p.moved = false
    if (first) {
      const head = Math.floor(between(6, 13))
      deposit(p, head)
      p.pending = Math.round(70 + p.force * 36) - head
      p.next = now + between(25, 58)
    } else {
      const rate = (150 + 80 * p.force) * gain
      p.pending = Math.min(110 + rate * .35, p.pending + dt * rate)
    }
    return true
  }

  function press(x: number, y: number, force: number, now: number, virtual = false) {
    const p = pool.find(slot => !slot.down && slot.pending < 1) ?? pool.find(slot => !slot.down)
    if (!p) return
    Object.assign(p, { screenX: x, screenY: y, force, virtual, start: now, last: now,
      carry: 0, pending: 0, next: now, tailEnd: 0, anchored: false, moved: false })
    if (!sample(p, now, true)) return
    p.down = true
    return p
  }

  function paint(c: Contact, now: number) {
    if (!c.patter) { c.patter = press(c.x, c.y, c.force, now); return }
    const p = c.patter
    p.moved ||= p.screenX !== c.x || p.screenY !== c.y
    p.screenX = c.x; p.screenY = c.y; p.force = c.force
    sample(p, now)
  }
  function lift(p: Press, now: number, tail: boolean) {
    p.down = false
    const duration = tail ? settings().rainBrushTail : 0
    p.pending = duration ? Math.max(p.pending, between(9, 18)) : 0
    p.tailAt = now; p.tailEnd = now + duration * 1000
    p.next = Math.min(p.next, p.tailEnd)
  }
  function stopPainting(c: Contact, tail: boolean) {
    if (!c.patter) return
    lift(c.patter, performance.now(), tail)
    c.patter = undefined
  }
  function paired(c: Contact) { return pair && (c === pair.a || c === pair.b) }
  function pairTouches() {
    if (pair) return
    let a: Contact | undefined
    for (const b of fingers.values()) {
      if (!b.touch) continue
      if (!a) { a = b; continue }
      pair = { a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y), orbiting: false }
      return
    }
  }
  function navigate(g: Pair) {
    const x = (g.a.x + g.b.x) / 2, y = (g.a.y + g.b.y) / 2
    const span = Math.hypot(g.a.x - g.b.x, g.a.y - g.b.y)
    const dx = x - g.x, dy = y - g.y
    if (!g.orbiting) {
      if (Math.hypot(dx, dy) < 7 && Math.abs(span - g.span) < 10) return
      g.orbiting = true; stopPainting(g.a, false); stopPainting(g.b, false)
    }
    orbit(dx, dy, g.span > 2 && span > 2 ? g.span / span : 1)
    g.x = x; g.y = y; g.span = span
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || fingers.has(event.pointerId)) return
    const touch = event.pointerType === 'touch', mouse = event.pointerType === 'mouse', now = performance.now()
    const c: Contact = { touch, x: event.clientX, y: event.clientY,
      force: mouse ? .65 : Math.max(.25, event.pressure), due: now + (touch ? 95 : 0) }
    consume(event)
    if (!fingers.size) begin()
    fingers.set(event.pointerId, c); if (touch) pairTouches()
    host.setPointerCapture(event.pointerId); host.focus({ preventScroll: true })
    if (!touch) paint(c, now)
    invalidate()
  }
  const move = (event: PointerEvent) => {
    const c = fingers.get(event.pointerId); if (!c) return
    consume(event)
    if (c.touch && !pair && !c.patter && Number.isFinite(c.due) && Math.hypot(event.clientX - c.x, event.clientY - c.y) > 3) {
      c.due = performance.now(); paint(c, c.due)
    }
    c.x = event.clientX; c.y = event.clientY
    if (event.pointerType !== 'mouse') c.force = Math.max(.25, event.pressure)
    if (pair && paired(c)) navigate(pair)
    invalidate()
  }
  function release(id: number) {
    fingers.delete(id)
    if (host.hasPointerCapture(id)) host.releasePointerCapture(id)
  }
  const end = (event: PointerEvent) => {
    const c = fingers.get(event.pointerId); if (!c) return
    consume(event)
    const navigation = paired(c) && pair?.orbiting
    const tap = event.type === 'pointerup' && !navigation && Number.isFinite(c.due)
    if (tap) { c.x = event.clientX; c.y = event.clientY; paint(c, performance.now()) }
    stopPainting(c, tap)
    if (pair && paired(c)) {
      // Lifting the first finger of a swipe must not turn the second into a tap.
      if (navigation) (c === pair.a ? pair.b : pair.a).due = Infinity
      pair = undefined
    }
    release(event.pointerId); pairTouches(); invalidate()
  }
  function endDebug() {
    if (steady) lift(steady, performance.now(), false)
    if (wandering) lift(wandering, performance.now(), false)
    steady = wandering = undefined; nextTap = 0
  }
  function debugPresses(now: number) {
    if (steady) sample(steady, now)
    else steady = press(0, .68, 1, now, true)
    if (wandering) {
      sample(wandering, Math.min(liftAt, now))
      if (now >= liftAt) { lift(wandering, liftAt, true); wandering = undefined }
    }
    if (!wandering && now >= nextTap) {
      const angle = between(0, Math.PI * 2), reach = .52 * Math.sqrt(Math.random())
      const side = Math.min(host.clientWidth, host.clientHeight)
      wandering = press(Math.cos(angle) * reach * side / Math.max(1, host.clientWidth),
        Math.sin(angle) * reach * side / Math.max(1, host.clientHeight), between(.45, .95), now, true)
      liftAt = now + (Math.random() < .6 ? between(45, 140) : between(200, 620))
      nextTap = liftAt + between(155, 530)
    }
  }
  function suspend() {
    window.clearTimeout(wake); wake = 0; endDebug(); pair = undefined
    for (const [id, c] of fingers) { stopPainting(c, false); release(id) }
    for (const p of pool) p.pending = 0
    onFlow?.(0)
  }
  const context = (event: Event) => event.preventDefault()
  // Browsers deliver horizontal trackpad swipes as wheel events. Keep the
  // whole diagonal gesture together while ordinary vertical scroll zooms.
  let trackpadUntil = 0
  const trackpad = (event: WheelEvent) => {
    if (event.ctrlKey || event.deltaMode !== 0) return
    const now = performance.now()
    if (now >= trackpadUntil && Math.abs(event.deltaX) < Math.max(1, Math.abs(event.deltaY) * .45)) return
    event.preventDefault(); event.stopImmediatePropagation(); trackpadUntil = now + 140
    orbit(-event.deltaX, -event.deltaY, 1)
  }
  host.addEventListener('wheel', trackpad, { capture: true, passive: false })
  host.addEventListener('contextmenu', context)

  host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true)
  host.addEventListener('pointerup', end, true); host.addEventListener('pointercancel', end, true)
  host.addEventListener('lostpointercapture', end, true); window.addEventListener('blur', suspend)
  return {
    update(now: number, debug: boolean) {
      if (wake) { window.clearTimeout(wake); wake = 0 }
      const s = settings()
      for (const c of fingers.values()) {
        if (s.glass && now >= c.due && !(paired(c) && pair?.orbiting)) paint(c, now)
      }
      if (debug && s.glass) debugPresses(now)
      else if (steady || wandering || nextTap) endDebug()
      let next = fingers.size || debug ? now + 50 : Infinity
      for (const p of pool) {
        if (p.pending < 1 || !s.glass || !water.ready) continue
        // One uneven packet per live contact per frame. Lifting a finger
        // leaves its remaining drops anchored to that spot until they run out.
        if (now >= p.next) {
          const remaining = Math.max(0, p.tailEnd - now) / Math.max(1, p.tailEnd - p.tailAt)
          const fraction = p.down ? between(.17, .36) : 1 - Math.min(1, remaining) ** 1.75
          const hits = Math.min(Math.floor(p.pending), Math.ceil(p.pending * fraction))
          deposit(p, hits, between(.72, 1.2)); p.pending -= hits
          p.tailAt = now
          p.next = Math.min(now + between(22, 66), p.down ? Infinity : p.tailEnd)
        }
        if (p.pending >= 1) next = Math.min(next, p.next)
      }
      let flow = 0
      if (s.glass) for (const p of pool) {
        if (p.virtual || !p.anchored) continue
        const fade = p.down ? 1 : p.pending >= 1 ? Math.max(0, Math.min(1,(p.tailEnd-now)/Math.max(1,s.rainBrushTail*1000))) : 0
        flow = Math.max(flow,p.flow*fade)
      }
      onFlow?.(flow)
      if (!s.playing && Number.isFinite(next)) wake = window.setTimeout(invalidate, Math.max(1, next - now))
    },
    suspend,
    dispose() {
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true)
      host.removeEventListener('pointerup', end, true); host.removeEventListener('pointercancel', end, true)
      host.removeEventListener('lostpointercapture', end, true); window.removeEventListener('blur', suspend)
      host.removeEventListener('contextmenu', context)
      host.removeEventListener('wheel', trackpad, true)
      suspend()
    },
  }
}
