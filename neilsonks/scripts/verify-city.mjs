// Nonvisual verification of every bundled tile, including the full city.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import polygonClipping from 'polygon-clipping'
const polygonArea = ring => Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
const meta = JSON.parse(readFileSync('public/data/city/manifest.json', 'utf8'))
for (const [file, entry] of [['sf', 'full'], ['downtown', 'downtown'], ['market', 'market']]) {
  const compressed = readFileSync(`public/data/city/${file}.bin.gz`), bytes = gunzipSync(compressed)
  const header = new Uint32Array(bytes.buffer, bytes.byteOffset, 8), [, vertices, indexCount, count, side] = header
  assert.equal(header[0], 0x53464332); assert.equal(count, side * side); assert.equal(count, meta[entry].cells)
  assert.equal(compressed.byteLength, meta[entry].downloadBytes)
  const info = new Float32Array(bytes.buffer, bytes.byteOffset + 32, count * 16), offset = 32 + count * 64
  const v = new Uint16Array(bytes.buffer, bytes.byteOffset + offset, vertices * 5)
  const ids = new Uint32Array(bytes.buffer, bytes.byteOffset + offset + vertices * 10, vertices)
  const index = new Uint32Array(bytes.buffer, bytes.byteOffset + offset + vertices * 14, indexCount)
  assert.equal(bytes.byteLength, offset + vertices * 14 + indexCount * 4)
  let buildings = 0
  for (let i = 0; i < count; i++) {
    const b = i * 16
    assert(info[b + 4] <= info[b + 5] && info[b + 6] <= info[b + 7], `Reversed partition ${i}`)
    assert(info[b + 11] > 0 && info[b + 11] <= 1, `Invalid fit ${i}`)
    if (info[b + 13] > .5) buildings++
  }
  assert.equal(buildings, meta[entry].buildings)
  if (entry === 'market') {
    assert.equal(side, 16); assert.equal(buildings, count, 'Market study must have no empty padding cells')
    let travel = 0
    for (let i = 0; i < count; i++) {
      const b = i * 16, step = info[b + 14]
      travel += (info[b] + step / 2 - info[b + 8]) ** 2 + (info[b + 1] + step / 2 - info[b + 9]) ** 2
    }
    assert(Math.abs(travel - meta.market.mapping.squaredTravel) < .01, 'Assignment travel differs from bundled geometry')
    assert(travel <= meta.market.mapping.baselineSquaredTravel, 'Assignment must improve on the original parcel order')
  }
  const area = new Float64Array(count)
  for (let i = 0; i < indexCount; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2]
    assert(a < vertices && b < vertices && c < vertices, 'Index out of bounds')
    assert(ids[a] === ids[b] && ids[b] === ids[c] && ids[a] < count, 'Triangle crosses tile IDs')
    if (v[a * 5 + 1] === 0 || v[b * 5 + 1] === 0 || v[c * 5 + 1] === 0) continue
    area[ids[a]] += Math.abs((v[b * 5 + 3] - v[a * 5 + 3]) * (v[c * 5 + 4] - v[a * 5 + 4]) - (v[b * 5 + 4] - v[a * 5 + 4]) * (v[c * 5 + 3] - v[a * 5 + 3])) / (2 * 65535 ** 2)
  }
  // Survey degeneracies can leave overlapping roof triangles. Check their
  // union instead of mistaking doubled area for a missing source square.
  const unusual = new Set(Array.from(area, (a, i) => Math.abs(a - 1) > 1e-4 ? i : -1).filter(i => i >= 0)), triangles = new Map([...unusual].map(i => [i, []]))
  if (unusual.size) for (let i = 0; i < indexCount; i += 3) {
    const tri = [index[i], index[i + 1], index[i + 2]], id = ids[tri[0]]
    if (!unusual.has(id) || tri.some(i => v[i * 5 + 1] === 0)) continue
    const ring = tri.map(i => [v[i * 5 + 3] / 65535, v[i * 5 + 4] / 65535])
    if (polygonArea(ring) > 1e-12) triangles.get(id).push([ring])
  }
  for (const [id, tris] of triangles) {
    const union = polygonClipping.union(...tris)
    const covered = union.reduce((sum, polygon) => sum + polygonArea(polygon[0]) - polygon.slice(1).reduce((sum, hole) => sum + polygonArea(hole), 0), 0)
    assert(Math.abs(covered - 1) < 1e-4, `Source square ${id} is incomplete: ${covered}`)
  }
  console.log(`Verified ${file}: ${buildings.toLocaleString()} buildings, all ${count.toLocaleString()} starting squares, partition bounds, indexed geometry and asset manifest.`)
}
