// Simple pooled beads, trails and contact rims; also used by the storm fallback.
import { AdditiveBlending, Color, DynamicDrawUsage, HalfFloatType, InstancedBufferAttribute, InstancedBufferGeometry,
  LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3, Vector4, WebGLRenderTarget } from 'three'
import type { WebGLRenderer } from 'three'
import { random } from '../settings'
import { dropVolume, rainDiameter, water } from './settings'
import type { RainSettings } from './settings'
import type { RainTerrain } from './terrain'
import { rainBurst, rainNoise, rainVelocity } from './weather'
import { impactMotionGLSL, impactShapeGLSL } from './impact'

export const rainDomain = { width: 4.8, height: 4.8, centerY: 1.8 }
export const surfaceBudget = { drops: 2200, trails: 5000, contacts: 3072, resolution: 1536 }
const capVolume = Math.PI * .6 / 2, cellSize = .06
const columns = Math.ceil(rainDomain.width / cellSize), rows = Math.ceil(rainDomain.height / cellSize)
const left = -rainDomain.width / 2, bottom = rainDomain.centerY - rainDomain.height / 2
export const beadRadius = (volume: number) => Math.cbrt(Math.max(0, volume) / capVolume)
export interface SurfaceDrop {
  x: number; y: number; volume: number; vx: number; vy: number; seed: number; age: number
  lastX: number; lastY: number; impactAge: number; impact: number; alive: boolean; steer: number
  pinned: boolean; pinVolume: number; trackWetness: number; lifetime: number
}
interface Trail { x: number; y: number; endX: number; endY: number; radius: number; volume: number; age: number; owner: number }
interface PaneContact { x: number; y: number; radius: number; age: number; energy: number; stretch: number; angle: number; vx: number; vy: number }
export interface PaneImpact { sprayVolume: number; energy: number; pieces: number; beadVolume?: number }
const segmentFraction = (x: number, y: number, ax: number, ay: number, bx: number, by: number) =>
  Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / Math.max(1e-12, (bx - ax) ** 2 + (by - ay) ** 2)))

// One bounded bead system: impacts spread/recoil, gravity releases loaded caps,
// running heads sweep up other beads and wet tracks, then leave narrow necks.
export class SurfaceWater {
  constructor(private terrain?: RainTerrain, private retire?: (x: number, y: number, volume: number) => void) {}
  drops: SurfaceDrop[] = []
  trails: Trail[] = []
  contacts: PaneContact[] = []
  readonly impactOptions = new Vector3(.12,1.4,.14)
  time = 0
  wetness = 0
  deposited = 0
  drained = 0
  evaporated = 0
  ejected = 0
  unresolved = 0
  impacts = 0
  merges = 0
  private rng = random(713955)
  // Allocate transient water objects once. The active arrays only hold
  // references; merged/drained beads return to the free list for the next hit.
  private freeDrops: SurfaceDrop[] = Array.from({ length: surfaceBudget.drops }, () => ({
    x: 0, y: 0, volume: 0, vx: 0, vy: 0, seed: 0, age: 0, lastX: 0, lastY: 0,
    impactAge: 0, impact: 0, alive: false, steer: 0, pinned: true, pinVolume: 0, trackWetness: 0, lifetime: 24,
  }))
  private trailPool: Trail[] = Array.from({ length: surfaceBudget.trails }, () => ({
    x: 0, y: 0, endX: 0, endY: 0, radius: 0, volume: 0, age: 0, owner: 0,
  }))
  private contactPool: PaneContact[] = Array.from({ length: surfaceBudget.contacts }, () => ({
    x: 0, y: 0, radius: 0, age: 0, energy: 0, stretch: 1, angle: 0, vx: 0, vy: 0,
  }))
  private impactResult: PaneImpact = { sprayVolume: 0, energy: 0, pieces: 0 }
  private emit = 0
  private trailCursor = 0
  private contactCursor = 0
  private heads = new Int32Array(columns * rows)
  private next = new Int32Array(surfaceBudget.drops)
  private impactIndexDirty = true
  private largestCap = 0
  private victimCursor = 0
  private nearby: SurfaceDrop[] = []
  private trailHeads = new Int32Array(columns * rows)
  private trailNext = new Int32Array(surfaceBudget.trails)
  private lastSettings?: RainSettings
  private at = new Vector3()
  private velocity = new Vector3()
  private key(x: number, y: number) {
    return Math.max(0, Math.min(rows - 1, Math.floor((y - bottom) / cellSize))) * columns
      + Math.max(0, Math.min(columns - 1, Math.floor((x - left) / cellSize)))
  }

  invalidateImpactIndex() { this.impactIndexDirty = true }
  private indexImpactBead(i: number) {
    const drop = this.drops[i], key = this.key(drop.x, drop.y)
    this.next[i] = this.heads[key]; this.heads[key] = i
    this.largestCap = Math.max(this.largestCap, beadRadius(drop.volume))
  }
  private nearImpact(x: number, y: number, reach: number) {
    // Between physics steps, reuse the same cell lists for the entire batch of
    // incoming drops. Dense rain must not scan the whole pane for every hit.
    if (this.impactIndexDirty) {
      this.heads.fill(-1); this.largestCap = 0
      for (let i = 0; i < this.drops.length; i++) this.indexImpactBead(i)
      this.impactIndexDirty = false
    }
    reach += this.largestCap
    const lo = this.key(x - reach, y - reach), hi = this.key(x + reach, y + reach)
    this.nearby.length = 0
    for (let row = Math.floor(lo / columns); row <= Math.floor(hi / columns); row++) {
      for (let column = lo % columns; column <= hi % columns; column++) {
        for (let i = this.heads[row * columns + column]; i >= 0; i = this.next[i]) this.nearby.push(this.drops[i])
      }
    }
    return this.nearby
  }

  private resetDrop(drop: SurfaceDrop, x: number, y: number, volume: number, vx: number, vy: number, impact: number) {
    drop.x = drop.lastX = x; drop.y = drop.lastY = y
    drop.volume = volume; drop.vx = vx; drop.vy = vy; drop.impact = impact
    drop.seed = this.rng() * 1000; drop.alive = true; drop.pinned = Math.hypot(vx, vy) < .0025
    drop.age = drop.impactAge = drop.steer = drop.pinVolume = drop.trackWetness = 0
    drop.lifetime = (this.lastSettings?.rainBeadLifetime ?? 24) * (.2 + .8 * this.rng())
    return drop
  }

  clear() {
    this.invalidateImpactIndex()
    for (const drop of this.drops) { drop.alive = false; this.freeDrops.push(drop) }
    this.drops.length = this.trails.length = this.contacts.length = 0
    this.trailCursor = this.contactCursor = 0
    this.emit = 0
  }

  add(x: number, y: number, volume: number, vx = 0, vy = 0, impact = 0) {
    this.deposited += volume
    if (this.drops.length >= surfaceBudget.drops) {
      // Only a real contact can feed an existing bead. At capacity, retire a
      // small quiet bead into the unresolved volume budget instead of feeding
      // a distant runner with an inexhaustible supply of unrelated rainfall.
      const radius = beadRadius(volume)
      let nearest: SurfaceDrop | undefined, distance = Infinity
      for (const drop of this.nearImpact(x, y, radius)) {
        const d = (drop.x - x) ** 2 + (drop.y - y) ** 2
        if (d < distance && d < (beadRadius(drop.volume) + radius) ** 2) { nearest = drop; distance = d }
      }
      if (nearest) {
        const fraction = volume / (nearest.volume + volume)
        nearest.vx += (vx - nearest.vx) * fraction; nearest.vy += (vy - nearest.vy) * fraction
        nearest.volume += volume; nearest.impactAge = 0; nearest.impact = Math.max(impact, .3)
        this.largestCap = Math.max(this.largestCap, beadRadius(nearest.volume))
        if (Math.hypot(nearest.vx, nearest.vy) > .0025) nearest.pinned = false
        return nearest
      }
      let victim = 0, lowest = Infinity
      for (let n = 0; n < 16; n++) {
        this.victimCursor = (this.victimCursor + 151) % this.drops.length
        const drop = this.drops[this.victimCursor]
        const score = drop.volume * (drop.pinned ? 1 : 1 + Math.min(25, (drop.vx ** 2 + drop.vy ** 2) * 20000)) * (drop.impactAge < .2 ? 20 : 1)
        if (score < lowest) { lowest = score; victim = this.victimCursor }
      }
      const replace = this.drops[victim], cell = this.key(replace.x, replace.y)
      if (this.heads[cell] === victim) this.heads[cell] = this.next[victim]
      else {
        for (let i = this.heads[cell]; i >= 0; i = this.next[i]) {
          if (this.next[i] === victim) { this.next[i] = this.next[victim]; break }
        }
      }
      this.unresolved += replace.volume
      this.retire?.(replace.x, replace.y, replace.volume)
      this.resetDrop(replace, x, y, volume, vx, vy, impact)
      this.indexImpactBead(victim)
      return replace
    }
    const drop = this.resetDrop(this.freeDrops.pop()!, x, y, volume, vx, vy, impact)
    this.drops.push(drop)
    if (!this.impactIndexDirty) this.indexImpactBead(this.drops.length - 1)
    return drop
  }

  private contact(x: number, y: number, radius: number, energy: number, speed: number, tangentX: number, tangentY: number, tangentSpeed: number) {
    const contact = this.contacts.length < surfaceBudget.contacts
      ? this.contactPool[this.contacts.length] : this.contacts[this.contactCursor]
    contact.x = x; contact.y = y; contact.radius = radius; contact.age = 0; contact.energy = energy
    contact.stretch = 1 + Math.min(1.5, tangentSpeed / Math.max(.1, speed) * .08)
    contact.angle = Math.atan2(tangentY, tangentX) - Math.PI / 2
    const inheritance = this.rng()
    contact.vx = tangentX * inheritance; contact.vy = tangentY * inheritance
    if (this.contacts.length < surfaceBudget.contacts) this.contacts.push(contact)
    else this.contactCursor = (this.contactCursor + 1) % surfaceBudget.contacts
  }
  // Fine patter shares the optical contact rim. Only resolved beads need a
  // neighborhood search and runoff dynamics.
  ripple(x: number, y: number, diameter: number, speed: number, vx: number, vy: number) {
    const energy = 1 - Math.exp(-Math.sqrt(water.density * diameter / water.tension) * speed * .11)
    this.contact(x, y, beadRadius(dropVolume(diameter)), energy, speed, vx, vy, Math.hypot(vx, vy))
  }

  // The returned scratch result is consumed immediately by the shower and is
  // valid until the next strike; impacts do not allocate an event object.
  strike(x: number, y: number, diameter: number, speed: number, tangentX = 0, tangentY = -speed, allowSpray = true): PaneImpact {
    const volume = dropVolume(diameter), radius = beadRadius(volume)
    const weber = water.density * diameter * speed * speed / water.tension
    const energy = 1 - Math.exp(-Math.sqrt(weber) * .11)
    const tangentSpeed = Math.hypot(tangentX, tangentY)
    const patch = rainNoise(x * 83, y * 79, 29.3)
    let wet = this.wetness * .35
    // Existing water changes the outcome. An impact onto a loaded bead can
    // release a group of neighbors; the cascade then continues by collection.
    const neighbors = this.nearImpact(x, y, radius * 5)
    if (diameter > .0015) for (const drop of neighbors) {
      if (drop.alive && Math.hypot(drop.x - x, drop.y - y) < radius * 2 + beadRadius(drop.volume)) { wet = 1; break }
    }
    const sprayChance = allowSpray ? Math.max(0, energy - .18) * (.42 + wet * .35) * (.65 + patch * .7) : 0
    const explosive = this.rng() < sprayChance
    const cascade = !explosive && energy > .18 && tangentSpeed > .4 && (wet > .55 || this.rng() < .2 + energy * .35)
    const sprayFraction = !allowSpray ? 0 : explosive ? (this.rng() < .25 ? 1 : .82 + .16 * energy * this.rng()) : cascade ? .12 * energy : 0
    const sprayVolume = volume * sprayFraction, retained = volume - sprayVolume
    this.ejected += sprayVolume
    this.impacts++
    this.contact(x, y, radius, energy, speed, tangentX, tangentY, tangentSpeed)
    const transfer = .38 + .34 * tangentSpeed / Math.max(.001, tangentSpeed + speed)
    if (cascade) {
      const reach = radius * (2.5 + energy * 2)
      for (const drop of neighbors) {
        const dx = drop.x - x, dy = drop.y - y, distance = Math.hypot(dx, dy)
        if (!drop.alive || distance > reach) continue
        const coupling = Math.min(.6, volume / (drop.volume + volume)) * (1 - distance / reach) * energy
        drop.vx += tangentX * coupling * .25 + dx / Math.max(.001, reach) * coupling * .2
        drop.vy += Math.min(-.12, tangentY * .25) * coupling
        drop.pinned = false; drop.pinVolume = 0; drop.trackWetness = 1
        drop.impactAge = 0; drop.impact = Math.max(drop.impact, energy * .5)
      }
      this.add(x, y, retained * .55, tangentX * transfer, tangentY * transfer, energy)
      const pieces = 2 + Math.floor(energy * 4)
      for (let i = 0; i < pieces; i++) {
        const angle = -.85 + 1.7 * i / Math.max(1, pieces - 1) + (this.rng() - .5) * .2
        const reach = radius * (1.6 + this.rng() * 1.3)
        this.add(x + Math.sin(angle) * reach, y - Math.cos(angle) * reach, retained * .45 / pieces,
          tangentX * transfer * .5 + Math.sin(angle) * energy * .3, tangentY * transfer * (.4 + this.rng() * .6), energy * .6)
      }
    } else if (retained > 1e-13) {
      const carry = transfer * (explosive ? .12 : .12 + energy * .12)
      this.add(x, y, retained, tangentX * carry, tangentY * carry, .3 + energy * .7)
    }
    this.impactResult.sprayVolume = sprayVolume; this.impactResult.energy = energy
    this.impactResult.pieces = sprayVolume > 0 ? Math.min(40, Math.round(5 + energy * 24 + diameter * 220)) : 0
    return this.impactResult
  }

  step(dt: number, s: RainSettings, strength: number, emitRain = true) {
    const settingsChanged = s !== this.lastSettings
    this.lastSettings = s
    this.time += dt
    for (const contact of this.contacts) contact.age += dt
    const deposition = strength * s.rainGlass
    this.wetness += (Math.min(1, deposition * 1.3) - this.wetness) * (1 - Math.exp(-dt / (deposition > this.wetness ? 3 : 24)))
    // Standalone callers can supply rain here. The live shower schedules its
    // own weather for both airborne collisions and direct pane contacts.
    this.emit += (emitRain && deposition > 0 ? (10 + 550 * strength ** 1.9) * s.rainGlass * rainBurst(this.time + 12) : 0) * dt
    while (this.emit >= 1) {
      this.emit--
      const diameter = rainDiameter(this.rng(), strength, s.rainDropSize)
      const x = left + this.rng() * rainDomain.width, y = bottom + this.rng() * rainDomain.height
      rainVelocity(this.velocity, this.at.set(x, y, 0), this.time + 12, s, strength, diameter)
      this.strike(x, y, diameter, Math.abs(this.velocity.z) * 1.5, this.velocity.x, this.velocity.y)
    }
    this.heads.fill(-1); this.trailHeads.fill(-1)
    let largestRadius = 0
    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i], key = this.key(drop.x, drop.y)
      this.next[i] = this.heads[key]; this.heads[key] = i
      largestRadius = Math.max(largestRadius, beadRadius(drop.volume))
    }
    const retained = Math.exp(-dt / 9)
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i]
      trail.age += dt; this.evaporated += trail.volume * (1 - retained); trail.volume *= retained
      const key = this.key((trail.x + trail.endX) * .5, (trail.y + trail.endY) * .5)
      this.trailNext[i] = this.trailHeads[key]; this.trailHeads[key] = i
    }
    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i]
      if (!drop.alive) continue
      let radius = beadRadius(drop.volume)
      const oldX = drop.x, oldY = drop.y, mass = drop.volume * water.density
      drop.age += dt; drop.impactAge += dt
      if (this.retire && drop.age >= drop.lifetime) {
        this.retire(drop.x,drop.y,drop.volume)
        this.unresolved += drop.volume; drop.alive = false
        continue
      }
      const profile = drop.seed * .61803398875 % 1
      let hysteresis = 1
      // Resting caps need another contact evaluation only after adding mass or
      // changing controls. Drying alone cannot release an already pinned cap.
      if (!drop.pinned || drop.volume > drop.pinVolume || settingsChanged) {
        const terrain = this.terrain?.sample(drop.x, drop.y, radius)
        // Contact-angle history and spatially fixed rough/contaminated patches
        // change resistance; neither friction nor speed is randomized per frame.
        const patch = .65 + 1.4 * rainNoise(drop.x * 32, drop.y * 41, 11.9) ** 2
        hysteresis = (.55 + profile * .5) * patch * (terrain?.pinning ?? 1)
        const pinning = 2 * radius * water.tension * hysteresis * s.rainFriction * (1 - drop.trackWetness * .22)
        const sx = terrain?.x ?? 0, sy = terrain?.y ?? 0
        const capillary = -2 * radius * water.tension * sx / Math.max(1e-10, mass)
        const slopeGravity = water.gravity * sx * sy / (1 + sx * sx + sy * sy)
        const ax = Math.max(-2.8, Math.min(2.8, capillary + slopeGravity)) * s.rainWander + s.rainWind * .06 + drop.steer / .1
        const ay = -water.gravity * (1 + sx * sx) / (1 + sx * sx + sy * sy)
        const staticAcceleration = pinning / Math.max(1e-10, mass), drive = Math.hypot(ax, ay)
        if (dt > 0) {
          if (drop.pinned && drive <= staticAcceleration) { drop.vx = drop.vy = 0 }
          else {
            // Coulomb contact friction can consume ALL momentum. Viscous/contact
            // drag then limits a moving cap; there is no prescribed descent speed.
            drop.vx += ax * dt; drop.vy += ay * dt
            const speed = Math.hypot(drop.vx, drop.vy)
            // Inertial-capillary time ties impact glide to the actual cap size.
            // Contact drag builds over this brief arrival, instead of dropping
            // an 8 m/s raindrop straight into the slow runoff regime in one tick.
            const capillaryTime = Math.sqrt(water.density * radius ** 3 / water.tension)
            const arrival = drop.impact > 0 ? Math.exp(-drop.impactAge / (.016 + capillaryTime * 2.5)) : 0
            const friction = Math.max(0, 1 - staticAcceleration * .84 * (1 - arrival * .65) * dt / Math.max(1e-9, speed))
            const mobility = Math.exp((profile - .5) * 2.5)
            const runoffRelaxation = Math.max(.002, (.018 + .025 * (radius / .004) ** 1.4) * s.rainFlow * mobility * (1 + drop.trackWetness * .7))
            const relaxation = runoffRelaxation + Math.max(0, .028 + capillaryTime * 3.5 - runoffRelaxation) * arrival
            const damping = friction * Math.exp(-dt / relaxation)
            drop.vx *= damping; drop.vy *= damping
            drop.pinned = Math.hypot(drop.vx, drop.vy) < .0025 && drive <= staticAcceleration
            if (drop.pinned) drop.vx = drop.vy = 0
            const bounded = Math.min(1, (2.5 + arrival * 7.5) / Math.max(.001, Math.hypot(drop.vx, drop.vy)))
            drop.vx *= bounded; drop.vy *= bounded
          }
        }
        drop.pinVolume = drop.pinned ? drop.volume : 0
      }
      const sliding = !drop.pinned
      drop.steer *= Math.exp(-dt / .14)
      drop.trackWetness *= Math.exp(-dt / .18)
      drop.x += drop.vx * dt; drop.y += drop.vy * dt
      // Swept tests prevent a fast head stepping over small stationary beads.
      const reach = Math.max(.035, radius + largestRadius)
      const x0 = Math.max(0, Math.floor((Math.min(oldX, drop.x) - reach - left) / cellSize))
      const x1 = Math.min(columns - 1, Math.floor((Math.max(oldX, drop.x) + reach - left) / cellSize))
      const y0 = Math.max(0, Math.floor((Math.min(oldY, drop.y) - reach - bottom) / cellSize))
      const y1 = Math.min(rows - 1, Math.floor((Math.max(oldY, drop.y) + reach - bottom) / cellSize))
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const key = cy * columns + cx
        for (let j = this.heads[key]; j !== -1; j = this.next[j]) {
          const other = this.drops[j]
          if (j === i || !other.alive) continue
          const t = segmentFraction(other.x, other.y, oldX, oldY, drop.x, drop.y)
          const distance = Math.hypot(other.x - oldX - (drop.x - oldX) * t, other.y - oldY - (drop.y - oldY) * t)
          if (distance > (radius + beadRadius(other.volume)) * .95) continue
          const fraction = other.volume / (drop.volume + other.volume)
          // The growing contact footprint shifts sideways toward the absorbed
          // cap. A short capillary pull subsequently changes the running path.
          const toward = other.x - drop.x
          drop.x += toward * fraction * (sliding ? .85 : 1)
          if (!sliding) drop.y += (other.y - drop.y) * fraction
          drop.steer += Math.max(-.28, Math.min(.28, toward * fraction * 35)) * s.rainWander
          drop.vx += (other.vx - drop.vx) * fraction; drop.vy += (other.vy - drop.vy) * fraction
          drop.volume += other.volume; other.alive = false; this.merges++
          drop.pinVolume = 0
          if (Math.hypot(drop.vx, drop.vy) > .0025) drop.pinned = false
          drop.impactAge = 0; drop.impact = Math.max(.3, other.impact)
          radius = beadRadius(drop.volume)
        }
        if (sliding) for (let j = this.trailHeads[key]; j !== -1; j = this.trailNext[j]) {
          const trail = this.trails[j]
          if (trail.owner === drop.seed || trail.age < .08 || trail.volume < 1e-13) continue
          const t = segmentFraction(drop.x, drop.y, trail.x, trail.y, trail.endX, trail.endY)
          const tx = trail.x + (trail.endX - trail.x) * t, ty = trail.y + (trail.endY - trail.y) * t
          if (Math.hypot(tx - drop.x, ty - drop.y) > radius + trail.radius) continue
          const taken = trail.volume * (1 - Math.exp(-dt * 45))
          drop.volume += taken; trail.volume -= taken
          drop.trackWetness = 1
          const slope = (trail.endX - trail.x) / Math.max(.005, Math.abs(trail.endY - trail.y))
          drop.vx += ((tx - drop.x) * 45 + slope * Math.abs(drop.vy) - drop.vx) * (1 - Math.exp(-dt * 10)) * s.rainWander
        }
      }
      const distance = Math.hypot(drop.x - oldX, drop.y - oldY)
      const evaporation = Math.min(drop.volume, Math.PI * radius * radius * 1.5e-7 * dt)
      drop.volume -= evaporation; this.evaporated += evaporation
      const travel = Math.hypot(drop.x - drop.lastX, drop.y - drop.lastY)
      if (travel > Math.max(.009, radius * 1.4) && distance > 0) {
        // A pinned rear contact line leaves water behind. Without fresh water,
        // the head shrinks until the local contact force can hold it again.
        const loss = (3 + profile * 6 + Math.min(2, hysteresis) * 3) * (1 - drop.trackWetness * .65)
        const volume = drop.volume * (1 - Math.exp(-travel * loss))
        const trail = this.trails.length < surfaceBudget.trails ? this.trailPool[this.trails.length] : this.trails[this.trailCursor]
        if (this.trails.length < surfaceBudget.trails) this.trails.push(trail)
        else {
          this.evaporated += trail.volume
          this.trailCursor = (this.trailCursor + 1) % surfaceBudget.trails
        }
        trail.x = drop.lastX; trail.y = drop.lastY; trail.endX = drop.x; trail.endY = drop.y
        trail.radius = Math.max(.0007, radius * .3); trail.volume = volume; trail.age = 0; trail.owner = drop.seed
        drop.volume -= volume; drop.lastX = drop.x; drop.lastY = drop.y
      }
      if (drop.y < bottom - radius || drop.x < left - radius || drop.x > left + rainDomain.width + radius || drop.volume < 1e-12) {
        this.drained += drop.volume; drop.alive = false
      }
    }
    let alive = 0
    for (const drop of this.drops) {
      if (drop.alive) this.drops[alive++] = drop
      else this.freeDrops.push(drop)
    }
    this.drops.length = alive
    this.invalidateImpactIndex()
  }
}

export const waterVertexGLSL = /* glsl */`
attribute vec4 waterDrop;
attribute vec4 waterShape;
attribute vec4 waterImpact;
${impactMotionGLSL}
varying vec2 vWaterPoint;
varying vec2 vWaterRadii;
varying vec4 vWaterShape;
varying vec2 vWaterRotation;
varying vec4 vWaterImpact;
void main() {
  vWaterPoint=position.xy*2.;vWaterShape=waterShape;vWaterRadii=waterDrop.zw;vWaterImpact=vec4(0.);
  float angle=waterShape.w;vec2 center=waterDrop.xy;
  if(waterShape.z>2.5){
    vec2 travel=impactTravel(waterImpact.xy,waterImpact.w,waterImpact.z);
    vWaterImpact=impactDimensions(waterImpact.w,waterImpact.z,waterImpact.xy);
    if(vWaterImpact.w>=1.){gl_Position=vec4(2.,2.,2.,1.);return;}
    angle=atan(travel.y,travel.x+.000001)-1.5707963;center+=travel*.5;
    float width=max(vWaterImpact.x,vWaterImpact.z);
    vWaterRadii=vec2(width,width+vWaterImpact.y*.5);
  }
  vWaterRotation=vec2(cos(angle),sin(angle));
  vec2 p=vWaterPoint*vWaterRadii;
  vec2 point=center+vec2(vWaterRotation.x*p.x-vWaterRotation.y*p.y,vWaterRotation.y*p.x+vWaterRotation.x*p.y);
  gl_Position = vec4(point.x / ${rainDomain.width} * 2., (point.y - ${rainDomain.centerY}) / ${rainDomain.height} * 2., 0., 1.);
}
`
export const waterFragmentGLSL = /* glsl */`
${impactShapeGLSL}
varying vec2 vWaterPoint;
varying vec2 vWaterRadii;
varying vec4 vWaterShape;
varying vec2 vWaterRotation;
varying vec4 vWaterImpact;
void main() {
  if(vWaterShape.z>2.5){
    vec4 field=impactWater(vWaterPoint*vWaterRadii,vWaterImpact);
    field.xy=vec2(vWaterRotation.x*field.x-vWaterRotation.y*field.y,vWaterRotation.y*field.x+vWaterRotation.x*field.y);
    gl_FragColor=field;return;
  }

  vec2 p = vWaterPoint;
  float dy = 1. / max(.0001, vWaterRadii.y);
  if (vWaterShape.z > .5 && vWaterShape.z < 1.5) {
    // Capsule-shaped neck, with continuous sides and rounded ends.
    p.y = max(0., abs(p.y) * vWaterRadii.y - (vWaterRadii.y - vWaterRadii.x)) / vWaterRadii.x;
    dy = p.y > 0. ? sign(vWaterPoint.y) / vWaterRadii.x : 0.;
  }
  float r2 = dot(p, p), aa = max(.012, fwidth(r2));
  float coverage = 1. - smoothstep(1. - aa, 1. + aa, r2);
  if (coverage < .001) discard;
  float shape = max(0., 1. - r2);
  vec2 gradient = -2. * vWaterShape.x * p * vec2(1. / max(vWaterRadii.x, .0001), dy);
  if (vWaterShape.z > 1.5) {
    // A brief raised rim while an incoming drop flattens and recoils.
    float r = sqrt(max(.00001, r2)), ridge = (r - .67) * 9.;
    shape = exp(-ridge * ridge);
    gradient = -18. * ridge * shape * vWaterShape.x * p / (r * max(vWaterRadii, vec2(.0001)));
  }
  gradient = vec2(vWaterRotation.x * gradient.x - vWaterRotation.y * gradient.y,
    vWaterRotation.y * gradient.x + vWaterRotation.x * gradient.y);
  gl_FragColor = vec4(gradient * coverage, vWaterShape.x * shape * 1000., coverage * vWaterShape.y);
}
`

export function createSurfaceWater(terrain?: RainTerrain, retire?: (x: number, y: number, volume: number) => void) {
  const simulation = new SurfaceWater(terrain, retire), scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geometry = new InstancedBufferGeometry(), quad = new PlaneGeometry(1, 1)
  geometry.index = quad.index; geometry.attributes = quad.attributes
  const capacity = surfaceBudget.drops * 2 + surfaceBudget.trails + surfaceBudget.contacts
  const drops = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage)
  const shapes = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage)
  const impacts=new InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(DynamicDrawUsage)
  geometry.setAttribute('waterDrop', drops); geometry.setAttribute('waterShape', shapes); geometry.setAttribute('waterImpact', impacts)
  const material = new ShaderMaterial({ uniforms:{uPaneImpact:{value:simulation.impactOptions}},vertexShader: waterVertexGLSL, fragmentShader: waterFragmentGLSL,
    depthTest: false, depthWrite: false, transparent: true, blending: AdditiveBlending, premultipliedAlpha: true, toneMapped: false })
  const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh)
  const target = new WebGLRenderTarget(surfaceBudget.resolution, surfaceBudget.resolution, {
    type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
  })
  const bounds = new Vector4(left, bottom, rainDomain.width, rainDomain.height), clear = new Color()
  let count = 0
  function put(x: number, y: number, rx: number, ry: number, height: number, coverage: number, kind: number, angle: number) {
    if (count >= capacity) return
    drops.setXYZW(count, x, y, rx, ry);impacts.setXYZW(count,0,0,0,0); shapes.setXYZW(count++, height, coverage, kind, angle)
  }
  function splat(x: number, y: number, rx: number, ry: number, height: number, coverage: number, kind = 0, angle = 0) {
    const area = rx * ry, footprint = rainDomain.width / surfaceBudget.resolution * .7
    rx = Math.max(rx, footprint); ry = Math.max(ry, footprint)
    const filtered = area / (rx * ry); height *= filtered; coverage *= filtered
    put(x, y, rx, ry, height, coverage, kind, angle)
  }
  return {
    simulation, texture: target.texture, bounds,
    render(renderer: WebGLRenderer, drawDeposits?: (renderer: WebGLRenderer, bounds: Vector4) => void) {
      count = 0
      for (const contact of simulation.contacts) {
        if(contact.age>Math.max(.035,simulation.impactOptions.x))continue;
        const index=count;
        put(contact.x,contact.y,contact.radius,contact.radius,0,1,3,contact.angle);
        if(count>index)impacts.setXYZW(index,contact.vx,contact.vy,contact.age,contact.radius/.822);
      }
      for (const trail of simulation.trails) {
        if (trail.volume < 1e-12) continue
        const length = Math.hypot(trail.endX - trail.x, trail.endY - trail.y), radius = trail.radius
        const height = trail.volume / (4 / 3 * radius * length + Math.PI * radius * radius * .5)
        // A modest optical exaggeration makes thin runnels survive the textured
        // glass and minification; their footprint stays narrow and connected.
        splat((trail.x + trail.endX) * .5, (trail.y + trail.endY) * .5, radius, length * .5 + radius,
          height * 2, Math.min(1, height / .000035), 1, Math.atan2(trail.endY - trail.y, trail.endX - trail.x) - Math.PI / 2)
      }
      for (const drop of simulation.drops) {
        const radius = beadRadius(drop.volume), t = drop.impactAge
        const spread = 1 + drop.impact * 1.25 * Math.sin(Math.min(1, t / .045) * Math.PI / 2) * Math.exp(-t * 15)
        const stretch = 1 + Math.min(2, Math.abs(drop.vy) * 1.6) + .09 * Math.sin(t * 55) * Math.exp(-t * 14) * drop.impact
        const rx = radius * spread / Math.sqrt(stretch), ry = radius * spread * Math.sqrt(stretch)
        const angle = Math.hypot(drop.vx, drop.vy) > .008 ? Math.atan2(drop.vy, drop.vx) - Math.PI / 2 : 0
        splat(drop.x, drop.y, rx, ry, 2 * drop.volume / (Math.PI * rx * ry), 1, 0, angle)
        if (t < .16 && drop.impact > .3) {
          const rim = radius * (1.1 + t * 6)
          splat(drop.x, drop.y, rim, rim, radius * .12 * drop.impact * Math.exp(-t * 24), .6 * Math.exp(-t * 20), 2)
        }
      }
      geometry.instanceCount = count; drops.needsUpdate = shapes.needsUpdate = impacts.needsUpdate = true
      const previous = renderer.getRenderTarget(), alpha = renderer.getClearAlpha(), autoClear = renderer.autoClear
      renderer.getClearColor(clear)
      try {
        renderer.autoClear = true; renderer.setClearColor(0, 0); renderer.setRenderTarget(target); renderer.render(scene, camera); drawDeposits?.(renderer, bounds)
      } finally { renderer.setRenderTarget(previous); renderer.setClearColor(clear, alpha); renderer.autoClear = autoClear }
    },
    dispose() { target.dispose(); geometry.dispose(); quad.dispose(); material.dispose() },
  }
}
