export interface LocalMatchStats {
  buildings: number; matched: number; unusedTiles: number; unmatched: number
  meanTravelMeters: number; p95TravelMeters: number; maxTravelMeters: number; limitMeters: number
}
export interface LocalMapping {
  origins: Float32Array; occupied: Uint8Array; tileForBuilding: Int32Array
  side: number; textureSize: [number, number]; stats: LocalMatchStats
}

// Density is the total number of grid tiles per survey building, not a
// permission for a tile to split. Round up to a complete square board.
export function gridSideForDensity(buildings: number, density: number) {
  if (!Number.isInteger(buildings) || buildings < 1 || !Number.isFinite(density) || density < .25 || density > 8) throw new Error('Invalid grid density')
  return Math.ceil(Math.sqrt(buildings * density))
}
export interface MatchInput {
  // x, z, valid flag for every geometry record, including old padding records.
  centers: Float32Array; side: number; bounds: [number, number, number, number]; radius: number
}

export function matchLocalBuildings({ centers, side, bounds, radius }: MatchInput): LocalMapping {
  if (!Number.isInteger(side) || side < 1 || !Number.isFinite(radius) || radius <= 0 || radius > 8) throw new Error('Invalid local matching parameters')
  const count = centers.length / 3, cells = side * side, step = (bounds[1] - bounds[0]) / side
  if (!Number.isInteger(count) || !(step > 0)) throw new Error('Invalid matching geometry')
  const radius2 = radius * radius, offsets = new Uint32Array(count + 1)
  // Sparse, exact spatial neighbourhoods. Never construct a city-wide N² cost
  // matrix, and never permit an edge beyond the user's travel limit.
  const visit = (i: number, fn: (cell: number, cost: number) => void) => {
    if (centers[i * 3 + 2] < .5) return
    const x = (centers[i * 3] - bounds[0]) / step - .5, z = (centers[i * 3 + 1] - bounds[2]) / step - .5
    for (let gz = Math.max(0, Math.ceil(z - radius)); gz <= Math.min(side - 1, Math.floor(z + radius)); gz++) {
      for (let gx = Math.max(0, Math.ceil(x - radius)); gx <= Math.min(side - 1, Math.floor(x + radius)); gx++) {
        const d2 = (gx - x) ** 2 + (gz - z) ** 2
        if (d2 <= radius2) fn(gz * side + gx, d2)
      }
    }
  }
  let edges = 0, buildings = 0
  for (let i = 0; i < count; i++) {
    offsets[i] = edges
    if (centers[i * 3 + 2] > .5) buildings++
    visit(i, () => edges++)
  }
  offsets[count] = edges
  const candidates = new Uint32Array(edges), costs = new Float32Array(edges)
  for (let i = 0; i < count; i++) {
    let at = offsets[i]
    visit(i, (cell, cost) => { candidates[at] = cell; costs[at++] = cost })
  }
  // Auction with an always-available private "emerge in place" alternative.
  // Competing buildings bid for nearby tiles; displaced bidders reconsider all
  // their local choices. Prices prevent greedy early assignments monopolizing
  // a useful tile. Epsilon is in squared tile widths (approximate min-cost).
  const epsilon = .01, reward = radius2 + 1
  const prices = new Float64Array(cells), owner = new Int32Array(cells).fill(-1)
  const assignment = new Int32Array(count).fill(-1), queue = new Int32Array(count + 1)
  let head = 0, tail = 0
  for (let i = 0; i < count; i++) if (centers[i * 3 + 2] > .5) queue[tail++] = i
  while (head !== tail) {
    const i = queue[head]; head = (head + 1) % queue.length
    let best = 0, second = 0, cell = -1
    for (let edge = offsets[i]; edge < offsets[i + 1]; edge++) {
      const candidate = candidates[edge], value = reward - costs[edge] - prices[candidate]
      if (value > best) { second = best; best = value; cell = candidate } else if (value > second) second = value
    }
    if (cell < 0) continue
    prices[cell] += best - second + epsilon
    const previous = owner[cell]
    owner[cell] = i; assignment[i] = cell
    if (previous >= 0) { assignment[previous] = -1; queue[tail] = previous; tail = (tail + 1) % queue.length }
  }
  const width = Math.min(2048, Math.max(count, cells)), height = Math.ceil(Math.max(count, cells) / width)
  const origins = new Float32Array(width * height * 4), occupied = new Uint8Array(width * height), distances: number[] = []
  for (let i = 0; i < count; i++) {
    const cell = assignment[i], x = centers[i * 3], z = centers[i * 3 + 1]
    const gx = cell < 0 ? Math.max(0, Math.min(side - 1, Math.floor((x - bounds[0]) / step))) : cell % side
    const gz = cell < 0 ? Math.max(0, Math.min(side - 1, Math.floor((z - bounds[2]) / step))) : Math.floor(cell / side)
    origins.set(cell < 0 ? [x, z, 0, (gx + gz) % 2] : [bounds[0] + gx * step, bounds[2] + gz * step, step, (gx + gz) % 2], i * 4)
    if (cell >= 0) {
      occupied[cell] = 255
      distances.push(Math.hypot(bounds[0] + (gx + .5) * step - x, bounds[2] + (gz + .5) * step - z) * 100)
    }
  }
  distances.sort((a, b) => a - b)
  return { origins, occupied, tileForBuilding: assignment, side, textureSize: [width, height], stats: {
    buildings, matched: distances.length, unusedTiles: cells - distances.length, unmatched: buildings - distances.length,
    meanTravelMeters: distances.reduce((a, b) => a + b, 0) / (distances.length || 1),
    p95TravelMeters: distances[Math.max(0, Math.ceil(distances.length * .95) - 1)] ?? 0,
    maxTravelMeters: distances.at(-1) ?? 0, limitMeters: radius * step * 100,
  } }
}
