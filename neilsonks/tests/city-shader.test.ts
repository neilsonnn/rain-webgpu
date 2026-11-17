import { describe, expect, it } from 'vitest'
import { parse } from '@shaderfrog/glsl-parser'
import preprocess from '@shaderfrog/glsl-parser/preprocessor/index.js'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { BufferGeometry, DataTexture, ShaderChunk, ShaderLib } from 'three'
import type { WebGLRenderer } from 'three'
import { cityMaterials } from '../src/city/material'
import { decodeCity } from '../src/city/data'
import { unusedTiles } from '../src/city/localTiles'
import { defaults } from '../src/city/types'

function expandIncludes(source: string): string {
  return source.replace(/#include\s+<([\w]+)>/g, (_, name: keyof typeof ShaderChunk) => {
    if (!(name in ShaderChunk)) throw new Error(`Unknown shader chunk: ${name}`)
    return expandIncludes(ShaderChunk[name])
  })
}

function shaders() {
  const ground = new DataTexture(), texture = new DataTexture(), geometry = new BufferGeometry()
  const data = { geometry, texture, textureSize: [1, 1] as [number, number], gridBounds: [-1, 1, -1, 1] as [number, number, number, number], side: 1, count: 1 }
  const assets = cityMaterials(data, [-1, 1, -1, 1], ground)
  const blanks = unusedTiles(data, assets.uniforms.uMorph, assets.uniforms.uDarkTile, ground)
  const result = [
    { name: 'building', material: assets.material, source: ShaderLib.standard },
    { name: 'shadow', material: assets.depth, source: ShaderLib.depth },
    { name: 'unused tile', material: blanks.material, source: ShaderLib.standard },
  ].map(({ name, material, source }) => {
    const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader } as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(shader, {} as WebGLRenderer)
    return { name, vertex: expandIncludes(shader.vertexShader), fragment: expandIncludes(shader.fragmentShader) }
  })
  assets.material.dispose(); assets.depth.dispose(); ground.dispose(); texture.dispose(); geometry.dispose()
  blanks.geometry.dispose(); blanks.material.dispose()
  return result
}

describe('city GLSL syntax', () => {
  it('matches the Uint32 city attribute with unsigned integer inputs in both programs', () => {
    const bytes = gunzipSync(readFileSync('public/data/city/downtown.bin.gz'))
    const data = decodeCity(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    // Three uses vertexAttribIPointer for Uint32 buffers, regardless of gpuType.
    // A float input compiles but makes every draw fail with GL_INVALID_OPERATION.
    expect(data.geometry.getAttribute('cityID').array).toBeInstanceOf(Uint32Array)
    for (const shader of shaders().filter(shader => shader.name !== 'unused tile')) expect(shader.vertex).toMatch(/attribute\s+uint\s+cityID\s*;/)
    data.geometry.dispose(); data.texture.dispose()
  })
  for (const shader of shaders()) {
    it(`parses the generated ${shader.name} vertex and fragment shaders`, () => {
      // This checks the real onBeforeCompile output and Three's shader chunks,
      // without launching a browser or claiming GPU/visual verification.
      for (const stage of ['vertex', 'fragment'] as const) {
        expect(() => parse(preprocess(shader[stage]), { stage, quiet: true, grammarSource: `city-${shader.name}.${stage}` })).not.toThrow()
      }
    })
  }
  it('rejects the reserved identifier that caused the reported blank scene', () => {
    const vertex = shaders()[0].vertex.replaceAll('layoutProgress', 'layout')
    expect(() => parse(preprocess(vertex), { stage: 'vertex', quiet: true })).toThrow()
  })
  it('uses the same direct footprint lerp and continuous rise in the building and shadow shaders', () => {
    for (const shader of shaders().filter(shader => shader.name !== 'unused tile')) {
      expect(shader.vertex).toMatch(/if\s*\(flow\)\s*\{[^}]*xz = mix\(original, target, t\);/)
      expect(shader.vertex).toContain('flow ? pow(t, uRiseEase)')
    }
  })
  it('defaults to strict mapping and collapses unmatched buildings and their shadows at every progress', () => {
    expect(defaults.unmatched).toBe('hide')
    for (const shader of shaders().filter(shader => shader.name !== 'unused tile')) {
      expect(shader.vertex).toMatch(/if\s*\(source.z == 0\. && uUnmatched < \.5\) return vec3\(source.x, 0\., source.y\);/)
    }
  })
})
