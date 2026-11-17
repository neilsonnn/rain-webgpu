import { Vector2, Vector3, Vector4 } from 'three'
import type { InstancedBufferAttribute } from 'three'

export const MAX_PLANTS = 24
export const motionLimits = { branch: .055, branchDepth: .028, pitch: .18, torsion: .12 } as const
export interface PlantBody {
  root: Vector3; height: number; radius: number; species: number
  paneGap?: number; depthMotion?: number; leafMotion?: number
}
export interface Spring { position: number; velocity: number }
export interface BladeBinding {
  plant: number
  position: Vector3
  length: number
  width: number
  age: number
  species: number
  phase: number
  normal: Vector3
  pitchNormal: Vector3
  torsionNormal: Vector3
  attribute: InstancedBufferAttribute
  index: number
  motionScale?: number
}

// Metres, seconds, kilograms. The cubic term stiffens a loaded petiole/branch;
// damping removes energy, and the stop limits excessive strain near the pane.
export function stepSpring(spring: Spring, force: number, stiffness: number, mass: number, damping: number, dt: number, limit: number) {
  const resistance = stiffness * spring.position * (1 + 2 * (spring.position / limit) ** 2)
  const acceleration = (force - resistance - 2 * damping * Math.sqrt(stiffness * mass) * spring.velocity) / mass
  spring.velocity += acceleration * dt
  spring.position += spring.velocity * dt
  if (Math.abs(spring.position) > limit) {
    spring.position = Math.sign(spring.position) * limit
    if (spring.velocity * spring.position > 0) spring.velocity = 0
  }
}

export function airVelocity(time: number, position: Vector3, breeze: number, result = new Vector3()) {
  const phase = position.x * .7 + position.z * .45
  const gust = .72 + .2 * Math.sin(time * .17 + phase) + .08 * Math.sin(time * .51 - phase)
  return result.set(
    .18 + .11 * Math.sin(time * .37 + phase) + .035 * Math.sin(time * 1.7 + position.x * 2.3),
    .024 * Math.sin(time * .73 + position.z),
    .07 * Math.sin(time * .43 - phase) + .025 * Math.sin(time * 1.31 + position.z * 1.8),
  ).multiplyScalar(gust * breeze)
}

export function createPlantDynamics(plants: readonly PlantBody[], bindings: readonly BladeBinding[], windScale = 1) {
  if (plants.length > MAX_PLANTS) throw new Error('Too many plant roots for the foliage shader.')
  const roots = Array.from({ length: MAX_PLANTS }, () => new Vector4(0, 0, 0, 1))
  const bends = Array.from({ length: MAX_PLANTS }, () => new Vector2())
  const area = plants.map(() => 0)
  const blades = bindings.map(binding => {
    const bladeArea = [.55, .34, .6, .23][binding.species] * binding.length ** 2 * binding.width
    area[binding.plant] += bladeArea
    const mass = bladeArea * (binding.age < .055 ? .085 : .16)
    const inertia = mass * binding.length ** 2 / 3
    const frequency = .95 * Math.sqrt(.24 / binding.length) * (.86 + binding.age * .3)
      * (binding.species === 3 ? 2.7 : 1) * (1 + .09 * Math.sin(binding.phase))
    return { binding, area: bladeArea, mass, inertia, stiffness: inertia * (Math.PI * 2 * frequency) ** 2,
      pitch: { position: 0, velocity: 0 }, torsion: { position: 0, velocity: 0 } }
  })
  const branches = plants.map((plant, index) => {
    roots[index].set(plant.root.x, plant.root.y, plant.root.z, plant.height)
    // Signed height describes upright or hanging shoots; physical length and
    // mass stay positive, while the shader retains the rooted direction.
    const length = Math.abs(plant.height)
    const secondMoment = Math.PI * plant.radius ** 4 / 4
    const modulus = plant.species === 3 ? 1.2e9 : 4e9
    const stiffness = Math.max(.012, 3 * modulus * secondMoment / length ** 3)
    const stemMass = Math.PI * plant.radius ** 2 * length * 600
    return { plant, area: area[index] * .17, stiffness, mass: Math.max(.004, stemMass * .24 + area[index] * .16 * .24),
      x: { position: 0, velocity: 0 }, z: { position: 0, velocity: 0 }, acceleration: new Vector2() }
  })
  const attributes = new Set(bindings.map(binding => binding.attribute))
  const wind = new Vector3()
  let accumulator = 0, time = 12
  const advance = (delta: number, breeze: number) => {
    accumulator += Math.max(0, Math.min(.05, delta))
    const dt = 1 / 120
    let changed = false
    while (accumulator >= dt - 1e-10) {
      accumulator -= dt; time += dt; changed = true
      branches.forEach((branch, index) => {
        airVelocity(time, branch.plant.root, breeze * windScale, wind)
        const drag = .5 * 1.225 * 1.1 * branch.area * wind.length()
        const previousX = branch.x.velocity, previousZ = branch.z.velocity
        stepSpring(branch.x, drag * wind.x, branch.stiffness, branch.mass, .72, dt,
          Math.min(motionLimits.branch, Math.abs(branch.plant.height) * .035))
        stepSpring(branch.z, drag * wind.z, branch.stiffness, branch.mass, .72, dt,
          Math.min(motionLimits.branchDepth, Math.abs(branch.plant.height) * .025) * (branch.plant.depthMotion ?? 1))
        branch.acceleration.set((branch.x.velocity - previousX) / dt, (branch.z.velocity - previousZ) / dt)
        bends[index].set(branch.x.position, branch.z.position)
      })
      for (const blade of blades) {
        const binding = blade.binding, branch = branches[binding.plant]
        airVelocity(time, binding.position, breeze * windScale, wind)
        const h = Math.max(0, Math.min(1.2, (binding.position.y - branch.plant.root.y) / branch.plant.height))
        const shape = .5 * h * h * (3 - h)
        wind.x -= branch.x.velocity * shape; wind.z -= branch.z.velocity * shape
        const normalSpeed = (wind.dot(binding.normal) + blade.pitch.position * wind.dot(binding.pitchNormal)
          + blade.torsion.position * wind.dot(binding.torsionNormal))
          / Math.sqrt(1 + blade.pitch.position ** 2 + blade.torsion.position ** 2)
        const pressure = .5 * 1.225 * 1.1 * normalSpeed * Math.abs(normalSpeed) * blade.area
        const inertial = -blade.mass * shape * (branch.acceleration.x * binding.normal.x + branch.acceleration.y * binding.normal.z)
        const torque = (pressure + inertial) * binding.length * .45
        stepSpring(blade.pitch, torque, blade.stiffness, blade.inertia, .58, dt, motionLimits.pitch * (binding.motionScale ?? 1))
        stepSpring(blade.torsion, pressure * binding.length * .1 * Math.sin(binding.phase),
          blade.stiffness * .65, blade.inertia * .55, .65, dt, motionLimits.torsion * (binding.motionScale ?? 1))
      }
    }
    if (changed) {
      for (const blade of blades) blade.binding.attribute.setXY(blade.binding.index, blade.pitch.position, blade.torsion.position)
      attributes.forEach(attribute => { attribute.needsUpdate = true })
    }
  }
  return { roots, bends, branches, blades, advance }
}

export const branchMotionGLSL = /* glsl */`
attribute float plantIndex;
uniform vec4 uPlantRoots[${MAX_PLANTS}];
uniform vec2 uBranchBend[${MAX_PLANTS}];
vec3 greenhouseWind(vec3 p) {
  int id = int(plantIndex + .5);
  vec4 root = uPlantRoots[id];
  vec2 bend = uBranchBend[id];
  float h = clamp((p.y - root.y) / root.w, 0., 1.2);
  float shape = .5 * h * h * (3. - h);
  return vec3(bend.x * shape, -.6 * dot(bend, bend) / root.w * h * h, bend.y * shape);
}
vec3 greenhouseBranchNormal(vec3 n, vec3 p) {
  int id = int(plantIndex + .5);
  vec4 root = uPlantRoots[id];
  vec2 bend = uBranchBend[id];
  float rawHeight = (p.y - root.y) / root.w;
  float h = clamp(rawHeight, 0., 1.2);
  float derivative = rawHeight > 0. && rawHeight < 1.2 ? 1. / root.w : 0.;
  vec2 slope = bend * (3. * h - 1.5 * h * h) * derivative;
  float shorten = -1.2 * dot(bend, bend) / root.w * h * derivative;
  // Inverse transpose of the cantilever deformation's triangular Jacobian.
  return normalize(vec3(n.x, (n.y - dot(slope, n.xz)) / max(.8, 1. + shorten), n.z));
}
`
