import { Vector3 } from 'three'
import { random } from './settings'
import type { Planting } from './arrangements'
import type { Leaf, Stem } from './foliage'
import type { RainShoot } from '../rain/branches'

// Authored forms share the Earlier blade shapes, with irregular internodes and
// curved lateral sprays. Each blade keeps the very same endpoint as its petiole.
export function growBreezePlant(planting: Planting, root: Vector3) {
  const rng = random(planting.seed), leaves: Leaf[] = [], stems: Stem[] = []
  const sparse = planting.form === 'spray', sign = Math.sign(planting.height)
  const shoot = (base: Vector3, height: number, lean: Vector3, level: number, parent?: RainShoot) => {
    const count = level ? (sparse ? 6 : 9) : (sparse ? 11 : 16)
    const phase = rng() * Math.PI * 2, points: Vector3[] = [base]
    const weights = Array.from({ length: count }, () => .65 + rng() * .7), total = weights.reduce((a, b) => a + b, 0)
    let travel = 0
    for (let i = 1; i <= count; i++) {
      travel += weights[i - 1]
      const t = travel / total, bow = Math.sin(Math.PI * t)
      points.push(base.clone().add(new Vector3(
        lean.x * t + Math.sin(t * 3.4 + phase) * bow * .07,
        height * t - bow * Math.abs(lean.x) * .16,
        lean.z * t + Math.sin(t * 4.3 + phase * .7) * bow * .08,
      )))
    }
    const branch: RainShoot = { root: base, tip: points[count], radius: level ? .0023 : .0048, plant: 0, parent }
    stems.push({ points, radius: branch.radius, plant: 0, shoot: branch })
    for (let i = 1; i <= count; i++) {
      const t = i / count, p = points[i], phi = phase + i * 2.39996
      // A few long, bare internodes give the left plant breathing room.
      const leafHere = t >= (level ? .18 : sparse ? .31 : .13) && rng() > (sparse ? .26 : .07)
      if (leafHere) {
        const hanging = rng() < .33
        const direction = new Vector3(Math.cos(phi) * (.65 + rng() * .35),
          hanging ? -.18 - rng() * .4 : .18 + rng() * .6, Math.sin(phi) * (.4 + rng() * .45)).normalize()
        const reach = .045 + rng() * .085
        const end = p.clone().addScaledVector(direction, reach).add(new Vector3(0, .025, 0))
        stems.push({ points: [p, p.clone().lerp(end, .5).add(new Vector3(0, .018, 0)), end], radius: .00125, plant: 0, shoot: branch })
        leaves.push({ position: end, direction,
          length: (.21 + rng() * .13) * (1 - .18 * t) * (level ? .9 : 1) * (planting.leafScale ?? 1),
          width: .8 + rng() * .48, twist: (rng() - .5) * 2.8,
          phase: rng() * Math.PI * 2, age: rng(), species: rng() < .24 ? 2 : planting.species, plant: 0, shoot: branch })
      }
      const fork = sparse ? i === 5 || i === 9 : i === 4 || i === 8 || i === 12 || i === 14
      if (!level && fork) {
        const side = i % 3 === 0 ? -1 : 1
        const branchLean = new Vector3(side * planting.spread * (.65 + rng() * .35), 0, (rng() - .55) * planting.spread * .75)
        shoot(p, sign * Math.abs(planting.height) * (.18 + rng() * .17), branchLean, 1, branch)
      }
    }
  }
  shoot(root, planting.height, new Vector3(planting.lean?.[0] ?? 0, 0, planting.lean?.[1] ?? 0), 0)
  return { leaves, stems }
}
