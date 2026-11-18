import { stormBudget } from './budget'

const capacities = [stormBudget.spray, stormBudget.beads, stormBudget.rings, stormBudget.trails]

export class StormPopulation {
  private births = [0, 0, 0, 0]
  private observedBirths = [0, 0, 0, 0]
  private observedLive = [0, 0, 0, 0]
  private observedFrame = 0
  frame = 0

  bound(kind: number) {
    return Math.min(capacities[kind], this.observedLive[kind] + this.births[kind] - this.observedBirths[kind])
  }

  advance(drips: number, contacts: number, formBeads: boolean) {
    this.frame++
    this.births[3] += this.bound(1)
    this.births[0] += drips
    this.births[1] += formBeads ? contacts : 0
    this.births[2] += contacts
  }

  snapshot() { return { frame: this.frame, births: this.births.slice() } }

  observe(snapshot: ReturnType<StormPopulation['snapshot']>, live: Uint32Array) {
    if (snapshot.frame <= this.observedFrame) return
    this.observedFrame = snapshot.frame
    this.observedBirths = snapshot.births
    for (let kind = 0; kind < capacities.length; kind++) this.observedLive[kind] = live[kind]
  }
}
