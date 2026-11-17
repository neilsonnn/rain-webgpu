import { matchLocalBuildings } from './matching'
import type { MatchInput } from './matching'

self.onmessage = (event: MessageEvent<MatchInput>) => {
  try {
    const result = matchLocalBuildings(event.data)
    self.postMessage({ result }, { transfer: [result.origins.buffer, result.occupied.buffer, result.tileForBuilding.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Local tile matching failed' })
  }
}
