import { BufferAttribute, BufferGeometry, DataTexture, FloatType, InterleavedBuffer, InterleavedBufferAttribute, NearestFilter, RGBAFormat } from 'three'

export type CityDetail = 'market' | 'downtown' | 'full'
export interface CityManifest {
  bounds: number[]; retrieved: string; survey: string; fallbackHeights: number; filledCourtyards: number
  full: { buildings: number; cells: number; side: number; downloadBytes: number }
  downtown: { buildings: number; cells: number; side: number; downloadBytes: number }
  market: { buildings: number; cells: number; side: number; downloadBytes: number }
}
export interface TerrainData { size: number; bounds: number[]; heights: number[]; landMask: number[] }
export interface CityData { geometry: BufferGeometry; texture: DataTexture; textureSize: [number, number]; gridBounds: [number, number, number, number]; side: number; count: number }
export function decodeCity(buffer: ArrayBuffer): CityData {
  const header = new Uint32Array(buffer, 0, 8)
  if (header[0] !== 0x53464332) throw new Error('Invalid city geometry')
  const [, vertices, indices, count, side] = header
  const expected = 32 + count * 16 * 4 + vertices * 14 + indices * 4
  if (buffer.byteLength !== expected || count !== side * side) throw new Error('Incomplete city geometry')
  const width = 2048, height = Math.ceil(count * 4 / width)
  const records = new Float32Array(width * height * 4)
  records.set(new Float32Array(buffer, 32, count * 16))
  const texture = new DataTexture(records, width, height, RGBAFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true
  const offset = 32 + count * 16 * 4
  const interleaved = new InterleavedBuffer(new Uint16Array(buffer, offset, vertices * 5), 5)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new InterleavedBufferAttribute(interleaved, 3, 0, true))
  geometry.setAttribute('cityUV', new InterleavedBufferAttribute(interleaved, 2, 3, true))
  geometry.setAttribute('cityID', new BufferAttribute(new Uint32Array(buffer, offset + vertices * 10, vertices), 1))
  // Flat fragment normals come from the deformed surface. A finite vertex
  // normal is still required by Three's shadow normal-bias calculation.
  const normals = new Int8Array(vertices * 3)
  for (let i = 0; i < vertices; i++) normals[i * 3 + 1] = 127
  geometry.setAttribute('normal', new BufferAttribute(normals, 3, true))
  geometry.setIndex(new BufferAttribute(new Uint32Array(buffer, offset + vertices * 14, indices), 1))
  const span = records[14] * side
  const gridBounds: [number, number, number, number] = [records[0], records[0] + span, records[1], records[1] + span]
  return { geometry, texture, textureSize: [width, height], gridBounds, side, count }
}
export async function loadCity(detail: CityDetail, signal: AbortSignal, onProgress: (fraction: number) => void) {
  const response = await fetch(`/data/city/${detail === 'full' ? 'sf' : detail}.bin.gz`, { signal })
  if (!response.ok || !response.body) throw new Error('City download failed')
  // The file has a .gz extension but is intentionally served as a static asset,
  // without Content-Encoding. Handle hosts that transparently decompress too.
  const length = Number(response.headers.get('Content-Length'))
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let received = 0
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); received += value.length; onProgress(length ? Math.min(.92, received / length * .92) : .3) }
  const bytes = new Uint8Array(received); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  signal.throwIfAborted()
  let buffer: ArrayBuffer
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser needs gzip decompression support. Please use a current browser.')
    buffer = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  } else buffer = bytes.buffer
  signal.throwIfAborted(); onProgress(1)
  return decodeCity(buffer)
}
