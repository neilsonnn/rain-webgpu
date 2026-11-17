import { DataTexture, DataUtils, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'
import { optics, periodicNoise } from './settings'

function texture(bytes: Uint8Array | Uint16Array, width: number, height: number, color = false, type: typeof UnsignedByteType | typeof HalfFloatType = UnsignedByteType) {
  const map = new DataTexture(bytes, width, height, RGBAFormat, type)
  map.wrapS = map.wrapT = RepeatWrapping
  map.magFilter = LinearFilter
  map.minFilter = LinearMipmapLinearFilter
  map.generateMipmaps = true
  if (color) map.colorSpace = SRGBColorSpace
  map.needsUpdate = true
  return map
}

export function rolledGlassTexture(size = 768, seed = 417) {
  const heights = new Float32Array(size * size), bytes = new Uint16Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size
    // Broad roller ripples, stretched pebbles, and a much finer orange peel.
    heights[y * size + x] =
      periodicNoise(u * 12, v * 12, 12, seed) * .0007 +
      periodicNoise(u * 64, v * 64, 64, seed ^ 29) * .00055 +
      periodicNoise(u * 128, v * 128, 128, seed ^ 93) * .00017 +
      periodicNoise(u * 256, v * 256, 256, seed ^ 18) * .000055
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (heights[y * size + (x + 1) % size] - heights[y * size + (x - 1 + size) % size]) * size / (2 * optics.textureSize)
    const dy = (heights[((y + 1) % size) * size + x] - heights[((y - 1 + size) % size) * size + x]) * size / (2 * optics.textureSize)
    const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 4
    // RGBA16F avoids quantizing narrow specular lobes to 8-bit slope steps.
    bytes[i] = DataUtils.toHalfFloat(.5 - dx / length * .5)
    bytes[i + 1] = DataUtils.toHalfFloat(.5 - dy / length * .5)
    bytes[i + 2] = DataUtils.toHalfFloat(.5 + 1 / length * .5)
    // Retain the physical surface height alongside the gradient, for ray exits
    // and variable slab thickness. 1 alpha unit spans a 1.6 mm height range.
    bytes[i + 3] = DataUtils.toHalfFloat(Math.max(0, Math.min(1, .5 + (heights[y * size + x] - .0007375) / .0016)))
  }
  return texture(bytes, size, size, false, HalfFloatType)
}

export function leafTextures(width = 192, height = 384) {
  const colors = new Uint8Array(width * height * 4), normals = new Uint8Array(width * height * 4)
  const relief = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1), across = Math.abs(u - .5)
    const midrib = Math.exp(-across * across * 11000)
    const veinPhase = v * 11 - across * 5.4
    const distance = Math.abs(veinPhase - Math.round(veinPhase))
    const veins = Math.exp(-distance * distance * 2100) * (1 - Math.exp(-across * 45))
    const smallVein = Math.exp(-Math.pow(Math.sin((v * 27 - across * 12) * Math.PI), 2) * 90) * .2
    const mottling = periodicNoise(u * 13, v * 26, 26, 58)
    const pores = periodicNoise(u * 80, v * 160, 160, 91)
    const edge = Math.pow(Math.abs(u - .5) * 2, 5)
    const variation = .8 + .18 * mottling + .035 * pores + midrib * .16 + veins * .08 + edge * .055
    const i = (y * width + x) * 4
    colors.set([Math.min(255, 186 * variation), Math.min(255, 209 * variation), Math.min(255, 149 * variation), 255], i)
    relief[y * width + x] = midrib * .45 + veins * .2 + smallVein * .08 + pores * .055
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const read = (px: number, py: number) => relief[Math.max(0, Math.min(height - 1, py)) * width + Math.max(0, Math.min(width - 1, px))]
    const dx = (read(x + 1, y) - read(x - 1, y)) * 1.1
    const dy = (read(x, y + 1) - read(x, y - 1)) * 1.1
    const length = Math.hypot(dx, dy, 1), i = (y * width + x) * 4
    normals.set([(1 - dx / length) * 127.5, (1 - dy / length) * 127.5, (1 + 1 / length) * 127.5, 255], i)
  }
  return { color: texture(colors, width, height, true), normal: texture(normals, width, height) }
}

export function plasterTexture(size = 192) {
  const bytes = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = periodicNoise(x / size * 48, y / size * 48, 48, 81)
    const coarse = periodicNoise(x / size * 6, y / size * 6, 6, 18)
    const value = 166 + n * 35 + coarse * 38
    bytes.set([value, value, value, 255], (y * size + x) * 4)
  }
  return texture(bytes, size, size)
}
