import { DataTexture, FloatType, Matrix4, NearestFilter, Quaternion, RGBAFormat, Vector3 } from 'three'
import type { PlantBody, Spring } from '../dynamics'
import type { Leaf } from '../earlier/foliage'
import type { RainSettings } from './settings'
import { water } from './settings'

export interface RainShoot {
  root: Vector3
  tip: Vector3
  radius: number
  plant: number
  parent?: RainShoot
}
const spring = (): Spring => ({ position: 0, velocity: 0 })
const xAxis = new Vector3(1, 0, 0), yAxis = new Vector3(0, 1, 0), zAxis = new Vector3(0, 0, 1)
const axes = ['x', 'y', 'z'] as const

// A small hinged skeleton, shared by the stems, leaf instances, shadows and
// collision proxies. The branch lever is measured from its actual fork.
export function createRainBranches(plants: readonly PlantBody[], leaves: readonly { leaf: Leaf; area: number; dryMass: number }[], skeleton: readonly RainShoot[] = []) {
  const fallback = plants.map(plant => ({ root: plant.root, tip: plant.root.clone().add(new Vector3(0, plant.height, 0)),
    radius: plant.radius, plant: plants.indexOf(plant) } satisfies RainShoot))
  const indices = new Map<RainShoot, number>(), shoots: RainShoot[] = []
  function register(shoot: RainShoot): number {
    const found = indices.get(shoot)
    if (found !== undefined) return found
    if (shoot.parent) register(shoot.parent)
    const index = shoots.length; indices.set(shoot, index); shoots.push(shoot)
    return index
  }
  const indexOf = (shoot: RainShoot | undefined, plant: number) => register(shoot ?? fallback[plant])
  skeleton.forEach(register)
  const leafIndices = leaves.map(({ leaf }) => indexOf(leaf.shoot, leaf.plant))
  const branches = shoots.map(shoot => {
    const length = Math.max(.12, shoot.root.distanceTo(shoot.tip)), mass = Math.PI * shoot.radius ** 2 * length * 450
    return { shoot, plant: plants[shoot.plant], parent: shoot.parent ? indices.get(shoot.parent)! : -1,
      x: spring(), y: spring(), z: spring(), mass, inertia: mass * length ** 2 / 3,
      // EI/L is angular stiffness; a frequency floor keeps the woody scaffold
      // stiff while the much lighter petiole retains its sharp, visible kick.
      stiffness: 3e9 * Math.PI * shoot.radius ** 4 / (4 * length), length,
      waterMass: 0, waterInertia: 0, load: new Vector3(), kick: new Vector3(),
      acceleration: new Vector3(), velocity: new Vector3(), originAcceleration: new Vector3(),
      matrix: new Matrix4(), rotation: new Quaternion(), worldRoot: shoot.root.clone() }
  })
  leaves.forEach(({ leaf, dryMass }, i) => {
    const center = leaf.position.clone().addScaledVector(leaf.direction, leaf.length * .52)
    for (let id = leafIndices[i]; id >= 0; id = branches[id].parent) {
      const branch = branches[id]
      branch.mass += dryMass
      branch.inertia += dryMass * Math.max(.02, center.distanceToSquared(branch.shoot.root))
    }
  })
  // Include child wood in each ancestor's effective inertia.
  for (let i = branches.length - 1; i >= 0; i--) {
    const branch = branches[i], wood = Math.PI * branch.shoot.radius ** 2 * branch.length * 450
    const center = branch.shoot.root.clone().lerp(branch.shoot.tip, .5)
    for (let id = branch.parent; id >= 0; id = branches[id].parent) {
      branches[id].mass += wood; branches[id].inertia += wood * center.distanceToSquared(branches[id].shoot.root)
    }
  }
  const height = Math.max(1, branches.length), data = new Float32Array(height * 16)
  const texture = new DataTexture(data, 4, height, RGBAFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  branches.forEach((branch, index) => branch.matrix.toArray(data, index * 16))
  texture.needsUpdate = true
  const arm = new Vector3(), torque = new Vector3(), impulse = new Vector3(), scratch = new Vector3()
  const qx = new Quaternion(), qy = new Quaternion(), qz = new Quaternion(), inverse = new Quaternion()
  const localMatrix = new Matrix4()
  function impact(index: number, point: Vector3, velocity: Vector3, mass: number, gain: number, stemStiffness = 1) {
    impulse.copy(velocity).multiplyScalar(mass * gain)
    for (let id = index; id >= 0; id = branches[id].parent) {
      const branch = branches[id], parent = branches[branch.parent]
      arm.subVectors(point, branch.worldRoot); torque.crossVectors(arm, impulse)
      if (parent) torque.applyQuaternion(inverse.copy(parent.rotation).invert())
      // A woody stem couples to more stationary wood at its base. The same
      // off-centre strike retains its full lever arm on the attached shoot.
      const anchoring = branch.parent < 0 ? Math.sqrt(stemStiffness) : 1
      const inertia = Math.max(.00001, branch.inertia + branch.waterInertia) * anchoring
      const limit = branch.parent < 0 ? .65 / anchoring : 2
      for (const axis of axes) {
        const before = branch[axis].velocity
        branch[axis].velocity = Math.max(-limit, Math.min(limit, before + torque[axis] / inertia))
        branch.kick[axis] += branch[axis].velocity - before
      }
    }
  }
  function clearLoads() {
    for (const branch of branches) { branch.waterMass = branch.waterInertia = 0; branch.load.set(0, 0, 0) }
  }
  function load(index: number, point: Vector3, mass: number) {
    for (let id = index; id >= 0; id = branches[id].parent) {
      const branch = branches[id], parent = branches[branch.parent]
      arm.subVectors(point, branch.worldRoot)
      branch.waterMass += mass; branch.waterInertia += mass * arm.lengthSq()
      torque.crossVectors(arm, scratch.set(0, -mass * water.gravity, 0))
      if (parent) torque.applyQuaternion(inverse.copy(parent.rotation).invert())
      branch.load.add(torque)
    }
  }
  function step(dt: number, settings: RainSettings) {
    if (dt <= 0) return
    for (let index = 0; index < branches.length; index++) {
      const branch = branches[index]
      const inertia = Math.max(.00001, branch.inertia + branch.waterInertia)
      const main = branch.parent < 0
      const support = main ? settings.rainMainBranchStiffness : settings.rainBranchStiffness
      const frequency = main ? 3.5 : 3.8
      const stiffness = Math.max(branch.stiffness, inertia * (Math.PI * 2 * frequency) ** 2)
        * support / Math.sqrt(settings.rainFlexibility)
      for (const axis of axes) {
        const previous = branch[axis].velocity
        const limit = (main ? .055 / Math.sqrt(support) : .2) * (branch.plant.paneGap && axis !== 'z' ? .35 : 1)
        const spring = branch[axis], omega2 = stiffness * (axis === 'y' ? 1.6 : 1) / inertia
        // Implicit spring/damper integration stays bounded even for short,
        // thick stems at the stiffest setting.
        spring.velocity = (previous + dt * (branch.load[axis] / inertia - omega2 * spring.position))
          / (1 + dt * Math.sqrt(omega2) * (main ? 1.6 : .82) + dt * dt * omega2)
        spring.position = Math.max(-limit, Math.min(limit, spring.position + dt * spring.velocity))
        if (Math.abs(spring.position) === limit && spring.position * spring.velocity > 0) spring.velocity = 0
        branch.acceleration[axis] = (branch[axis].velocity - previous + branch.kick[axis]) / dt
        branch.velocity[axis] = branch[axis].velocity
      }
      branch.kick.set(0, 0, 0)
      qx.setFromAxisAngle(xAxis, branch.x.position); qy.setFromAxisAngle(yAxis, branch.y.position); qz.setFromAxisAngle(zAxis, branch.z.position)
      branch.rotation.copy(qx).multiply(qy).multiply(qz)
      localMatrix.makeRotationFromQuaternion(branch.rotation)
      // T(pivot) R T(-pivot): a branch attachment stays attached under rotation.
      scratch.copy(branch.shoot.root).applyMatrix4(localMatrix).negate().add(branch.shoot.root)
      localMatrix.setPosition(scratch)
      const parent = branches[branch.parent]
      if (parent) {
        branch.matrix.multiplyMatrices(parent.matrix, localMatrix)
        branch.rotation.premultiply(parent.rotation)
        branch.worldRoot.copy(branch.shoot.root).applyMatrix4(parent.matrix)
        arm.subVectors(branch.worldRoot, parent.worldRoot)
        branch.originAcceleration.crossVectors(parent.acceleration, arm).add(parent.originAcceleration)
        scratch.crossVectors(parent.velocity, arm)
        branch.originAcceleration.add(torque.crossVectors(parent.velocity, scratch))
        branch.acceleration.applyQuaternion(parent.rotation).add(parent.acceleration)
        branch.velocity.applyQuaternion(parent.rotation).add(parent.velocity)
      } else {
        branch.matrix.copy(localMatrix); branch.worldRoot.copy(branch.shoot.root); branch.originAcceleration.set(0, 0, 0)
      }
      branch.matrix.toArray(data, index * 16)
    }
    texture.needsUpdate = true
  }
  return { branches, leafIndices, texture, indexOf, impact, clearLoads, load, step, dispose: () => texture.dispose() }
}

export const rainBranchGLSL = /* glsl */`
attribute float rainPlant;
uniform sampler2D uRainBranches;
uniform float uRainBranchCount;
mat4 greenhouseRainBone() {
  float row = (rainPlant + .5) / uRainBranchCount;
  return mat4(texture2D(uRainBranches, vec2(.125, row)), texture2D(uRainBranches, vec2(.375, row)),
    texture2D(uRainBranches, vec2(.625, row)), texture2D(uRainBranches, vec2(.875, row)));
}
vec3 greenhouseRainBranch(vec3 p) { return (greenhouseRainBone() * vec4(p, 1.)).xyz - p; }
vec3 greenhouseRainBranchNormal(vec3 p, vec3 n) { return normalize(mat3(greenhouseRainBone()) * n); }
`
