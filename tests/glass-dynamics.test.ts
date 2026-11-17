import { describe, expect, it } from 'vitest'
import { InstancedBufferAttribute, Vector3 } from 'three'
import { createPlantDynamics, motionLimits, stepSpring } from '../src/glass/dynamics'
import type { BladeBinding } from '../src/glass/dynamics'

function fixture(windScale = 1) {
  const attribute = new InstancedBufferAttribute(new Float32Array(4), 2)
  const bindings: BladeBinding[] = [0, 1].map(index => ({ plant: 0, position: new Vector3(.5, 1.5 + index * .3, -.4),
    length: .24 + index * .09, width: .9, age: .3 + index * .5, species: 0, phase: index * 1.8,
    normal: new Vector3(.7, 0, .7).normalize(), pitchNormal: new Vector3(0, -1, 0), torsionNormal: new Vector3(.7, 0, -.7).normalize(),
    attribute, index }))
  return { ...createPlantDynamics([{ root: new Vector3(.5, 0, -.6), height: 2.3, radius: .0042, species: 0 }], bindings, windScale), attribute }
}

describe('damped greenhouse plant motion', () => {
  it('dissipates spring energy after a gust without snapping back to the rest pose', () => {
    const spring = { position: .08, velocity: 0 }
    stepSpring(spring, 0, 1, .02, .65, 1 / 120, .18)
    expect(spring.position).toBeGreaterThan(0)
    expect(spring.velocity).toBeLessThan(0)
    for (let i = 0; i < 1200; i++) stepSpring(spring, 0, 1, .02, .65, 1 / 120, .18)
    expect(Math.abs(spring.position)).toBeLessThan(1e-8)
    expect(Math.abs(spring.velocity)).toBeLessThan(1e-8)
  })
  it('uses the same fixed-step trajectory at 60 and 120 Hz', () => {
    const sixty = fixture(), oneTwenty = fixture()
    for (let i = 0; i < 60; i++) sixty.advance(1 / 60, 1)
    for (let i = 0; i < 120; i++) oneTwenty.advance(1 / 120, 1)
    expect(sixty.branches[0].x.position).toBeCloseTo(oneTwenty.branches[0].x.position, 10)
    sixty.blades.forEach((blade, i) => expect(blade.pitch.position).toBeCloseTo(oneTwenty.blades[i].pitch.position, 10))
  })
  it('responds to wind with bounded branch lag and independent blade inertia, then settles in still air', () => {
    const dynamics = fixture()
    for (let i = 0; i < 600; i++) dynamics.advance(1 / 60, 1.5)
    expect(Math.abs(dynamics.branches[0].x.position)).toBeGreaterThan(1e-5)
    expect(dynamics.blades[0].pitch.position).not.toBeCloseTo(dynamics.blades[1].pitch.position, 6)
    for (const branch of dynamics.branches) {
      expect(Math.abs(branch.x.position)).toBeLessThanOrEqual(motionLimits.branch)
      expect(Math.abs(branch.z.position)).toBeLessThanOrEqual(motionLimits.branchDepth)
    }
    for (const blade of dynamics.blades) {
      expect(Number.isFinite(blade.pitch.velocity)).toBe(true)
      expect(Math.abs(blade.pitch.position)).toBeLessThanOrEqual(motionLimits.pitch)
      expect(Math.abs(blade.torsion.position)).toBeLessThanOrEqual(motionLimits.torsion)
    }
    const moving = Math.abs(dynamics.branches[0].x.position)
    for (let i = 0; i < 1800; i++) dynamics.advance(1 / 60, 0)
    expect(Math.abs(dynamics.branches[0].x.position)).toBeLessThan(moving * .001)
    expect(Math.abs(dynamics.blades[0].pitch.position)).toBeLessThan(1e-5)
  })
  it('freezes branch, leaf and GPU attribute state when paused', () => {
    const dynamics = fixture()
    dynamics.advance(1 / 30, 1)
    const branch = { ...dynamics.branches[0].x }, leaf = { ...dynamics.blades[0].pitch }, version = dynamics.attribute.version
    dynamics.advance(0, 1.5)
    expect(dynamics.branches[0].x).toEqual(branch)
    expect(dynamics.blades[0].pitch).toEqual(leaf)
    expect(dynamics.attribute.version).toBe(version)
  })
  it('uses positive physical length and mass for hanging shoots while keeping their downward direction', () => {
    const dynamics = createPlantDynamics([{ root: new Vector3(-.7, 3.65, -.4), height: -1.3, radius: .0052, species: 0 }], [])
    for (let i = 0; i < 600; i++) dynamics.advance(1 / 60, 1.5)
    const branch = dynamics.branches[0]
    expect(branch.stiffness).toBeGreaterThan(0)
    expect(branch.mass).toBeGreaterThan(0)
    expect(dynamics.roots[0].w).toBe(-1.3)
    expect(Number.isFinite(branch.x.position)).toBe(true)
    expect(Math.abs(branch.x.position)).toBeLessThanOrEqual(motionLimits.branch)
    expect(Math.abs(branch.z.position)).toBeLessThanOrEqual(motionLimits.branchDepth)
  })
  it('makes the left-hand wind calibration visible while Breeze zero still leaves the simulation at rest', () => {
    const ordinary = fixture(), stronger = fixture(3.2), calm = fixture(3.2)
    let ordinaryMotion = 0, strongerMotion = 0
    for (let i = 0; i < 300; i++) {
      ordinary.advance(1 / 60, .65); stronger.advance(1 / 60, .65); calm.advance(1 / 60, 0)
      ordinaryMotion += ordinary.blades.reduce((sum, blade) => sum + blade.pitch.position ** 2, 0)
      strongerMotion += stronger.blades.reduce((sum, blade) => sum + blade.pitch.position ** 2, 0)
    }
    expect(strongerMotion).toBeGreaterThan(ordinaryMotion * 2)
    expect(calm.branches[0].x.position).toBe(0)
    expect(calm.blades.every(blade => blade.pitch.position === 0 && blade.torsion.position === 0)).toBe(true)
  })
})
