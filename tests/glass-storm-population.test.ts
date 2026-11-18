import { expect, it } from 'vitest'
import { StormPopulation } from '../src/glass/rain/storm/population'
import { stormBudget as b } from '../src/glass/rain/storm/budget'

it('preserves births and possible new trails during delayed and out-of-order GPU feedback', () => {
  const p = new StormPopulation(), bounds = () => [0,1,2,3].map(k => p.bound(k))
  p.advance(2, 4, true)
  const first = p.snapshot()
  expect(bounds()).toEqual([2,4,4,0])
  p.advance(1, 5, false)
  const second = p.snapshot()
  p.advance(0, 3, true)
  p.observe(second, new Uint32Array([1,2,5,1]))
  expect(bounds()).toEqual([1,5,8,5])
  p.observe(first, new Uint32Array(4))
  expect(bounds()).toEqual([1,5,8,5])
  p.observe(p.snapshot(), new Uint32Array(4))
  expect(bounds()).toEqual([0,0,0,0])
})

it('allows every pool to reach capacity even before a GPU readback', () => {
  const p = new StormPopulation()
  for (let i = 0; i < 6; i++) p.advance(b.spray, b.rings, true)
  expect([0,1,2,3].map(k => p.bound(k))).toEqual([b.spray,b.beads,b.rings,b.trails])
})
