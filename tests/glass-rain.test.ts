import { describe, expect, it } from 'vitest'
import { InstancedBufferAttribute, PlaneGeometry, Quaternion, Vector3 } from 'three'
import { rainDefaults, rainPresets, normalizeRain, dropVolume, fallSpeed, rainDiameter } from '../src/glass/rain/settings'
import { SurfaceWater, surfaceBudget } from '../src/glass/rain/surface'
import { createRainPlants } from '../src/glass/rain/plants'
import { createRainBranches } from '../src/glass/rain/branches'
import { rainVelocity } from '../src/glass/rain/weather'
import { rainVertexGLSL } from '../src/glass/rain/shaders'
import { createRainTerrain } from '../src/glass/rain/terrain'
import { rolledGlassTexture } from '../src/glass/earlier/textures'
import { Vector2 } from 'three'
import { defaults, normalizeGlassSettings } from '../src/glass/earlier/settings'
import type { Leaf } from '../src/glass/earlier/foliage'

function plants(orientation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)) {
  const attribute = new InstancedBufferAttribute(new Float32Array(8), 4)
  const leaves: Leaf[] = [1.2, .8].map(y => ({ position: new Vector3(0, y, -1), direction: new Vector3(0, 0, -1),
    length: .3, width: 1, twist: 0, phase: .4, age: .5, species: 0, plant: 0 }))
  const result = createRainPlants([{ root: new Vector3(0, 0, -1), height: 1.5, radius: .0052, species: 0 }],
    leaves.map((leaf, index) => ({ leaf, attribute, index, orientation })))
  result.colliders(12, 0)
  return result
}

describe('rain water and foliage coupling', () => {
  it('keeps old optical tuning intact and validates weather controls', () => {
    const s = normalizeGlassSettings({ relief: .613, rainIntensity: 5, rainImpact: Infinity, rainDropSize: -4 }, defaults)
    expect(s.relief).toBe(.613); expect(s.rain).toBe(false)
    expect(s.rainIntensity).toBe(1); expect(s.rainDropSize).toBe(.5)
    expect(s.rainImpact).toBe(rainDefaults.rainImpact)
    expect(normalizeRain({ ...rainDefaults, rainWind: -20 }).rainWind).toBe(-1)
  })
  it('coalesces intersecting caps while conserving water volume and momentum', () => {
    const surface = new SurfaceWater(), a = dropVolume(.004), b = dropVolume(.006)
    surface.add(0, 2, a, .1, -.1); surface.add(.001, 2, b, -.2, -.3)
    surface.step(0, rainDefaults, 0)
    expect(surface.drops).toHaveLength(1)
    expect(surface.drops[0].volume).toBeCloseTo(a + b, 14)
    expect(surface.drops[0].vx).toBeCloseTo((a * .1 + b * -.2) / (a + b), 10)
    expect(surface.drops[0].vy).toBeCloseTo((a * -.1 + b * -.3) / (a + b), 10)
  })
  it('pins small beads and lets a sufficiently heavy cap run down and deposit a trail', () => {
    const surface = new SurfaceWater()
    surface.add(-.5, 3, dropVolume(.0005)); surface.add(.5, 3, dropVolume(.007))
    for (let i = 0; i < 120; i++) surface.step(1 / 120, rainDefaults, 0)
    expect(surface.drops[0].y).toBeCloseTo(3, 7)
    expect(surface.drops[1].y).toBeLessThan(2.98)
    expect(surface.trails.length).toBeGreaterThan(0)
    expect(surface.drops[1].volume).toBeLessThan(dropVolume(.007))
  })
  it('bounds its surface pool and uses drop size to determine fall speed', () => {
    const surface = new SurfaceWater()
    for (let i = 0; i < surfaceBudget.drops + 20; i++) surface.add(i, 1, dropVolume(.002))
    expect(surface.drops).toHaveLength(surfaceBudget.drops)
    expect(surface.drops.reduce((sum, drop) => sum + drop.volume, 0) + surface.unresolved).toBeCloseTo((surfaceBudget.drops + 20) * dropVolume(.002), 12)
    expect(surface.unresolved).toBeGreaterThan(0)
    expect(surface.drops.every(drop => drop.volume === dropVolume(.002))).toBe(true)
    expect(surface.deposited).toBeCloseTo((surfaceBudget.drops + 20) * dropVolume(.002), 12)
    expect(fallSpeed(.004)).toBeGreaterThan(fallSpeed(.001))
    expect(fallSpeed(.008)).toBeLessThan(10)
  })
  it('collects beads along a falling path, keeps a running head, and leaves a narrow trail', () => {
    const surface = new SurfaceWater()
    surface.add(0, 3.2, dropVolume(.007), 0, -.7)
    for (let i = 0; i < 14; i++) surface.add(.0005, 3.18 - i * .014, dropVolume(.0035))
    for (let i = 0; i < 120; i++) surface.step(1 / 120, { ...rainDefaults, rainFlow: 1 }, 0)
    expect(surface.merges).toBeGreaterThan(6)
    expect(surface.drops.some(drop => drop.y < 3 && drop.vy < -.01)).toBe(true)
    expect(surface.trails.length).toBeGreaterThan(10)
    expect(surface.trails.every(trail => trail.radius < .01)).toBe(true)
    const retained = surface.drops.reduce((sum, drop) => sum + drop.volume, 0)
      + surface.trails.reduce((sum, trail) => sum + trail.volume, 0)
    expect(retained + surface.drained + surface.evaporated + surface.unresolved).toBeCloseTo(surface.deposited, 12)
  })
  it('keeps new impacts and running drops active in a sustained downpour without a sheet layer', () => {
    const surface = new SurfaceWater(), settings = { ...rainDefaults, ...rainPresets.Downpour }
    for (let i = 0; i < 1200; i++) surface.step(1 / 120, settings, 1)
    expect(surface.impacts).toBeGreaterThan(5000)
    expect(surface.merges).toBeGreaterThan(10)
    expect(surface.drops.filter(drop => drop.pinned).length).toBeGreaterThan(500)
    expect(surface.drops.filter(drop => drop.vy < -.006).length).toBeGreaterThan(5)
    expect(surface.drops.length).toBeLessThanOrEqual(surfaceBudget.drops)
    expect(surface.trails.length).toBeLessThanOrEqual(surfaceBudget.trails)
    expect(surface.drops.every(drop => Number.isFinite(drop.volume) && drop.volume > 0)).toBe(true)
    const hits = surface.impacts
    surface.step(0, settings, 1)
    expect(surface.impacts).toBe(hits)
  })
  it('gives broad camera-facing leaves a sharp downward kick and quick rebound, with much smaller light-rain hits', () => {
    const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 3)
    const heavy = plants(orientation), light = plants(orientation)
    const velocity = new Vector3(0, -9, 0)
    heavy.impact(0, heavy.blades[0].center, velocity, .007, rainDefaults, false)
    light.impact(0, light.blades[0].center, velocity, .0015, rainDefaults, false)
    expect(heavy.blades[0].roll.velocity).toBeLessThan(-5)
    let peak = 0, lightPeak = 0, peakAt = 0, rebounded = false
    for (let i = 0; i < 120; i++) {
      heavy.step(1 / 120, rainDefaults, 0); light.step(1 / 120, rainDefaults, 0)
      const angle = heavy.blades[0].roll.position
      if (-angle > peak) { peak = -angle; peakAt = (i + 1) / 120 }
      lightPeak = Math.max(lightPeak, Math.abs(light.blades[0].roll.position))
      if (i < 30 && angle > .005) rebounded = true
    }
    expect(peak).toBeGreaterThan(.15)
    expect(peakAt).toBeLessThan(.1)
    expect(rebounded).toBe(true)
    expect(peak).toBeGreaterThan(lightPeak * 10)
    expect(Math.abs(heavy.blades[0].roll.position)).toBeLessThan(.01)
    expect(Math.abs(heavy.branches[0].y.position)).toBeLessThan(.01)
  })
  it('hits the first leaf in the falling path and couples off-centre impact into twist and branch movement', () => {
    const model = plants(), start = new Vector3(.045, 2, -1.156), end = new Vector3(.045, .4, -1.156)
    const hit = model.intersect(start, end)
    expect(hit.index).toBe(0)
    model.impact(hit.index, start.lerp(end, hit.fraction), new Vector3(.2, -7, 0), .005, rainDefaults)
    expect(Math.abs(model.blades[0].pitch.velocity)).toBeGreaterThan(0)
    expect(Math.abs(model.blades[0].twist.velocity)).toBeGreaterThan(0)
    expect(model.branches[0].y.velocity).toBeLessThan(0)
    expect(model.blades[1].hits).toBe(0)
    model.step(1 / 120, rainDefaults, 0)
    expect(Math.abs(model.blades[1].pitch.velocity)).toBeGreaterThan(0)
  })
  it('accumulates water weight, sags, drains, and stays bounded at the strongest controls', () => {
    const model = plants(), s = { ...rainDefaults, rain: true, rainImpact: 4, rainFlexibility: 2.5, rainRetention: 3 }
    for (let i = 0; i < 1200; i++) {
      model.colliders(12 + i / 120, 0)
      if (i % 35 === 0) model.impact(0, model.blades[0].center, new Vector3(0, -8, 0), .006, s)
      model.step(1 / 120, s, 1)
    }
    expect(model.branches[0].waterMass).toBeGreaterThan(0)
    expect(model.branches[0].x.position).toBeLessThan(0)
    const wet = model.blades[0].retained
    for (const blade of model.blades) {
      expect(Number.isFinite(blade.pitch.velocity)).toBe(true)
      expect(Math.abs(blade.pitch.position)).toBeLessThanOrEqual(.75)
      expect(Math.abs(blade.twist.position)).toBeLessThanOrEqual(.46)
      expect(Math.abs(blade.roll.position)).toBeLessThanOrEqual(.7)
    }
    for (let i = 0; i < 600; i++) model.step(1 / 120, s, 0)
    expect(model.blades[0].retained).toBeLessThan(wet)
  })
  it('uses shared, changing oblique rain with size-dependent falling speeds', () => {
    const p = new Vector3(.4, 2, -.1), a = new Vector3(), b = new Vector3(), c = new Vector3()
    rainVelocity(a, p, 12, rainDefaults, 1, .006)
    rainVelocity(b, p, 14, rainDefaults, 1, .006)
    rainVelocity(c, p, 12, rainDefaults, 1, .001)
    expect(a.x).toBeGreaterThan(.5); expect(a.z).toBeLessThan(-.4)
    expect(a.distanceTo(b)).toBeGreaterThan(.1)
    expect(a.y).toBeLessThan(c.y - 3)
    expect(c.x).toBeCloseTo(a.x, 12)
  })
  it('steers running beads with the rolled glass and changes course as they absorb off-axis beads', () => {
    const texture = rolledGlassTexture(96)
    const terrain = createRainTerrain(texture, () => defaults, { origin: new Vector2(), warp: { value: -.00008 } })
    const sample = { ...terrain.sample(.043, 2.12, .003) }
    expect(Math.hypot(sample.x, sample.y)).toBeGreaterThan(.0001)
    expect(terrain.sample(.046, 2.13, .003)).not.toEqual(sample)
    const slope = new SurfaceWater({ sample: () => ({ x: .2, y: .05, pinning: 1 }) }), flat = new SurfaceWater()
    const s = { ...rainDefaults, rainWind: 0, rainFlow: 1, rainFriction: .5 }
    for (const water of [slope, flat]) water.add(0, 3, dropVolume(.007))
    for (let i = 0; i < 60; i++) { slope.step(1 / 120, s, 0); flat.step(1 / 120, s, 0) }
    expect(slope.drops[0].x).toBeLessThan(flat.drops[0].x - .005)
    const merge = new SurfaceWater()
    merge.add(0, 2.5, dropVolume(.007), 0, -.4); merge.add(.007, 2.49, dropVolume(.006))
    for (let i = 0; i < 8; i++) merge.step(1 / 120, s, 0)
    expect(merge.merges).toBe(1)
    expect(merge.drops[0].vx).toBeGreaterThan(.003)
    expect(merge.drops[0].x).toBeGreaterThan(.001)
    texture.dispose()
  })
  it('loses water into its trail, stops exactly, stays stopped, and restarts after collecting a fresh bead', () => {
    const surface = new SurfaceWater(), s = { ...rainDefaults, rainWind: 0 }
    const drop = surface.add(.2, 3, dropVolume(.007), 0, -.25)
    for (let i = 0; i < 1200; i++) surface.step(1 / 120, s, 0)
    expect(drop.alive).toBe(true)
    expect(drop.pinned).toBe(true)
    expect(drop.vx).toBe(0); expect(drop.vy).toBe(0)
    expect(drop.y).toBeLessThan(2.98); expect(drop.y).toBeGreaterThan(2)
    const rest = { x: drop.x, y: drop.y, volume: drop.volume }
    for (let i = 0; i < 120; i++) surface.step(1 / 120, s, 0)
    expect(drop.x).toBe(rest.x); expect(drop.y).toBe(rest.y)
    surface.add(drop.x + .0001, drop.y, dropVolume(.006))
    for (let i = 0; i < 60; i++) surface.step(1 / 120, s, 0)
    expect(surface.merges).toBeGreaterThan(0)
    expect(drop.y).toBeLessThan(rest.y - .008)
    const held = surface.drops.reduce((sum, cap) => sum + cap.volume, 0) + surface.trails.reduce((sum, trail) => sum + trail.volume, 0)
    expect(held + surface.drained + surface.evaporated + surface.unresolved).toBeCloseTo(surface.deposited, 12)
  })
  it('has a broad drop-size population and does not replace tuned size/speed when selecting weather presets', () => {
    const sizes = Array.from({ length: 1000 }, (_, i) => rainDiameter((i + .5) / 1000, 1, 2))
    expect(sizes[950]).toBeGreaterThan(sizes[100] * 8)
    expect(sizes[999]).toBeLessThan(.0073)
    for (const preset of [rainPresets.Drizzle, rainPresets.Shower, rainPresets.Downpour]) {
      const tuned = { ...rainDefaults, rainFlow: .3, rainDropSize: 2, ...preset }
      expect(tuned.rainFlow).toBe(.3); expect(tuned.rainDropSize).toBe(2)
    }
  })
  it('mixes fully pinned beads with substantially different sliding speeds at the chosen default flow', () => {
    const surface = new SurfaceWater()
    for (let i = 0; i < 90; i++) surface.add(-1.5 + i % 10 * .12, 2 + Math.floor(i / 10) * .12, dropVolume(.0025 + i % 7 * .0007))
    for (let i = 0; i < 24; i++) surface.step(1 / 120, rainDefaults, 0)
    const speeds = surface.drops.map(drop => Math.hypot(drop.vx, drop.vy)).filter(speed => speed > .003).sort((a, b) => a - b)
    expect(surface.drops.filter(drop => drop.vx === 0 && drop.vy === 0).length).toBeGreaterThan(20)
    expect(speeds.length).toBeGreaterThan(8)
    expect(speeds.at(-1)!).toBeGreaterThan(speeds[0] * 6)
  })
  it('keeps the actual rain shader billboard triangles facing the camera for every falling direction', () => {
    // Evaluate the shader's 2D basis, not a second implementation of it. Valid
    // GLSL with the opposite perpendicular parses but culls every FrontSide quad.
    const expression = rainVertexGLSL.match(/vec2 across = vec2\(([^,]+),\s*([^\)]+)\)/)!
    const component = (code: string, along: Vector2) => {
      const part = code.trim().match(/^(-?)along\.([xy])$/)!
      return (part[1] ? -1 : 1) * along[part[2] as 'x' | 'y']
    }
    const quad = new PlaneGeometry(1, 1), positions = quad.getAttribute('position'), index = quad.index!
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
      const along = new Vector2(Math.cos(angle), Math.sin(angle))
      const across = new Vector2(component(expression[1], along), component(expression[2], along))
      const projected = Array.from({ length: positions.count }, (_, i) => across.clone().multiplyScalar(positions.getX(i)).addScaledVector(along, positions.getY(i)))
      for (let i = 0; i < index.count; i += 3) {
        const a = projected[index.getX(i)], b = projected[index.getX(i + 1)], c = projected[index.getX(i + 2)]
        expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0)
      }
    }
    quad.dispose()
  })
  it('rotates about the branch attachment with larger torque at the tip and motion in multiple axes', () => {
    const body = { root: new Vector3(0, 1, -1), height: 1, radius: .003, species: 0 }
    const shoot = { root: body.root, tip: new Vector3(1, 1, -1), radius: .003, plant: 0 }
    const leaf: Leaf = { position: new Vector3(.8, 1, -1), direction: new Vector3(1, 0, 0),
      length: .2, width: 1, twist: 0, phase: 0, age: .5, species: 0, plant: 0, shoot }
    const make = () => createRainBranches([body], [{ leaf, area: .02, dryMass: .003 }])
    const base = make(), tip = make(), velocity = new Vector3(1, -8, 1.8)
    base.impact(0, new Vector3(.08, 1, -1), velocity, .0001, 5)
    tip.impact(0, new Vector3(.9, 1, -1), velocity, .0001, 5)
    expect(Math.abs(tip.branches[0].z.velocity)).toBeGreaterThan(Math.abs(base.branches[0].z.velocity) * 8)
    expect(Math.abs(tip.branches[0].y.velocity)).toBeGreaterThan(.001)
    for (let i = 0; i < 8; i++) tip.step(1 / 120, rainDefaults)
    const branch = tip.branches[0], pivot = shoot.root.clone().applyMatrix4(branch.matrix), end = shoot.tip.clone().applyMatrix4(branch.matrix)
    expect(pivot.distanceTo(shoot.root)).toBeLessThan(1e-8)
    expect(end.y).toBeLessThan(shoot.tip.y)
    expect(Math.abs(end.z - shoot.tip.z)).toBeGreaterThan(.0001)
    expect(pivot.distanceTo(end)).toBeCloseTo(shoot.root.distanceTo(shoot.tip), 10)
    base.dispose(); tip.dispose()
  })
})
