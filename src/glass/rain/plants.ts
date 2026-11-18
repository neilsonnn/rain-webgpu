import { Quaternion, Vector3 } from 'three'
import type { InstancedBufferAttribute } from 'three'
import type { Leaf } from '../earlier/foliage'
import type { PlantBody, Spring } from '../dynamics'
import { stepSpring } from '../dynamics'
import { branchAt } from '../earlier/breeze'
import { dropVolume, rainDiameter, rainfallRate, water } from './settings'
import type { RainSettings } from './settings'
import { random } from '../settings'
import { createRainBranches } from './branches'
import type { RainShoot } from './branches'
import { rainBurst, rainVelocity } from './weather'

export interface RainBinding { leaf: Leaf; attribute: InstancedBufferAttribute; branchAttribute?: InstancedBufferAttribute; index: number; orientation: Quaternion }
const spring = (): Spring => ({ position: 0, velocity: 0 })
const limitVelocity = (value: number, limit = 24) => Math.max(-limit, Math.min(limit, value))
const cellSize = .28, bucketCount = 16384

export function createRainPlants(plants: readonly PlantBody[], bindings: readonly RainBinding[], enhanced = false, skeleton: readonly RainShoot[] = []) {
  const rng = random(615771)
  const blades = bindings.map(binding => {
    const leaf = binding.leaf, area = leaf.length ** 2 * leaf.width * (leaf.species === 1 ? .42 : .56)
    const mass = area * (.12 + leaf.age * .06), inertia = mass * leaf.length ** 2 / 3
    const frequency = 4.4 * Math.sqrt(.24 / leaf.length) * (.88 + leaf.age * .2)
    return { binding, area, dryMass: mass, inertia, stiffness: inertia * (Math.PI * 2 * frequency) ** 2,
      pitch: spring(), twist: spring(), roll: spring(), retained: 0, wetness: 0, exposure: 1, drip: 0,
      nextHit: -Math.log(Math.max(1e-6, rng())), catchment: (area / .025) ** .55,
      center: new Vector3(), normal: new Vector3(), across: new Vector3(), along: new Vector3(),
      orientation: new Quaternion(), inverse: new Quaternion(), restInverse: binding.orientation.clone().invert(), hits: 0,
      cellX: 0, cellY: 0, cellZ: 0, radius: Math.max(leaf.length*.49,leaf.length*leaf.width*.36) }
  })
  const scaffold = createRainBranches(plants, blades.map(blade => ({ leaf: blade.binding.leaf, area: blade.area, dryMass: blade.dryMass })), skeleton)
  const { branches } = scaffold
  const branchOf = (index: number) => branches[scaffold.leafIndices[index]]
  bindings.forEach((binding, index) => binding.branchAttribute?.setX(binding.index, scaffold.leafIndices[index]))
  const heads = new Int32Array(bucketCount), next = new Int32Array(blades.length)
  const canopyMin = new Vector3(), canopyMax = new Vector3()
  let largestLeaf = 0
  for (const blade of blades) largestLeaf = Math.max(largestLeaf,blade.radius)
  const attributes = new Set(bindings.map(binding => binding.attribute))
  const qx = new Quaternion(), qy = new Quaternion(), qz = new Quaternion()
  const xAxis = new Vector3(1, 0, 0), yAxis = new Vector3(0, 1, 0), zAxis = new Vector3(0, 0, 1)
  const offset = new Vector3(), local = new Vector3(), velocityLocal = new Vector3(), normalScratch = new Vector3()
  const hitPoint = new Vector3(), hitVelocity = new Vector3(), arm = new Vector3(), acceleration = new Vector3()
  let tick = 0, totalHits = 0, clock = 12
  const key = (x: number, y: number, z: number) => (Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791)) & (bucketCount-1)

  function colliders(time: number, breeze: number, spatialIndex = true) {
    if (spatialIndex) {
      heads.fill(-1)
      canopyMin.set(Infinity,Infinity,Infinity); canopyMax.set(-Infinity,-Infinity,-Infinity)
    }
    for (let index = 0; index < blades.length; index++) {
      const blade = blades[index]
      const { leaf, orientation } = blade.binding, branch = branchOf(index)
      // A mid-blade tangent ellipse is the collision proxy for the curved mesh.
      const hinge = .82 + .18 * .52 ** 2
      qx.setFromAxisAngle(xAxis, blade.pitch.position * hinge)
      qy.setFromAxisAngle(yAxis, blade.twist.position * hinge)
      qz.setFromAxisAngle(zAxis, blade.roll.position * hinge)
      blade.orientation.copy(branch.rotation).multiply(orientation).multiply(qx).multiply(qy).multiply(qz)
      blade.inverse.copy(blade.orientation).invert()
      blade.across.copy(xAxis).applyQuaternion(blade.orientation)
      blade.along.copy(yAxis).applyQuaternion(blade.orientation)
      blade.normal.set(0, 0, 1).applyQuaternion(blade.orientation)
      blade.center.copy(leaf.position).applyMatrix4(branch.matrix).addScaledVector(blade.along, leaf.length * .52)
      if (enhanced) branchAt(blade.center, branch.plant.root, branch.plant.height, time, breeze, Boolean(branch.plant.paneGap), blade.center)
      else {
        const p = blade.center, h = Math.max(0, p.y), bend = Math.min(h * h, 12) * .0065 * breeze
        const wave = Math.sin(time * .43 + p.x * .75 + p.z * .3) + .38 * Math.sin(time * .79 - p.z * 1.3 + p.y * .6)
        p.add(offset.set(wave * bend, -.08 * Math.abs(wave) * bend, Math.sin(time * .37 + p.x * .55) * bend * .5 * (branch.plant.paneGap ? .06 : 1)))
      }
      if (!spatialIndex) continue
      const p = blade.center, r = blade.radius
      canopyMin.x = Math.min(canopyMin.x,p.x-r); canopyMin.y = Math.min(canopyMin.y,p.y-r); canopyMin.z = Math.min(canopyMin.z,p.z-r)
      canopyMax.x = Math.max(canopyMax.x,p.x+r); canopyMax.y = Math.max(canopyMax.y,p.y+r); canopyMax.z = Math.max(canopyMax.z,p.z+r)
      blade.cellX = Math.floor(p.x/cellSize); blade.cellY = Math.floor(p.y/cellSize); blade.cellZ = Math.floor(p.z/cellSize)
      const cell = key(blade.cellX,blade.cellY,blade.cellZ)
      next[index] = heads[cell]; heads[cell] = index
    }
    // Canopy interception changes slowly: sheltered lower leaves receive less
    // unresolved rainfall, while explicit falling droplets hit the nearest leaf.
    if (spatialIndex && tick++ % 30 === 0) for (const blade of blades) {
      let cover = 0
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const x = blade.cellX+dx, z = blade.cellZ+dz
        for (let y=blade.cellY;y<=Math.floor(canopyMax.y/cellSize);y++) {
          for (let i=heads[key(x,y,z)];i!==-1;i=next[i]) {
            const other = blades[i]
            if (other.cellX !== x || other.cellY !== y || other.cellZ !== z) continue
            if (other.center.y > blade.center.y + .06 && Math.hypot(other.center.x - blade.center.x, other.center.z - blade.center.z) < other.binding.leaf.length * .4) cover++
          }
        }
      }
      blade.exposure = Math.max(.1, Math.exp(-cover * .6))
    }
  }

  const intersection = { index: -1, fraction: 2 }
  function intersect(start: Vector3, end: Vector3, radius = 0) {
    intersection.index = -1; intersection.fraction = 2
    if (Math.max(start.x,end.x)+radius < canopyMin.x || Math.min(start.x,end.x)-radius > canopyMax.x
      || Math.max(start.y,end.y)+radius < canopyMin.y || Math.min(start.y,end.y)-radius > canopyMax.y
      || Math.max(start.z,end.z)+radius < canopyMin.z || Math.min(start.z,end.z)-radius > canopyMax.z) return intersection
    const margin = largestLeaf+radius
    const x0=Math.floor((Math.min(start.x,end.x)-margin)/cellSize), x1=Math.floor((Math.max(start.x,end.x)+margin)/cellSize)
    const y0=Math.floor((Math.min(start.y,end.y)-margin)/cellSize), y1=Math.floor((Math.max(start.y,end.y)+margin)/cellSize)
    const z0=Math.floor((Math.min(start.z,end.z)-margin)/cellSize), z1=Math.floor((Math.max(start.z,end.z)+margin)/cellSize)
    let hit = -1, closest = 2
    offset.subVectors(end, start)
    // A full swept AABB includes fast rain and unusually large leaves. Unlike
    // the old x/z columns, each query only visits the relevant height range.
    for (let x=x0;x<=x1;x++) for (let y=y0;y<=y1;y++) for (let z=z0;z<=z1;z++) {
      const at = key(x,y,z)
      for (let i = heads[at]; i !== -1; i = next[i]) {
        const blade = blades[i]
        if (blade.cellX !== x || blade.cellY !== y || blade.cellZ !== z) continue
        const denominator = offset.dot(blade.normal)
        if (Math.abs(denominator) < 1e-7) continue
        const t = local.subVectors(blade.center, start).dot(blade.normal) / denominator
        if (t < 0 || t > 1 || t >= closest) continue
        local.copy(start).addScaledVector(offset, t).sub(blade.center)
        const leaf = blade.binding.leaf
        const across = local.dot(blade.across) / (leaf.length * leaf.width * .36+radius), along = local.dot(blade.along) / (leaf.length * .49+radius)
        if (across * across + along * along < 1) { closest = t; hit = i }
      }
    }
    intersection.index = hit; intersection.fraction = closest
    return intersection
  }

  function impact(index: number, point: Vector3, velocity: Vector3, diameter: number, settings: RainSettings, collect = true) {
    const blade = blades[index], leaf = blade.binding.leaf
    const mass = dropVolume(diameter) * water.density
    velocityLocal.copy(velocity).applyQuaternion(blade.inverse)
    local.subVectors(point, blade.center).applyQuaternion(blade.inverse)
    const lever = Math.max(.015, local.y + leaf.length * .52)
    const inertia = blade.inertia + blade.retained * leaf.length ** 2 * .38
    // Amplify readable impulses, not softness. A large hit reaches its first
    // deflection in tens of milliseconds and the stiff hinge rebounds quickly.
    const gain = settings.rainImpact * 3.5 * (1 + .8 * Math.max(0, (diameter - .0025) / .004))
    blade.pitch.velocity = limitVelocity(blade.pitch.velocity + .65 * mass * velocityLocal.z * lever / inertia * gain)
    blade.twist.velocity = limitVelocity(blade.twist.velocity - .65 * mass * velocityLocal.z * local.x / (inertia * .45) * gain, 18)
    // In-plane petiole rotation is essential for camera-facing broad leaves:
    // r × J has a z component even when rain is almost tangent to the blade.
    blade.roll.velocity = limitVelocity(blade.roll.velocity - .65 * mass * velocityLocal.x * lever / inertia * gain)
    scaffold.impact(scaffold.leafIndices[index], point, velocity, mass, gain, settings.rainMainBranchStiffness)
    if (collect) blade.retained += mass * .42
    blade.hits++
    if (collect) totalHits++
  }

  function step(dt: number, settings: RainSettings, intensity: number, drip?: (point: Vector3, diameter: number) => void,
    splash?: (point: Vector3, diameter: number, normal: Vector3, velocity: Vector3, wetness: number) => void, resolvedRain = false) {
    if (dt <= 0) return
    clock += dt
    // Standalone callers can supply unresolved rainfall. The live shower
    // resolves contacts and disables this extra source: visible strikes now
    // account for its leaf kicks, retained water and spray.
    const arrivalRate = !resolvedRain && intensity > 0 ? (.15 + 7.5 * intensity ** 1.8) * rainBurst(clock) : 0
    for (let i = 0; i < blades.length && arrivalRate > 0; i++) {
      const blade = blades[i], leaf = blade.binding.leaf
      blade.nextHit -= arrivalRate * blade.catchment * blade.exposure * (.3 + .7 * Math.abs(blade.normal.y)) * dt
      if (blade.nextHit > 0) continue
      blade.nextHit += -Math.log(Math.max(1e-6, rng()))
      const diameter = rainDiameter(rng(), intensity, settings.rainDropSize)
      hitPoint.copy(blade.center).addScaledVector(blade.along, (rng() - .35) * leaf.length * .65)
        .addScaledVector(blade.across, (rng() - .5) * leaf.length * leaf.width * .55)
      rainVelocity(hitVelocity, hitPoint, clock, settings, intensity, diameter)
      // Continuous intercepted flux below already accounts for this water.
      impact(i, hitPoint, hitVelocity, diameter, settings, false)
      splash?.(hitPoint, diameter, blade.normal, hitVelocity, blade.wetness)
    }
    scaffold.clearLoads()
    for (let i = 0; i < blades.length; i++) {
      const blade = blades[i], leaf = blade.binding.leaf
      const capacity = blade.area * .000085 * water.density * settings.rainRetention
      const flux = !resolvedRain && intensity > 0 ? rainfallRate(intensity) / 3.6e6 * water.density : 0
      blade.retained += flux * blade.area * Math.abs(blade.normal.y) * blade.exposure * dt
      const runoff = Math.max(0, blade.retained - capacity) + Math.min(blade.retained, blade.retained * dt * (.025 + .1 * Math.abs(blade.pitch.velocity)))
      blade.retained = Math.max(0, blade.retained - runoff)
      blade.drip += runoff
      blade.retained *= Math.exp(-dt / (intensity > 0 ? 180 : 38 * settings.rainRetention))
      const diameter = .0025 + .0015 * leaf.age, dripMass = dropVolume(diameter) * water.density
      if (blade.drip > dripMass && drip) {
        normalScratch.copy(blade.center).addScaledVector(blade.along, leaf.length * .45)
        drip(normalScratch, diameter); blade.drip -= dripMass
      }
      blade.wetness = Math.min(1, blade.retained / Math.max(1e-9, capacity * .35))
      scaffold.load(scaffold.leafIndices[i], blade.center, blade.retained)
    }
    scaffold.step(dt, settings)
    for (let i = 0; i < blades.length; i++) {
      const blade = blades[i], leaf = blade.binding.leaf, branch = branchOf(i)
      const inertia = blade.inertia + blade.retained * leaf.length ** 2 * .38
      const flexibility = settings.rainFlexibility, stiffness = blade.stiffness / flexibility
      arm.copy(leaf.position).applyMatrix4(branch.matrix).sub(branch.worldRoot)
      acceleration.crossVectors(branch.acceleration, arm).add(branch.originAcceleration)
      normalScratch.crossVectors(branch.velocity, arm)
      acceleration.add(offset.crossVectors(branch.velocity, normalScratch))
      blade.restInverse.copy(branch.rotation).multiply(blade.binding.orientation).invert()
      normalScratch.set(0, -water.gravity * blade.retained, 0)
        .addScaledVector(acceleration, -(blade.dryMass + blade.retained) * .25).applyQuaternion(blade.restInverse)
      const near = branch.plant.paneGap ? .75 : 1
      stepSpring(blade.pitch, normalScratch.z * leaf.length * .48, stiffness, inertia, .32, dt, .75 * near)
      stepSpring(blade.twist, normalScratch.z * leaf.length * .045 * Math.sin(leaf.phase), stiffness * .8, inertia * .45, .3, dt, .46 * near)
      stepSpring(blade.roll, -normalScratch.x * leaf.length * .48, stiffness * .9, inertia, .34, dt, .7 * near)
    }
  }
  function upload() {
    for (const blade of blades) blade.binding.attribute.setXYZW(blade.binding.index, blade.pitch.position, blade.twist.position, blade.wetness, blade.roll.position)
    for (const attribute of attributes) attribute.needsUpdate = true
  }
  function settled() {
    const atRest = (axis: Spring) => Math.abs(axis.position) < 1e-5 && Math.abs(axis.velocity) < 1e-5
    for (const blade of blades) {
      if (blade.retained >= 1e-8 || !atRest(blade.pitch) || !atRest(blade.twist) || !atRest(blade.roll)) return false
    }
    return branches.every(branch => atRest(branch.x) && atRest(branch.y) && atRest(branch.z))
  }
  return { texture: scaffold.texture, branchIndex: scaffold.indexOf, dispose: scaffold.dispose,
    blades, branches, colliders, intersect, impact, step, upload, settled, get hitCount() { return totalHits } }
}
export const rainLeafGLSL = /* glsl */`
attribute vec4 rainLeaf;
varying vec2 vRainLeaf;
mat3 greenhouseRainRotation(float h) {
  float hinge = .82 + .18 * h * h;
  float pitch = rainLeaf.x * hinge, twist = rainLeaf.y * hinge, roll = rainLeaf.w * hinge;
  mat3 ry = mat3(cos(twist), 0., -sin(twist), 0., 1., 0., sin(twist), 0., cos(twist));
  mat3 rx = mat3(1., 0., 0., 0., cos(pitch), sin(pitch), 0., -sin(pitch), cos(pitch));
  mat3 rz = mat3(cos(roll), sin(roll), 0., -sin(roll), cos(roll), 0., 0., 0., 1.);
  return rx * ry * rz;
}
vec3 greenhouseRainLeaf(vec3 p) {
  return greenhouseRainRotation(p.y) * p;
}
vec3 greenhouseRainLeafNormal(vec3 p, vec3 n) {
  float h = p.y, hinge = .82 + .18 * h * h;
  float pitch = rainLeaf.x * hinge, twist = rainLeaf.y * hinge, roll = rainLeaf.w * hinge;
  mat3 ry = mat3(cos(twist), 0., -sin(twist), 0., 1., 0., sin(twist), 0., cos(twist));
  mat3 rx = mat3(1., 0., 0., 0., cos(pitch), sin(pitch), 0., -sin(pitch), cos(pitch));
  mat3 rz = mat3(cos(roll), sin(roll), 0., -sin(roll), cos(roll), 0., 0., 0., 1.);
  mat3 rotation = rx * ry * rz;
  vec3 dy = rotation[1] + cross(vec3(1., 0., 0.), rotation * p) * (.36 * h * rainLeaf.x)
    + rx * cross(vec3(0., 1., 0.), ry * rz * p) * (.36 * h * rainLeaf.y)
    + rx * ry * cross(vec3(0., 0., 1.), rz * p) * (.36 * h * rainLeaf.w);
  return normalize(mat3(cross(dy, rotation[2]), cross(rotation[2], rotation[0]), cross(rotation[0], dy)) * n);
}
`
