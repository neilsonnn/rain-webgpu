// Usage: node scripts/prepare-city.mjs <DataSF building JSON> <shoreline GeoJSON>
// Downloads stay outside the repository; only compact public geometry is shipped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { ShapeUtils, Vector2 } from 'three'
import polygonClipping from 'polygon-clipping'

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const shore = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const out = 'public/data/city'
const marketOnly = process.argv.includes('--market-only')
mkdirSync(out, { recursive: true })
const project = ([lon, lat]) => [(lon + 122.435) * 88000 * .01, (37.768 - lat) * 111320 * .01]
const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1] }, 0) / 2
function simplify(ring, tolerance = .008) {
  // Remove only near-collinear vertices (0.8 m); retain concave corners.
  let points = ring.slice(0, -1).map(project)
  for (let pass = 0; pass < 2; pass++) {
    const kept = points.filter((b, i) => {
      const a = points[(i + points.length - 1) % points.length], c = points[(i + 1) % points.length]
      const dx = c[0] - a[0], dz = c[1] - a[1], t = Math.max(0, Math.min(1, ((b[0] - a[0]) * dx + (b[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)))
      return Math.hypot(b[0] - a[0] - t * dx, b[1] - a[1] - t * dz) > tolerance
    })
    if (kept.length >= 3) points = kept
  }
  if (area(points) < 0) points.reverse()
  return points
}
const records = []
let ignored = 0, multipart = 0, holes = 0
for (const row of raw) {
  const polygons = row.shape?.coordinates
  if (!polygons?.length) { ignored++; continue }
  const rings = polygons.map(p => simplify(p[0])).filter(r => r.length >= 3 && Math.abs(area(r)) > .000002)
  if (!rings.length) { ignored++; continue }
  multipart += rings.length - 1; holes += polygons.reduce((n, p) => n + p.length - 1, 0)
  // One tile per source building, including all its exterior components.
  const points = rings.flat(), xs = points.map(p => p[0]), zs = points.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const ground = Math.max(0, Math.min(320, Number(row.gnd_min_m) || 0)) * .01
  const measured = Number(row.hgt_median_m)
  records.push({ rings, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, minX, maxX, minZ, maxZ, ground, height: Math.max(.015, Math.min(350, measured || 1.5) * .01), fallback: !measured })
}
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
for (const r of records) { minX = Math.min(minX, r.minX); maxX = Math.max(maxX, r.maxX); minZ = Math.min(minZ, r.minZ); maxZ = Math.max(maxZ, r.maxZ) }
const bounds = [minX, maxX, minZ, maxZ]
const groundSize = 192, sums = new Float64Array(groundSize ** 2), counts = new Uint32Array(groundSize ** 2)
for (const r of records) {
  const x = Math.max(0, Math.min(groundSize - 1, Math.round((r.x - minX) / (maxX - minX) * (groundSize - 1))))
  const z = Math.max(0, Math.min(groundSize - 1, Math.round((r.z - minZ) / (maxZ - minZ) * (groundSize - 1))))
  sums[z * groundSize + x] += r.ground; counts[z * groundSize + x]++
}
let ground = Float32Array.from(sums, (sum, i) => counts[i] ? sum / counts[i] : -1)
for (let pass = 0; pass < groundSize; pass++) {
  const next = ground.slice(); let missing = 0
  for (let z = 0; z < groundSize; z++) for (let x = 0; x < groundSize; x++) {
    const i = z * groundSize + x
    if (ground[i] >= 0) continue
    let sum = 0, n = 0
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz
      if (xx >= 0 && xx < groundSize && zz >= 0 && zz < groundSize && ground[zz * groundSize + xx] >= 0) { sum += ground[zz * groundSize + xx]; n++ }
    }
    if (n) next[i] = sum / n; else missing++
  }
  ground = next; if (!missing) break
}
for (let pass = 0; pass < 3; pass++) {
  const next = ground.slice()
  for (let z = 1; z < groundSize - 1; z++) for (let x = 1; x < groundSize - 1; x++) {
    const i = z * groundSize + x
    next[i] = (ground[i] * 4 + ground[i - 1] + ground[i + 1] + ground[i - groundSize] + ground[i + groundSize]) / 8
  }
  ground = next
}
const coast = shore.features.flatMap(f => {
  const g = f.geometry
  if (!g) return []
  return g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0].map(project)) : g.type === 'Polygon' ? [g.coordinates[0].map(project)] : []
}).filter(r => r.some(p => p[0] > minX && p[0] < maxX && p[1] > minZ && p[1] < maxZ))
// Rasterize the shoreline offline so the browser never scans thousands of
// coastline edges while preparing the terrain mesh.
const landMask = new Uint8Array((groundSize - 1) ** 2)
for (let z = 0; z < groundSize - 1; z++) {
  const zz = minZ + (maxZ - minZ) * (z + .5) / (groundSize - 1)
  for (const ring of coast) {
    const cuts = []
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j]
      if ((a[1] > zz) !== (b[1] > zz)) cuts.push(a[0] + (b[0] - a[0]) * (zz - a[1]) / (b[1] - a[1]))
    }
    cuts.sort((a, b) => a - b)
    for (let k = 0; k + 1 < cuts.length; k += 2) for (let x = 0; x < groundSize - 1; x++) {
      const xx = minX + (maxX - minX) * (x + .5) / (groundSize - 1)
      if (xx >= cuts[k] && xx <= cuts[k + 1]) landMask[z * (groundSize - 1) + x] = 1
    }
  }
}
writeFileSync(`${out}/terrain.json`, JSON.stringify({ size: groundSize, bounds, heights: Array.from(ground, x => Math.round(Math.max(0, x) * 1000) / 1000), landMask: Array.from(landMask) }))

const squareUV = t => t < .25 ? [t * 4, 0] : t < .5 ? [1, (t - .25) * 4] : t < .75 ? [1 - (t - .5) * 4, 1] : [0, 1 - (t - .75) * 4]
function alignRing(ring) {
  // Pick a perimeter origin that matches the square's world-space corners.
  // Survey ring start points are arbitrary; preserving them twists rectangles.
  const xmin = Math.min(...ring.map(p => p[0])), xmax = Math.max(...ring.map(p => p[0]))
  const zmin = Math.min(...ring.map(p => p[1])), zmax = Math.max(...ring.map(p => p[1]))
  const lengths = ring.map((p, i) => Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]))
  const total = lengths.reduce((a, b) => a + b, 0)
  let best = 0, bestCost = Infinity
  for (let k = 0; k < ring.length; k++) {
    let at = 0, cost = 0
    for (let j = 0; j < ring.length; j++) {
      const i = (k + j) % ring.length, p = ring[i], q = ring[(i + 1) % ring.length]
      for (const f of [0, .5]) {
        const uv = squareUV((at + lengths[i] * f) / total)
        const x = (p[0] + (q[0] - p[0]) * f - xmin) / Math.max(.00001, xmax - xmin)
        const z = (p[1] + (q[1] - p[1]) * f - zmin) / Math.max(.00001, zmax - zmin)
        cost += lengths[i] * ((uv[0] - x) ** 2 + (uv[1] - z) ** 2)
      }
      at += lengths[i]
    }
    if (cost < bestCost) { bestCost = cost; best = k }
  }
  return [...ring.slice(best), ...ring.slice(0, best)]
}
function minimumTravelAssignment(costs, n) {
  // Hungarian assignment: a bijection minimizing total squared centre travel.
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    const min = new Float64Array(n + 1).fill(Infinity), used = new Uint8Array(n + 1)
    let j0 = 0
    do {
      used[j0] = 1
      const i0 = p[j0]; let delta = Infinity, j1 = 0
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cost = costs[(i0 - 1) * n + j - 1] - u[i0] - v[j]
        if (cost < min[j]) { min[j] = cost; way[j] = j0 }
        if (min[j] < delta) { delta = min[j]; j1 = j }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta } else min[j] -= delta
      j0 = j1
    } while (p[j0])
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }
  const assignment = new Int32Array(n)
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1
  return assignment
}
function build(name, selection, { direct = false } = {}) {
  const side = Math.ceil(Math.sqrt(selection.length)), list = [...selection]
  // Each study has its own starting board and partition extent. Downtown must
  // not inherit the full city's empty margins or translate across the city.
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const r of selection) { left = Math.min(left, r.minX); right = Math.max(right, r.maxX); top = Math.min(top, r.minZ); bottom = Math.max(bottom, r.maxZ) }
  const region = [left, right, top, bottom]
  const sourceSize = Math.max(right - left, bottom - top), step = sourceSize / side
  const cx = (left + right) / 2, cz = (top + bottom) / 2
  // Padding cells are real blank squares at t=0 and vanish during the morph.
  for (let i = list.length; i < side * side; i++) list.push({ x: left + (i % side) / side * (right - left), z: bottom - .00001 * (i % 71), rings: [], ground: 0, height: 0 })
  const info = new Float32Array(list.length * 16)
  const assigned = new Array(list.length)
  function partition(items, gx, gz, w, h, rect) {
    if (items.length === 1) {
      const r = items[0], id = gz * side + gx
      const halfX = Math.max(.00001, Math.max(Math.abs((r.minX ?? r.x) - r.x), Math.abs((r.maxX ?? r.x) - r.x)))
      const halfZ = Math.max(.00001, Math.max(Math.abs((r.minZ ?? r.z) - r.z), Math.abs((r.maxZ ?? r.z) - r.z)))
      const safe = Math.max(.00001, Math.min(1, (r.x - rect[0]) / halfX, (rect[1] - r.x) / halfX, (r.z - rect[2]) / halfZ, (rect[3] - r.z) / halfZ) * .94)
      info.set([cx - sourceSize / 2 + gx * step, cz - sourceSize / 2 + gz * step, (gx + gz) % 2, r.height, ...rect, r.x, r.z, r.ground, safe, Math.hypot((r.x - cx) / sourceSize, (r.z - cz) / sourceSize), r.rings.length ? 1 : 0, step, 0], id * 16)
      assigned[id] = r; return
    }
    const axis = w >= h && w > 1 ? 0 : 1, split = Math.floor((axis === 0 ? w : h) / 2)
    const n = axis === 0 ? split * h : split * w
    items.sort((a, b) => axis === 0 ? a.x - b.x || a.z - b.z : a.z - b.z || a.x - b.x)
    const cut = axis === 0 ? (items[n - 1].x + items[n].x) / 2 : (items[n - 1].z + items[n].z) / 2
    const a = [...rect], b = [...rect]
    a[axis === 0 ? 1 : 3] = cut; b[axis === 0 ? 0 : 2] = cut
    partition(items.slice(0, n), gx, gz, axis === 0 ? split : w, axis === 1 ? split : h, a)
    partition(items.slice(n), gx + (axis === 0 ? split : 0), gz + (axis === 1 ? split : 0), axis === 0 ? w - split : w, axis === 1 ? h - split : h, b)
  }
  partition(list, 0, 0, side, side, region)
  let mapping
  if (direct) {
    const n = assigned.length, costs = new Float64Array(n * n), previous = [...assigned], previousInfo = info.slice()
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      costs[i * n + j] = (info[i * 16] + step / 2 - previous[j].x) ** 2 + (info[i * 16 + 1] + step / 2 - previous[j].z) ** 2
    }
    const assignment = minimumTravelAssignment(costs, n)
    let before = 0, after = 0
    for (let i = 0; i < n; i++) {
      const j = assignment[i]
      before += costs[i * n + i]; after += costs[i * n + j]
      assigned[i] = previous[j]
      info.set(previousInfo.subarray(j * 16, j * 16 + 16), i * 16)
      info[i * 16] = previousInfo[i * 16]; info[i * 16 + 1] = previousInfo[i * 16 + 1]; info[i * 16 + 2] = previousInfo[i * 16 + 2]
    }
    mapping = { method: 'minimum squared centre travel', baselineSquaredTravel: before, squaredTravel: after, rmsTravelMeters: Math.sqrt(after / n) * 100 }
  }
  const vertices = [], indices = []
  const vertex = (x, y, z, u, v, id) => { const index = vertices.length / 6; vertices.push(x, y, z, u, v, id); return index }
  for (let id = 0; id < assigned.length; id++) {
    const r = assigned[id], rings = r.rings.length ? r.rings : [[[r.x - .0001, r.z - .0001], [r.x + .0001, r.z - .0001], [r.x + .0001, r.z + .0001], [r.x - .0001, r.z + .0001]]]
    // Only the largest component owns the starting square; secondary parts
    // unfold at the destination rather than stacking duplicate source tiles.
    rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))
    for (let component = 0; component < rings.length; component++) {
      const ring = direct ? alignRing(rings[component]) : rings[component], lengths = ring.map((p, i) => Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]))
      const total = lengths.reduce((a, b) => a + b, 0), samples = []; let at = 0
      // Include four quarter-perimeter points: the t=0 boundary is exactly square.
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length], end = at + lengths[i]
        samples.push({ p, t: at / total })
        for (let k = 1; k < 4; k++) if (k * total / 4 > at + 1e-8 && k * total / 4 < end - 1e-8) {
          const f = (k * total / 4 - at) / lengths[i]
          samples.push({ p: [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], t: k / 4 })
        }
        at = end
      }
      const start = vertices.length / 6, n = samples.length
      const uv = squareUV
      for (const y of [1, 0]) for (const s of samples) {
        const [u, v] = component === 0 ? uv(s.t) : [.5, .5]
        vertex(s.p[0], y, s.p[1], u, v, id)
      }
      const faces = ShapeUtils.triangulateShape(samples.map(s => new Vector2(...s.p)), [])
      // Earcut can remove collinear points in destination space. Those points
      // may be square corners at the flat endpoint, so split their boundary
      // triangle and retain them in the roof topology.
      const used = new Set(faces.flat())
      for (let k = 0; k < n; k++) if (!used.has(k)) {
        const p = samples[k].p
        search: for (let f = 0; f < faces.length; f++) for (let edge = 0; edge < 3; edge++) {
          const tri = faces[f], a = tri[edge], b = tri[(edge + 1) % 3], c = tri[(edge + 2) % 3], pa = samples[a].p, pb = samples[b].p
          const dx = pb[0] - pa[0], dz = pb[1] - pa[1], length2 = dx * dx + dz * dz
          const t = ((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dz) / length2
          if (t > 1e-8 && t < 1 - 1e-8 && Math.abs(dx * (p[1] - pa[1]) - dz * (p[0] - pa[0])) < 1e-9) {
            faces[f] = [a, k, c]; faces.push([k, b, c]); used.add(k); break search
          }
        }
      }
      // Fill only the source-space region missing from the destination roof
      // tessellation. Boolean difference handles self-touching survey edges.
      // These transient patches collapse to a point at the city endpoint.
      const sourceUV = samples.map(s => uv(s.t)), cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      const solid = component === 0 ? faces.filter(tri => Math.abs(cross(...tri.map(i => sourceUV[i]))) > 1e-10) : []
      const sourceArea = solid.reduce((sum, tri) => sum + Math.abs(cross(...tri.map(i => sourceUV[i]))) / 2, 0)
      if (component === 0 && Math.abs(sourceArea - 1) > 1e-9) {
        const snap = p => p.map(x => Math.round(x * 1e9) / 1e9)
        const square = [[[0, 0], [1, 0], [1, 1], [0, 1]]]
        const missing = polygonClipping.difference(square, ...solid.map(tri => [tri.map(i => snap(sourceUV[i]))]))
        for (const polygon of missing) {
          const rings = polygon.map(ring => ring.slice(0, -1).map(p => new Vector2(...p)))
          const patchFaces = ShapeUtils.triangulateShape(rings[0], rings.slice(1)), points = rings.flat()
          for (const face of patchFaces) {
            const patch = face.map(i => { const p = points[i]; return vertex(r.x, .5, r.z, p.x, p.y, id) })
            indices.push(patch[2], patch[1], patch[0])
          }
        }
      }
      for (const [a, b, c] of faces) indices.push(start + c, start + b, start + a)
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(start + i, start + j, start + n + j, start + i, start + n + j, start + n + i) }
    }
  }
  if ((vertices.length / 6) % 2) vertices.push(0, 0, 0, .5, .5, 0)
  const vertexCount = vertices.length / 6, v = new Uint16Array(vertexCount * 5), ids = new Uint32Array(vertexCount), ix = new Uint32Array(indices)
  for (let i = 0; i < vertexCount; i++) {
    v.set([Math.round((vertices[i * 6] - minX) / (maxX - minX) * 65535), vertices[i * 6 + 1] * 65535, Math.round((vertices[i * 6 + 2] - minZ) / (maxZ - minZ) * 65535), Math.round(vertices[i * 6 + 3] * 65535), Math.round(vertices[i * 6 + 4] * 65535)], i * 5)
    ids[i] = vertices[i * 6 + 5]
  }
  const header = new Uint32Array([0x53464332, vertexCount, ix.length, list.length, side, 0, 0, 0])
  const bytes = Buffer.concat([Buffer.from(header.buffer), Buffer.from(info.buffer), Buffer.from(v.buffer), Buffer.from(ids.buffer), Buffer.from(ix.buffer)])
  const compressed = gzipSync(bytes, { level: 9 })
  writeFileSync(`${out}/${name}.bin.gz`, compressed)
  console.log(`${name}: ${selection.length} buildings, ${side} × ${side} grid, ${vertexCount} vertices, ${ix.length / 3} triangles, ${(compressed.length / 1e6).toFixed(1)} MB compressed`)
  return { buildings: selection.length, cells: list.length, side, vertices: vertexCount, triangles: ix.length / 3, downloadBytes: compressed.length, bounds: region, ...(mapping && { mapping }) }
}
const existing = marketOnly ? JSON.parse(readFileSync(`${out}/manifest.json`, 'utf8')) : null
const full = existing?.full ?? build('sf', records)
const downtown = existing?.downtown ?? build('downtown', records.filter(r => r.x > 20 && r.z < -7 && r.z > -42))
const marketCenter = project([-122.404, 37.7864])
const marketSelection = [...records].sort((a, b) => Math.max(Math.abs(a.x - marketCenter[0]), Math.abs(a.z - marketCenter[1])) - Math.max(Math.abs(b.x - marketCenter[0]), Math.abs(b.z - marketCenter[1]))).slice(0, 256)
const market = build('market', marketSelection, { direct: true })
writeFileSync(`${out}/manifest.json`, JSON.stringify({ source: 'https://data.sf.gov/d/ynuv-fyni', shoreline: 'https://services.arcgis.com/Zs2aNLFN00jrS4gG/ArcGIS/rest/services/CPAs_WFL1/FeatureServer/7', retrieved: existing?.retrieved ?? new Date().toISOString().slice(0, 10), survey: 'Pictometry 2010 / DataSF 2017 footprint refinement', license: 'ODC PDDL', units: '1 scene unit = 100 metres', bounds, full, downtown, market, ignored, multipart, filledCourtyards: holes, fallbackHeights: records.filter(r => r.fallback).length, notes: 'Exterior footprints simplified at 0.8 m. Courtyards filled. Ground surface interpolated from building ground elevations; parks are approximate. Historic snapshot; no procedural buildings or contemporary landmark substitutions.' }, null, 2))
